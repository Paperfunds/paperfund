import { orcaLink } from '../src/composed-pump-orca.js';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { identifier, paperSolBaseUnits, tokenBaseUnits, utcInstant } from '@paperfund/core';
import {
  canonicalExitPreflight,
  createMarketStateEvidence,
  executionRouteRecord,
} from '@paperfund/execution';
import { APPROVED_NON_SOL_PUMPSWAP_ROUTES, parseEnvironment } from '@paperfund/config';
import { createProductionExecutionRouter } from '../src/production.js';
import {
  NON_SOL_PUMP_SWAP_PROTOCOL_ID,
  NON_SOL_PUMP_SWAP_VERSION,
} from '../src/non-sol-pump-swap.js';
import type { Stage1Snapshot } from '../src/experimental/non-sol-pump-swap.js';
import { workingVectors } from './fixtures/stage2-working-vectors.js';
function fixture(name: string) {
  return JSON.parse(
    readFileSync(new URL('./fixtures/non-sol-stage1/' + name + '.json', import.meta.url), 'utf8'),
  ) as {
    snapshot: Stage1Snapshot;
    references: {
      input: string;
      targetOutput: string;
      exits: { percent: string; quantity: string; bridgeOutput: string }[];
    }[];
    referenceCapacity: { max: string; output: string };
    capacity: { requested: string };
  };
}
function routerFor(s: Stage1Snapshot, enabled?: boolean) {
  vi.useFakeTimers();
  vi.setSystemTime(Date.parse(s.observedAt));
  const fetch = vi.fn(async (_url: unknown, init: RequestInit | undefined) => {
    const request = JSON.parse(init?.body as string) as { method: string; params: [string[]] };
    if (request.method !== 'getMultipleAccounts') throw Error('UNEXPECTED_DISCOVERY_METHOD');
    return new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        result: {
          context: { slot: s.slot },
          value: request.params[0].map((a) =>
            s.accounts[a]
              ? { owner: s.accounts[a]!.owner, data: [s.accounts[a]!.base64, 'base64'] }
              : null,
          ),
        },
      }),
    );
  });
  vi.stubGlobal('fetch', fetch);
  const router = createProductionExecutionRouter({
    rpcUrl: 'https://rpc.fixture.invalid',
    rpcTimeoutMs: 1000,
    commitment: 'confirmed',
    ...(enabled !== undefined
      ? { nonSolPumpSwapEnabled: enabled, nonSolPumpSwapRoutes: APPROVED_NON_SOL_PUMPSWAP_ROUTES }
      : {}),
  });
  return { router, fetch };
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe('canonical Stage 2 integration', () => {
  it('strict server config defaults off and rejects client-like truthy strings', () => {
    const env = {
      DATABASE_URL: 'postgresql://fixture:fixture@localhost/test',
      REDIS_URL: 'redis://localhost:6379',
    };
    expect(parseEnvironment(env).NON_SOL_PUMPSWAP_ENABLED).toBe(false);
    expect(
      parseEnvironment({
        ...env,
        NON_SOL_PUMPSWAP_ENABLED: 'true',
        NON_SOL_PUMPSWAP_ALLOWED_ROUTES: JSON.stringify(APPROVED_NON_SOL_PUMPSWAP_ROUTES),
      }).NON_SOL_PUMPSWAP_ENABLED,
    ).toBe(true);
    expect(() => parseEnvironment({ ...env, NON_SOL_PUMPSWAP_ENABLED: '1' })).toThrow();
  });
  it('replays the unchanged pre-integration working branch vectors', async () => {
    expect(await workingVectors()).toEqual(
      JSON.parse(
        readFileSync(new URL('./fixtures/non-sol-stage2-before.json', import.meta.url), 'utf8'),
      ),
    );
  });
  it.each(['qubit', 'tusd', 'emoji'])(
    'default OFF keeps %s rejected before experimental discovery',
    async (name) => {
      const f = fixture(name),
        { router, fetch } = routerFor(f.snapshot);
      expect(router.isEnabled(NON_SOL_PUMP_SWAP_PROTOCOL_ID)).toBe(false);
      await expect(router.mintResolver!(f.snapshot.mint)).rejects.toMatchObject({
        code: 'POSITION_EXECUTION_ROUTE_UNAVAILABLE',
      });
      expect(fetch.mock.calls).toHaveLength(2);
    },
  );
  it.each(['qubit', 'tusd', 'emoji'])(
    'isolated ON uses canonical validated amounts, fee assets, evidence and preflight for %s',
    async (name) => {
      const f = fixture(name),
        s = f.snapshot,
        { router, fetch } = routerFor(s, true),
        origin = await router.mintResolver!(s.mint);
      expect(origin.tokenMint).toBe(s.mint);
      const { route, adapter, state } = await router.loadPositionRoute(origin);
      expect(route.executionIdentity.protocolId).toBe(NON_SOL_PUMP_SWAP_PROTOCOL_ID);
      expect(route.originIdentity).toEqual(origin);
      expect(state.normalizedState['stage1Snapshot']).toMatchObject({
        targetPool: s.targetPool,
        bridgePool: s.bridgePool,
        quoteMint: s.quoteMint,
      });
      expect(state.normalizedState['chainTime']).toBeTruthy();
      const routeRecord = executionRouteRecord(state, true);
      expect(
        (routeRecord['hops'] as { inputMint: string; outputMint: string }[]).map((h) => [
          h.inputMint,
          h.outputMint,
        ]),
      ).toEqual([
        ['So11111111111111111111111111111111111111112', s.quoteMint],
        [s.quoteMint, s.mint],
      ]);
      const r = f.references[1]!,
        req = {
          identity: route.executionIdentity,
          orderId: identifier('test-order', 'OrderId'),
          executionId: identifier('test-fill', 'ExecutionId'),
          executedAt: utcInstant(s.observedAt),
        };
      const buy = await adapter.simulateBuy(
        { ...req, requestedPaperSol: paperSolBaseUnits(BigInt(r.input)) },
        state,
      );
      expect(buy.actualOutput.amount).toBe(BigInt(r.targetOutput));
      expect(buy.actualInput.amount).toBe(BigInt(r.input));
      expect(
        buy.quote.fees.some(
          (f) => f.amount.asset === 'TOKEN' && f.amount.tokenMint === s.quoteMint,
        ),
      ).toBe(true);
      const sell = await adapter.simulateSell(
        { ...req, requestedTokenQuantity: tokenBaseUnits(BigInt(r.targetOutput)) },
        state,
      );
      expect(sell.actualOutput.amount).toBe(BigInt(r.exits.at(-1)!.bridgeOutput));
      expect(
        sell.quote.fees.every(
          (f) => f.amount.asset === 'TOKEN' && f.amount.tokenMint === s.quoteMint,
        ),
      ).toBe(true);
      expect(sell.quote.marketStateFingerprint).toBe(createMarketStateEvidence(state).fingerprint);
      const before = fetch.mock.calls.length;
      const exit = await canonicalExitPreflight(
        router,
        origin,
        BigInt(r.targetOutput),
        1000000000n,
      );
      expect(fetch.mock.calls.length).toBeGreaterThan(before); // fresh SELL state, not the earlier BUY capture
      expect(exit.full.outputLamports).toBe(BigInt(r.exits.at(-1)!.bridgeOutput));
      for (const percent of ['25', '50', '75'] as const)
        expect(exit.percentages[percent].outputLamports).toBe(
          BigInt(r.exits.find((e) => e.percent === percent)!.bridgeOutput),
        );
      expect(
        router.resolveVersion(NON_SOL_PUMP_SWAP_PROTOCOL_ID, NON_SOL_PUMP_SWAP_VERSION),
      ).toBeDefined();
    },
  );
  it.each(['qubit', 'tusd', 'emoji'])(
    'shares Stage 1 maximum exit and typed partial-liquidity preflight for %s',
    async (name) => {
      const f = fixture(name),
        { router } = routerFor(f.snapshot, true),
        origin = await router.mintResolver!(f.snapshot.mint);
      const exit = await canonicalExitPreflight(
        router,
        origin,
        BigInt(f.capacity.requested),
        2000000000n,
      );
      expect(exit.status).toBe('LIQUIDITY_LIMITED');
      expect(exit.maxExecutableQuantityBaseUnits).toBe(BigInt(f.referenceCapacity.max));
      expect(exit.maxExecutableOutputLamports).toBe(BigInt(f.referenceCapacity.output));
      expect(exit.executablePortionCostBasisLamports).toBe(
        (2000000000n * BigInt(f.referenceCapacity.max)) / BigInt(f.capacity.requested),
      );
    },
  );
  it('fails without the bound bridge and never asks an indexer for another target', async () => {
    const s = fixture('qubit').snapshot;
    delete s.accounts[s.bridgePool];
    const { router, fetch } = routerFor(s, true);
    await expect(router.mintResolver!(s.mint)).rejects.toMatchObject({
      code: 'POSITION_EXECUTION_ROUTE_UNAVAILABLE',
    });
    expect(fetch.mock.calls).toHaveLength(2);
  });
  it('rejects missing ticks/invalid snapshots without reporting zero capacity', async () => {
    const s = fixture('qubit').snapshot,
      { router } = routerFor(s, true),
      origin = await router.mintResolver!(s.mint),
      { route, adapter, state } = await router.loadPositionRoute(origin);
    const broken = structuredClone(state),
      snap = broken.normalizedState['stage1Snapshot'] as unknown as Stage1Snapshot;
    snap.slot++;
    await expect(
      adapter.valuePositionForExit(
        { identity: route.executionIdentity, tokenQuantity: tokenBaseUnits(1000000n) },
        broken,
      ),
    ).rejects.toThrow('STATE_IDENTITY');
    snap.slot--;
    const link = orcaLink(snap.bridgePool, snap.accounts[snap.bridgePool]!);
    for (const a of link.extraAccounts ?? []) {
      delete snap.accounts[a];
      snap.absentAccounts = snap.absentAccounts.filter((x) => x !== a);
    }
    await expect(
      adapter.maxExecutableSellQuantity!(
        { identity: route.executionIdentity, tokenQuantity: tokenBaseUnits(1000000000000n) },
        broken,
      ),
    ).rejects.toThrow();
  });
  it('isolated ON rejects malformed target ownership and unsupported fee configuration', async () => {
    const s = fixture('tusd').snapshot,
      { router } = routerFor(s, true),
      origin = await router.mintResolver!(s.mint);
    const feeAddress = '5PHirr8joyTMp9JMm6nW7hNDVyEYdkzDqazxPD7RaTjx';
    const fee = s.accounts[feeAddress]!;
    s.accounts[feeAddress] = { ...fee, owner: '11111111111111111111111111111111' };
    await expect(router.loadPositionRoute(origin)).rejects.toThrow('CONFIG_OWNER');
    s.accounts[feeAddress] = fee;
    s.accounts[s.targetPool] = {
      ...s.accounts[s.targetPool]!,
      owner: '11111111111111111111111111111111',
    };
    await expect(router.loadPositionRoute(origin)).rejects.toThrow('BOUND_POOLS');
  });
  it('does not reuse a cached pre-migration identity after curve completion', async () => {
    const s = fixture('emoji').snapshot,
      { router } = routerFor(s, true);
    const before = await router.mintResolver!(s.mint),
      a = await router.loadPositionRoute(before);
    // Changing the verified curve quote cannot reuse its prior destination or fall back.
    const curve = Object.entries(s.accounts).find(
      ([, a]) => a.owner === '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
    )!;
    const bytes = Buffer.from(curve[1].base64, 'base64');
    bytes[48] = 0;
    s.accounts[curve[0]] = { ...curve[1], base64: bytes.toString('base64') };
    const after = await router.canonicalResolver!(before);
    expect(after.executionIdentity.protocolId).not.toBe(a.route.executionIdentity.protocolId);
  });
});
