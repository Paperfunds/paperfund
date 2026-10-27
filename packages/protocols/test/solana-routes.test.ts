import { PublicKey } from '@solana/web3.js';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { identifier, paperSolBaseUnits, tokenBaseUnits, utcInstant } from '@paperfund/core';
import {
  ExecutionRouter,
  ExecutionEngineError,
  createMarketStateEvidence,
  executionRouteRecord,
} from '@paperfund/execution';
import {
  SolanaRouteAdapter,
  SolanaRouteSource,
  quoteRecordedRoute,
  decodePoolLink,
  installSolanaMintResolver,
  type CapturedAccount,
} from '../src/solana-routes.js';
import { WRAPPED_SOL_MINT, type SolanaRpcClient } from '../src/pump-fun.js';
import { RECORDED_PUMP_FIXTURES } from './fixtures/pump-real-chain.js';
import { PUMP_PROGRAM_ID, PUMP_FUN_PROTOCOL_ID, pumpBondingCurveAddress } from '../src/pump-fun.js';
import { canonicalPumpSwapPoolAddress } from '../src/pump-swap.js';
import { recordedRoute } from './fixtures/routes.js';

describe('authoritative composed Solana routes', () => {
  it.each([0, 1] as const)(
    'replays chain snapshot %s without RPC and with real price impact/fees',
    async (index) => {
      const state = recordedRoute(index);
      const adapter = new SolanaRouteAdapter({
        async loadMarketState() {
          return state;
        },
      });
      const input = {
        identity: state.identity,
        orderId: identifier('route-buy', 'OrderId'),
        executionId: identifier('route-fill', 'ExecutionId'),
        executedAt: utcInstant('2026-09-30T20:00:00Z'),
      };
      const before = createMarketStateEvidence(state).fingerprint;
      const small = await adapter.simulateBuy(
        { ...input, requestedPaperSol: paperSolBaseUnits(1_000_000n) },
        state,
      );
      const large = await adapter.simulateBuy(
        { ...input, requestedPaperSol: paperSolBaseUnits(2_000_000n) },
        state,
      );
      expect(small.actualOutput.amount).toBeGreaterThan(0n);
      expect(large.actualOutput.amount).toBeLessThan(small.actualOutput.amount * 2n);
      expect(small.quote.fees.length).toBeGreaterThan(0);
      expect(small.quote.fees.every((f) => f.amount.amount > 0n)).toBe(true);
      const sold = await adapter.simulateSell(
        { ...input, requestedTokenQuantity: tokenBaseUnits(small.actualOutput.amount) },
        state,
      );
      expect(sold.actualOutput.amount).toBeGreaterThan(0n);
      expect(sold.actualOutput.amount).toBeLessThan(1_000_000n);
      expect(
        await adapter.simulateBuy(
          { ...input, requestedPaperSol: paperSolBaseUnits(1_000_000n) },
          state,
        ),
      ).toEqual(small);
      expect(createMarketStateEvidence(state).fingerprint).toBe(before);
      await expect(
        adapter.simulateBuy(
          {
            ...input,
            identity: { ...input.identity, tokenMint: identifier(WRAPPED_SOL_MINT, 'TokenMint') },
            requestedPaperSol: paperSolBaseUnits(1_000_000n),
          },
          state,
        ),
      ).rejects.toThrow('mint/market');
    },
  );
  it('verifies CPMM mint direction, creator fees and non-SOL intermediate fees', () => {
    const state = recordedRoute(0);
    const q = quoteRecordedRoute(state, 1_000_000n, true);
    expect(q.details).toHaveLength(2);
    expect(q.fees.find((f) => f.category === 'CREATOR_FEE')?.amount.asset).toBe('TOKEN');
    expect(q.fees.some((f) => f.amount.asset === 'PAPER_SOL')).toBe(true);
    const s = structuredClone(state);
    const accounts = s.normalizedState['accounts'] as Record<string, CapturedAccount>;
    const pool = (s.normalizedState['hops'] as Array<{ pool: string }>)[0]!.pool;
    accounts[pool] = { ...accounts[pool]!, owner: WRAPPED_SOL_MINT };
    expect(() => quoteRecordedRoute(s, 1_000_000n, true)).toThrow('decoder');
  });
  it('rejects empty reserves, disabled pools and zero output without inventing liquidity', () => {
    const state = recordedRoute(0);
    const accounts = state.normalizedState['accounts'] as Record<string, CapturedAccount>;
    const hop = (state.normalizedState['hops'] as Array<{ pool: string; vaultA: string }>)[0]!;
    const raw = accounts[hop.vaultA]!;
    const data = Buffer.from(raw.base64, 'base64');
    data.writeBigUInt64LE(0n, 64);
    accounts[hop.vaultA] = { ...raw, base64: data.toString('base64') };
    expect(() => quoteRecordedRoute(state, 1_000_000n, true)).toThrow();
    expect(() => quoteRecordedRoute(recordedRoute(1), 0n, true)).toThrow('positive u64');
  });
  it('discovers a non-Pump route from untrusted pool hints and selects the routed adapter', async () => {
    const state = recordedRoute(1);
    const accounts = state.normalizedState['accounts'] as Record<string, CapturedAccount>;
    const pool = (state.normalizedState['hops'] as Array<{ pool: string }>)[0]!.pool;
    const rpc = {
      async getMultipleAccounts(addresses: readonly string[]) {
        return {
          context: { slot: Number(state.chainSlot) },
          value: addresses.map((a) =>
            accounts[a]
              ? { owner: accounts[a]!.owner, data: [accounts[a]!.base64, 'base64'] as const }
              : null,
          ),
        };
      },
    } as SolanaRpcClient;
    const source = new SolanaRouteSource(rpc, {
      async pools() {
        return [pool];
      },
      async context() {
        return [state.identity.tokenMint];
      },
    });
    const router = new ExecutionRouter([new SolanaRouteAdapter(source)]);
    // Missing Pump state, not a terminal name, selects the same non-Pump adapter.
    const loaded = await source.loadMarketState(state.identity);
    expect(loaded.identity).toEqual(state.identity);
    expect((await router.resolvePositionRoute(loaded.identity)).adapter.protocolId).toBe(
      'SOLANA_ROUTE',
    );
    expect(decodePoolLink(pool, accounts[pool]!).mintA).toBe(state.identity.tokenMint);
    installSolanaMintResolver(router, source);
    expect(await router.contextResolver!(state.identity.tokenMint)).toBe(state.identity.tokenMint);
    expect(await source.resolveContext(pool)).toBe(state.identity.tokenMint);
    await expect(
      new SolanaRouteSource(rpc, {
        async pools() {
          return [];
        },
        async context() {
          return [];
        },
      }).loadMarketState(state.identity),
    ).rejects.toThrow('No authoritative SOL route');
  });
  it('pins topology across BUY/SELL and reloads reserves/slot without rediscovery', async () => {
    const fixture = recordedRoute(1);
    const accounts = fixture.normalizedState['accounts'] as Record<string, CapturedAccount>;
    const hops = fixture.normalizedState['hops'] as Array<{ pool: string; vaultA: string }>;
    let slot = Number(fixture.chainSlot);
    let discoveries = 0;
    const rpc = {
      async getMultipleAccounts(addresses: readonly string[]) {
        return {
          context: { slot: ++slot },
          value: addresses.map((a) =>
            accounts[a]
              ? { owner: accounts[a]!.owner, data: [accounts[a]!.base64, 'base64'] as const }
              : null,
          ),
        };
      },
    } as SolanaRpcClient;
    const source = new SolanaRouteSource(rpc, {
      async pools() {
        discoveries++;
        return [hops[0]!.pool];
      },
      async context() {
        return [];
      },
    });
    const first = await source.loadMarketState(fixture.identity);
    const count = discoveries;
    const buy = quoteRecordedRoute(first, 1_000_000n, true);
    const sell = quoteRecordedRoute(first, buy.output, false);
    expect(buy.details.map((h) => h['pool']).reverse()).toEqual(sell.details.map((h) => h['pool']));
    const second = await source.loadMarketState(fixture.identity);
    expect(second.chainSlot).toBeGreaterThan(first.chainSlot!);
    expect(discoveries).toBe(count);
    expect(second.normalizedState['routePolicy']).toBe('FIXED_TOPOLOGY_V1');
    // Returned evidence must not be able to mutate the address-only cache.
    (second.normalizedState['hops'] as Array<{ pool: string }>)[0]!.pool = 'contaminated';
    const third = await source.loadMarketState(fixture.identity);
    expect((third.normalizedState['hops'] as Array<{ pool: string }>)[0]!.pool).toBe(hops[0]!.pool);
    const vault = accounts[hops[0]!.vaultA]!;
    delete accounts[hops[0]!.vaultA];
    await expect(source.loadMarketState(fixture.identity)).rejects.toThrow(
      'Missing recorded account',
    );
    expect(discoveries).toBe(count);
    accounts[hops[0]!.vaultA] = vault;
    await source.loadMarketState(fixture.identity);
    expect(discoveries).toBeGreaterThan(count);
  });
  it('isolates alternating mints, amounts and decimal snapshots', async () => {
    const states = [recordedRoute(0), recordedRoute(1)];
    const accounts = Object.assign(
      {},
      ...states.map((s) => s.normalizedState['accounts']),
    ) as Record<string, CapturedAccount>;
    const slot = Math.max(...states.map((s) => Number(s.chainSlot)));
    const source = new SolanaRouteSource(
      {
        async getMultipleAccounts(addresses: readonly string[]) {
          return {
            context: { slot },
            value: addresses.map((a) =>
              accounts[a]
                ? { owner: accounts[a]!.owner, data: [accounts[a]!.base64, 'base64'] as const }
                : null,
            ),
          };
        },
      } as SolanaRpcClient,
      {
        async pools(mint) {
          return states.flatMap((s) =>
            (s.normalizedState['hops'] as Array<{ pool: string; mintA: string; mintB: string }>)
              .filter((h) => [h.mintA, h.mintB].includes(mint))
              .map((h) => h.pool),
          );
        },
        async context() {
          return [];
        },
      },
    );
    const first = await source.loadMarketState(states[0]!.identity);
    const expected = quoteRecordedRoute(first, 1_000_000n, true);
    const other = await source.loadMarketState(states[1]!.identity);
    quoteRecordedRoute(other, 2_000_000n, true);
    const returned = await source.loadMarketState(states[0]!.identity);
    expect(returned.identity.tokenMint).toBe(states[0]!.identity.tokenMint);
    expect(quoteRecordedRoute(returned, 1_000_000n, true)).toEqual(expected);
    expect(quoteRecordedRoute(first, 1_000_000n, true)).toEqual(expected);
  });
  it('rejects wrong decimals, future Clock and incomplete account cardinality', async () => {
    const state = recordedRoute(1);
    expect(() =>
      quoteRecordedRoute(
        { ...state, normalizedState: { ...state.normalizedState, tokenDecimals: '0' } },
        1_000_000n,
        true,
      ),
    ).toThrow('decimals');
    expect(() => quoteRecordedRoute({ ...state, chainSlot: 0n }, 1_000_000n, true)).toThrow(
      'Clock/slot',
    );
    // Test capture itself without allowing absent accounts to become valid reserves.
    const source = new SolanaRouteSource({
      getMultipleAccounts: async () => ({ context: { slot: 1 }, value: [] }),
    } as unknown as SolanaRpcClient);
    await expect(
      (
        source as unknown as {
          capture(identity: typeof state.identity, paths: unknown[]): Promise<unknown>;
        }
      ).capture(state.identity, [state.normalizedState['hops']]),
    ).rejects.toThrow('cardinality');
  });
  it('reproduces the exact operator loss without altering immutable state', () => {
    const rows = JSON.parse(
      readFileSync(new URL('./fixtures/operator-extreme-route.json', import.meta.url), 'utf8'),
    );
    for (const row of rows) {
      const state = {
        identity: {
          protocolId: row.protocol_id,
          marketId: row.market_id,
          tokenMint: row.mint_address,
        },
        adapterVersion: row.adapter_version,
        normalizationVersion: row.normalization_version,
        normalizedState: row.normalized_state,
        chainSlot: BigInt(row.chain_slot),
        chainBlockId: row.chain_block_id,
        observedAt: row.observed_at,
      };
      const before = JSON.stringify(state.normalizedState);
      const buy = quoteRecordedRoute(state, 984699562n, true);
      const reverse = quoteRecordedRoute(state, buy.output, false);
      expect(buy.output).toBe(199357658117n);
      expect(reverse.output).toBe(35573647n);
      expect(executionRouteRecord(state, true, buy.details)['topologyHash']).toBe(
        executionRouteRecord(state, false, reverse.details)['topologyHash'],
      );
      expect(buy.details.map((h) => h['pool']).reverse()).toEqual(
        reverse.details.map((h) => h['pool']),
      );
      expect(buy.details.every((h) => typeof h['inputDecimals'] === 'number')).toBe(true);
      expect(JSON.stringify(state.normalizedState)).toBe(before);
    }
  });
  it('rejects the recorded exotic PumpSwap migration before secondary pool discovery', async () => {
    const fixture = JSON.parse(
      readFileSync(new URL('./fixtures/operator-exotic-migration.json', import.meta.url), 'utf8'),
    );
    const curve = await pumpBondingCurveAddress(fixture.mint);
    let discoveries = 0;
    const accounts = new Map([
      [curve, fixture.response.value[0]],
      [fixture.pool, fixture.response.value[1]],
    ]);
    const source = new SolanaRouteSource(
      {
        async getMultipleAccounts(addresses: readonly string[]) {
          return {
            context: fixture.response.context,
            value: addresses.map((a) => accounts.get(a) ?? null),
          };
        },
      } as SolanaRpcClient,
      {
        async pools() {
          discoveries++;
          return [];
        },
        async context() {
          return [];
        },
      },
    );
    const router = new ExecutionRouter();
    installSolanaMintResolver(router, source);
    expect(await canonicalPumpSwapPoolAddress(fixture.mint, fixture.quote)).toBe(fixture.pool);
    await expect(router.mintResolver!(fixture.mint)).rejects.toThrow('Canonical non-SOL PumpSwap');
    expect(discoveries).toBe(0);
  });
  it('a fixed snapshot never selects an alternate route after missing state', () => {
    const state = recordedRoute(1);
    const good = structuredClone(state.normalizedState['hops']);
    const broken = (state.normalizedState['hops'] as Array<Record<string, string>>).map((h) => ({
      ...h,
      pool: 'missing',
    }));
    const normalizedState = {
      ...state.normalizedState,
      routePolicy: 'FIXED_TOPOLOGY_V1',
      hops: broken,
      candidateRoutes: [good],
    };
    expect(() => quoteRecordedRoute({ ...state, normalizedState }, 1_000_000n, true)).toThrow(
      'Missing recorded account',
    );
    expect(() => quoteRecordedRoute({ ...state, normalizedState }, 1_000_000n, false)).toThrow(
      'Missing recorded account',
    );
  });
  it('explicitly resolves native Pump migration while preserving origin and rejecting RPC failure', async () => {
    const fixture = RECORDED_PUMP_FIXTURES.early;
    const raw = Buffer.from(fixture.curveBase64, 'base64');
    let unavailable = false;
    const rpc = {
      async getMultipleAccounts() {
        if (unavailable) throw new ExecutionEngineError('RPC_UNAVAILABLE', 'Unavailable');
        return {
          context: { slot: 123 },
          value: [{ owner: PUMP_PROGRAM_ID, data: [raw.toString('base64'), 'base64'] as const }],
        };
      },
    } as SolanaRpcClient;
    const router = new ExecutionRouter();
    installSolanaMintResolver(router, new SolanaRouteSource(rpc));
    const origin = await router.mintResolver!(fixture.mint);
    expect(origin).toEqual({
      protocolId: PUMP_FUN_PROTOCOL_ID,
      marketId: fixture.market,
      tokenMint: fixture.mint,
    });
    raw[48] = 1;
    const route = await router.canonicalResolver!(origin);
    expect(route.originIdentity).toEqual(origin);
    expect(route.executionIdentity.marketId).toBe(await canonicalPumpSwapPoolAddress(fixture.mint));
    expect(await router.mintResolver!(fixture.mint)).toEqual(origin);
    unavailable = true;
    await expect(router.canonicalResolver!(origin)).rejects.toMatchObject({
      code: 'RPC_UNAVAILABLE',
    });
  });
});

