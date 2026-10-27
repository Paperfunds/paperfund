import { readFileSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import { identifier, paperSolBaseUnits, tokenBaseUnits, utcInstant } from '@paperfund/core';
import { withGenericActor, withGenericAccount } from '../src/generic-access-context.js';
import { createProductionExecutionRouter } from '../src/production.js';
import { GenericCapability } from '../../db/src/generic-capability.js';
import type { DatabaseService } from '@paperfund/db';
import type { Stage1Snapshot } from '../src/experimental/non-sol-pump-swap.js';
const op = 'user:' + 'a'.repeat(64),
  other = 'user:' + 'b'.repeat(64);
function setup(
  exposure = false,
  operatorIds = [op],
  entries = true,
  purchaseProtocol = 'GENERIC_PUMP_SWAP',
) {
  const s = JSON.parse(
    readFileSync(
      new URL('./fixtures/generic-pumpswap-live/shunghla-warm.json', import.meta.url),
      'utf8',
    ),
  ).snapshot as Stage1Snapshot;
  vi.useFakeTimers();
  vi.setSystemTime(Date.parse(s.observedAt));
  let control = {
    schema: 'GENERIC_OPERATOR_CONTROL_V1',
    mode: 'ENTRY',
    expiresAt: Date.now() + 900000,
  };
  const query = vi.fn(async (input: unknown, values?: unknown[]) => {
    const c =
      typeof input === 'string'
        ? { text: input, values }
        : (input as { text: string; values?: unknown[] });
    if (c.text.startsWith('insert into app_meta')) {
      control = JSON.parse(String(c.values?.[1]));
      return { rows: [] };
    }
    if (c.text.includes('from app_meta')) return { rows: [{ value: JSON.stringify(control) }] };
    if (c.text.includes('from competition_accounts where'))
      return {
        rows:
          c.values?.[0] === 'owned-account' && c.values?.[1] === op
            ? [{ id: 'owned-account' }]
            : [],
      };
    if (c.text.includes('from positions'))
      return {
        rows:
          exposure && (c.values?.[2] === true || c.values?.[1] === op)
            ? [
                {
                  protocol: purchaseProtocol,
                  evidence_protocol: purchaseProtocol,
                  adapter: 'generic-pump-swap-orca-v1',
                  normalization: 'generic-pump-swap-accounts-v1',
                  mint: s.mint,
                  quote: s.quoteMint,
                  bridge: s.bridgePool,
                  target: s.targetPool,
                },
              ]
            : [],
      };
    throw Error('Unexpected SQL');
  });
  const capability = new GenericCapability({ pool: { query } } as unknown as DatabaseService, {
    armed: true,
    entries,
    normalUserAccess: entries,
    operatorIds,
    entrySeconds: 900,
    systemSettlement: true,
  });
  const fetcher = vi.fn(async (url: unknown, init?: RequestInit) => {
    if (String(url).includes('dexscreener'))
      return new Response(
        JSON.stringify([
          {
            pairAddress: s.bridgePool,
            baseToken: { address: s.quoteMint },
            quoteToken: { address: 'So11111111111111111111111111111111111111112' },
          },
        ]),
      );
    const req = JSON.parse(String(init?.body));
    return new Response(
      JSON.stringify({
        result: {
          context: { slot: s.slot },
          value: req.params[0].map((a: string) =>
            s.accounts[a]
              ? { owner: s.accounts[a]!.owner, data: [s.accounts[a]!.base64, 'base64'] }
              : null,
          ),
        },
      }),
    );
  });
  vi.stubGlobal('fetch', fetcher);
  const router = createProductionExecutionRouter({
    rpcUrl: 'https://fixture.invalid',
    rpcTimeoutMs: 1000,
    commitment: 'confirmed',
    genericPumpSwapEnabled: true,
    genericPumpSwapBuysEnabled: entries,
    genericAccessResolver: (mint, quote, settlement) => capability.resolve(mint, quote, settlement),
  });
  const identity = {
    protocolId: identifier('SOLANA_ROUTE', 'ProtocolId'),
    marketId: identifier('solana-route:' + s.mint, 'MarketId'),
    tokenMint: identifier(s.mint, 'TokenMint'),
  };
  return {
    s,
    capability,
    router,
    identity,
    fetcher,
    query,
    setExposure: (value: boolean) => {
      exposure = value;
    },
  };
}
function req(identity: ReturnType<typeof setup>['identity'], at: string) {
  return {
    identity,
    orderId: identifier('controlled', 'OrderId'),
    executionId: identifier('controlled', 'ExecutionId'),
    executedAt: utcInstant(at),
  };
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it('requires authenticated uniform access, denies anonymous/foreign accounts and keeps actor scopes isolated', async () => {
  const { s, capability, router, identity } = setup();
  await expect(router.loadPositionRoute(identity)).rejects.toThrow('ENTITLEMENT_REQUIRED');
  const [a, b] = await Promise.all([
    withGenericActor({ userId: op, intent: 'BUY' }, () =>
      capability.resolve(s.mint, s.quoteMint, false),
    ),
    withGenericActor({ userId: other, intent: 'BUY' }, () =>
      capability.resolve(s.mint, s.quoteMint, false),
    ),
  ]);
  expect(a).toMatchObject({ discover: true, buy: true });
  expect(b).toMatchObject({ discover: true, buy: true });
  const normal = await withGenericActor({ userId: other, intent: 'BUY' }, () =>
    router.loadPositionRoute(identity),
  );
  expect(normal.route.executionIdentity.protocolId).toBe('GENERIC_PUMP_SWAP');
});
it('hot entry disable blocks a loaded live BUY before pricing, while expired grants default to safe exit-only', async () => {
  const { s, capability, router, identity } = setup(),
    loaded = await withGenericActor({ userId: op, intent: 'BUY' }, () =>
      router.loadPositionRoute(identity),
    );
  const r = req(loaded.route.executionIdentity, s.observedAt);
  await capability.control(op, 'EXIT_ONLY');
  await expect(
    loaded.adapter.simulateBuy(
      { ...r, requestedPaperSol: paperSolBaseUnits(100000000n) },
      loaded.state,
    ),
  ).rejects.toThrow('ENTRY_DISABLED');
  await capability.control(op, 'ENTRY');
  vi.setSystemTime(Date.now() + 901000);
  expect((await capability.status(op)).entriesEnabled).toBe(false);
  expect((await capability.status(op)).mode).toBe('EXIT_ONLY');
});
it('revoked operator retains only its owned, current pinned exit, without cold indexing or new-entry permission', async () => {
  const { s, capability, router, identity, fetcher } = setup(true, [], false);
  const loaded = await withGenericActor({ userId: op, intent: 'SELL' }, () =>
    withGenericAccount('owned-account', () => router.loadPositionRoute(identity)),
  );
  expect(fetcher.mock.calls.some(([url]) => String(url).includes('dexscreener'))).toBe(false);
  const r = req(loaded.route.executionIdentity, s.observedAt),
    sell = await loaded.adapter.simulateSell(
      { ...r, requestedTokenQuantity: tokenBaseUnits(1000000000n) },
      loaded.state,
    );
  expect(sell.actualOutput.amount).toBeGreaterThan(0n);
  expect((await capability.status(op)).entitled).toBe(false);
  await expect(
    loaded.adapter.simulateBuy(
      { ...r, requestedPaperSol: paperSolBaseUnits(100000000n) },
      loaded.state,
    ),
  ).rejects.toThrow();
});
it('does not authorize another account with the same mint and requires an exact trusted settlement account', async () => {
  const { s, capability, router, identity, query } = setup(true);
  await expect(
    withGenericActor({ userId: op, intent: 'SELL' }, () =>
      withGenericAccount('foreign-account', () => router.loadPositionRoute(identity)),
    ),
  ).rejects.toThrow('ACCOUNT_OWNER_MISMATCH');
  await expect(router.loadPositionRoute(identity, true)).rejects.toThrow('ACCOUNT_SCOPE_REQUIRED');
  const loaded = await withGenericAccount('owned-account', () =>
    router.loadPositionRoute(identity, true),
  );
  expect(loaded.route.executionIdentity.protocolId).toBe('GENERIC_PUMP_SWAP');
  expect(
    query.mock.calls.some(
      ([c]) =>
        typeof c === 'object' &&
        c !== null &&
        (c as { values: unknown[] }).values?.[3] === 'owned-account',
    ),
  ).toBe(true);
  const denied = await withGenericActor({ userId: other, intent: 'SELL' }, () =>
    capability.resolve(s.mint, s.quoteMint, false),
  );
  expect(denied).toMatchObject({ discover: true, buy: true });
  await expect(denied.authorizeLive!('SELL')).rejects.toThrow('OWNED_EXIT_EVIDENCE_REQUIRED');
});
it('hard stop blocks owned exits and fresh entry; missing state never becomes a zero write-off', async () => {
  const { s, capability, router, identity } = setup(true),
    loaded = await withGenericActor({ userId: op, intent: 'SELL' }, () =>
      withGenericAccount('owned-account', () => router.loadPositionRoute(identity)),
    );
  await capability.control(op, 'HARD_STOP');
  await expect(
    loaded.adapter.simulateSell(
      {
        ...req(loaded.route.executionIdentity, s.observedAt),
        requestedTokenQuantity: tokenBaseUnits(1000000000n),
      },
      loaded.state,
    ),
  ).rejects.toThrow('HARD_STOP');
  await expect(
    withGenericActor({ userId: op, intent: 'BUY' }, () => router.loadPositionRoute(identity)),
  ).rejects.toThrow('HARD_STOP');
});

it('cold pinned zero-capacity retains the genuine-zero model, while missing bridge configuration stays unavailable', async () => {
  const { s, router, identity } = setup(true, [], false);
  const quote = s.accounts[s.quoteMint]!;
  void quote;
  const raw = Buffer.from(s.accounts[s.targetPool]!.base64, 'base64');
  raw.writeBigUInt64LE(0n, 271);
  raw.writeBigUInt64LE(0n, 279);
  s.accounts[s.targetPool] = { ...s.accounts[s.targetPool]!, base64: raw.toString('base64') };
  const { decodePumpSwapPool } = await import('../src/pump-swap.js'),
    p = decodePumpSwapPool(raw),
    vault = Buffer.from(s.accounts[p.quoteVault]!.base64, 'base64');
  vault.writeBigUInt64LE(0n, 64);
  s.accounts[p.quoteVault] = { ...s.accounts[p.quoteVault]!, base64: vault.toString('base64') };
  const { canonicalExitPreflight } = await import('@paperfund/execution');
  const exit = await withGenericActor({ userId: op, intent: 'SELL' }, () =>
    withGenericAccount('owned-account', () =>
      canonicalExitPreflight(router, identity, 1000000000n, 100000000n),
    ),
  );
  expect(exit.maxExecutableQuantityBaseUnits).toBe(0n);
  const { orcaLink } = await import('../src/composed-pump-orca.js'),
    link = orcaLink(s.bridgePool, s.accounts[s.bridgePool]!);
  delete s.accounts[link.config!];
  await expect(
    withGenericActor({ userId: op, intent: 'SELL' }, () =>
      withGenericAccount('owned-account', () =>
        canonicalExitPreflight(router, identity, 1000000000n, 100000000n),
      ),
    ),
  ).rejects.toThrow('Missing composed account');
});

it('authorizes an owned pre-migration BUY for fresh generic exit with new entries disabled', async () => {
  const { s, router, identity } = setup(true, [], false, 'SOLANA_ROUTE');
  const loaded = await withGenericActor({ userId: op, intent: 'SELL' }, () =>
    withGenericAccount('owned-account', () => router.loadPositionRoute(identity)),
  );
  const sell = await loaded.adapter.simulateSell(
    {
      ...req(loaded.route.executionIdentity, s.observedAt),
      requestedTokenQuantity: tokenBaseUnits(1000000000n),
    },
    loaded.state,
  );
  expect(sell.actualOutput.amount).toBeGreaterThan(0n);
  await expect(
    loaded.adapter.simulateBuy(
      {
        ...req(loaded.route.executionIdentity, s.observedAt),
        requestedPaperSol: paperSolBaseUnits(100000000n),
      },
      loaded.state,
    ),
  ).rejects.toThrow();
});