it.each(['XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN','pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn', WRAPPED_SOL_MINT])('reads chart metadata on quote %s without evaluating liquidity', async quote => {
  const f = JSON.parse(readFileSync(new URL('./fixtures/operator-exotic-migration.json', import.meta.url), 'utf8'));
  const pool = structuredClone(f.response.value[1]);
  const bytes = Buffer.from(pool.data[0], 'base64'); new PublicKey(quote).toBuffer().copy(bytes,75); pool.data[0] = bytes.toString('base64');
  const mintBytes = Buffer.alloc(82); mintBytes.writeBigUInt64LE(1000000000000000n,36); mintBytes[44]=6; mintBytes[45]=1;
  const mint = { owner: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', data: [mintBytes.toString('base64'),'base64'] };
  const discovery = { pools: async () => { throw Error('execution discovery forbidden'); }, context: async () => [] };
  const source = new SolanaRouteSource({ getMultipleAccounts: async (addresses: readonly string[]) => ({ context: { slot: 123 }, value: addresses.map(a => a===f.pool ? pool : a===f.mint ? mint : null) }) } as SolanaRpcClient, discovery);
  const router = new ExecutionRouter(); installSolanaMintResolver(router,source);
  expect(await router.chartMetadataResolver!(f.pool)).toEqual({ requestedContext: f.pool,mint:f.mint,tokenProgram:mint.owner,tokenDecimals:6,tokenSupplyBaseUnits:'1000000000000000',chainSlot:'123' });
  expect((await source.chartMetadata(f.mint)).mint).toBe(f.mint);
  await expect(source.chartMetadata(WRAPPED_SOL_MINT === f.mint ? f.pool : '11111111111111111111111111111111')).rejects.toThrow();
});
