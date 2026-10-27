import { readFileSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import type { genericPumpSwapIdentity } from '../src/generic-pump-swap.js';
import {
  GenericPumpSwapSource,
  GenericPumpSwapAdapter,
  GENERIC_PUMP_SWAP_PROTOCOL_ID,
} from '../src/generic-pump-swap.js';
import {
  NonSolPumpSwapAdapter,
  NonSolPumpSwapSource,
  nonSolPumpSwapIdentity,
} from '../src/non-sol-pump-swap.js';
import { createProductionExecutionRouter } from '../src/production.js';
import { workingVectors } from './fixtures/stage2-working-vectors.js';
import { APPROVED_NON_SOL_PUMPSWAP_ROUTES } from '@paperfund/config';
import { parseEnvironment } from '../../config/src/index.js';
import { identifier, paperSolBaseUnits, tokenBaseUnits, utcInstant } from '@paperfund/core';
import { canonicalExitPreflight, ExecutionRouter } from '@paperfund/execution';
import type { Stage1Snapshot } from '../src/experimental/non-sol-pump-swap.js';
const fixture = (name = 'qubit') =>
  JSON.parse(
    readFileSync(new URL('./fixtures/non-sol-stage1/' + name + '.json', import.meta.url), 'utf8'),
  ) as {
    snapshot: Stage1Snapshot;
    references: {
      input: string;
      targetOutput: string;
      exits: { percent: string; quantity: string; bridgeOutput: string }[];
    }[];
    capacity: { requested: string };
    referenceCapacity: { max: string; output: string };
  };
const before = JSON.parse(
  readFileSync(new URL('./fixtures/generic-pumpswap-before.json', import.meta.url), 'utf8'),
);
function sourceFor(s = fixture().snapshot) {
  vi.useFakeTimers();
  vi.setSystemTime(Date.parse(s.observedAt));
  const rpc = {
    getMultipleAccounts: vi.fn(async (addresses: readonly string[]) => ({
      context: { slot: s.slot },
      value: addresses.map((a) =>
        s.accounts[a]
          ? { owner: s.accounts[a]!.owner, data: [s.accounts[a]!.base64, 'base64'] as const }
          : null,
      ),
    })),
  };
  const candidates = { pools: vi.fn(async () => [s.bridgePool]) };
  const source = new GenericPumpSwapSource(rpc, candidates);
  return { source, rpc, candidates, s };
}
const request = (identity: ReturnType<typeof genericPumpSwapIdentity>, at: string) => ({
  identity,
  orderId: identifier('generic-before', 'OrderId'),
  executionId: identifier('generic-before', 'ExecutionId'),
  executedAt: utcInstant(at),
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it('defaults both server capabilities OFF and enforces explicit true/false and exit-only gating', () => {
  const env = {
    DATABASE_URL: 'postgresql://fixture:fixture@localhost/test',
    REDIS_URL: 'redis://localhost:6379',
  };
  expect(parseEnvironment(env)).toMatchObject({
    GENERIC_PUMPSWAP_ENABLED: false,
    GENERIC_PUMPSWAP_BUYS_ENABLED: false,
  });
  expect(() => parseEnvironment({ ...env, GENERIC_PUMPSWAP_ENABLED: '1' })).toThrow();
  expect(() =>
    parseEnvironment({
      ...env,
      GENERIC_PUMPSWAP_BUYS_ENABLED: 'true',
      GENERIC_PUMPSWAP_OPERATOR_USER_IDS: JSON.stringify(['user:' + 'a'.repeat(64)]),
    }),
  ).toThrow('requires');
  const router = createProductionExecutionRouter({
    rpcUrl: 'https://example.invalid',
    rpcTimeoutMs: 1000,
    commitment: 'confirmed',
  });
  expect(router.isEnabled(GENERIC_PUMP_SWAP_PROTOCOL_ID)).toBe(false);
});
it('keeps seven existing branches bit-identical with generic OFF and isolated ON', async () => {
  expect(await workingVectors(false)).toEqual(before.legacyOff);
  expect(await workingVectors(true)).toEqual(before.legacyRestrictedOn);
  expect(await workingVectors(true, true)).toEqual(before.legacyRestrictedOn);
}, 15000);
it.each(['qubit', 'tusd', 'emoji'])(
  'preserves complete restricted %s before vectors bit-for-bit',
  async (name) => {
    const s = fixture(name).snapshot;
    const adapter = new NonSolPumpSwapAdapter(
      new NonSolPumpSwapSource({
        getMultipleAccounts: async () => {
          throw Error('Unexpected RPC');
        },
      }),
    );
    const source = new NonSolPumpSwapSource({
      getMultipleAccounts: async () => {
        throw Error('Unexpected RPC');
      },
    });
    const captured = await source.state(nonSolPumpSwapIdentity(s.mint, s.quoteMint), s),
      rows = [];
    for (const input of [1000000n, 100000000n, 1000000000n, 10000000000n]) {
      const req = request(captured.identity, s.observedAt),
        buy = await adapter.simulateBuy(
          { ...req, requestedPaperSol: paperSolBaseUnits(input) },
          captured,
        );
      rows.push({
        amount: input,
        buy,
        exits: await Promise.all(
          [25n, 50n, 75n, 100n].map((p) =>
            adapter.valuePositionForExit(
              {
                identity: captured.identity,
                tokenQuantity: tokenBaseUnits((buy.actualOutput.amount * p) / 100n),
              },
              captured,
            ),
          ),
        ),
        max: await adapter.maxExecutableSellQuantity(
          { identity: captured.identity, tokenQuantity: tokenBaseUnits(buy.actualOutput.amount) },
          captured,
        ),
      });
    }
    expect(
      JSON.parse(JSON.stringify(rows, (_, v) => (typeof v === 'bigint' ? v.toString() : v))),
    ).toEqual(before.nonSol[name]);
  },
);
it.each(['qubit', 'tusd', 'emoji'])(
  'automatically discovers and reproduces independent %s BUY/SELL/capacity references',
  async (name) => {
    const f = fixture(name),
      { source, rpc, candidates, s } = sourceFor(f.snapshot),
      identity = await source.resolve(s.mint, s.quoteMint),
      adapter = new GenericPumpSwapAdapter(source),
      state = await adapter.loadMarketState(identity);
    expect(rpc.getMultipleAccounts).toHaveBeenCalledTimes(4);
    expect(candidates.pools).toHaveBeenCalledTimes(1);
    for (const ref of f.references) {
      const buy = await adapter.simulateBuy(
        {
          ...request(identity, s.observedAt),
          requestedPaperSol: paperSolBaseUnits(BigInt(ref.input)),
        },
        state,
      );
      expect(buy.actualOutput.amount.toString()).toBe(ref.targetOutput);
      for (const exit of ref.exits)
        expect(
          (
            await adapter.valuePositionForExit(
              { identity, tokenQuantity: tokenBaseUnits(BigInt(exit.quantity)) },
              state,
            )
          ).paperSolValue.toString(),
        ).toBe(exit.bridgeOutput);
    }
    const max = await adapter.maxExecutableSellQuantity(
      { identity, tokenQuantity: tokenBaseUnits(BigInt(f.capacity.requested)) },
      state,
    );
    expect(max.toString()).toBe(f.referenceCapacity.max);
    expect(
      (
        await adapter.valuePositionForExit({ identity, tokenQuantity: max }, state)
      ).paperSolValue.toString(),
    ).toBe(f.referenceCapacity.output);
    const warm = await source.resolve(s.mint, s.quoteMint);
    await source.loadMarketState(warm);
    expect(rpc.getMultipleAccounts).toHaveBeenCalledTimes(5);
    expect(candidates.pools).toHaveBeenCalledTimes(1);
  },
);
it('keeps the closed production allowlist rejected when generic OFF; ON dispatches only excluded targets to generic', async () => {
  const s = fixture().snapshot;
  vi.useFakeTimers();
  vi.setSystemTime(Date.parse(s.observedAt));
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
    const body = JSON.parse(String(init?.body));
    return new Response(
      JSON.stringify({
        result: {
          context: { slot: s.slot },
          value: body.params[0].map((a: string) =>
            s.accounts[a]
              ? { owner: s.accounts[a]!.owner, data: [s.accounts[a]!.base64, 'base64'] }
              : null,
          ),
        },
      }),
    );
  });
  vi.stubGlobal('fetch', fetcher);
  const opts = {
    rpcUrl: 'https://fixture.invalid',
    rpcTimeoutMs: 1000,
    commitment: 'confirmed' as const,
    nonSolPumpSwapEnabled: true,
    nonSolPumpSwapRoutes: APPROVED_NON_SOL_PUMPSWAP_ROUTES,
  };
  const router = createProductionExecutionRouter({
    ...opts,
    genericPumpSwapEnabled: true,
    genericPumpSwapBuysEnabled: true,
  });
  const origin = await router.mintResolver!(s.mint),
    loaded = await router.loadPositionRoute(origin);
  expect(loaded.route.executionIdentity.protocolId).toBe('NON_SOL_PUMP_SWAP');
  expect(fetcher.mock.calls.some(([url]) => String(url).includes('dexscreener'))).toBe(false);
});
it('allows valid exits while disabling new generic BUYs, and never bypasses identity/state checks', async () => {
  const { source, s } = sourceFor(),
    identity = await source.resolve(s.mint, s.quoteMint),
    state = await source.loadMarketState(identity),
    adapter = new GenericPumpSwapAdapter(source, false),
    req = request(identity, s.observedAt);
  await expect(
    adapter.simulateBuy({ ...req, requestedPaperSol: paperSolBaseUnits(100000000n) }, state),
  ).rejects.toThrow('EXIT_ONLY');
  const quantity = tokenBaseUnits(1000000n);
  expect(
    (await adapter.simulateSell({ ...req, requestedTokenQuantity: quantity }, state)).actualOutput
      .amount,
  ).toBeGreaterThan(0n);
  const wrong = {
    ...structuredClone(state),
    identity: { ...state.identity, marketId: identifier('wrong', 'MarketId') },
  };
  await expect(
    adapter.simulateSell({ ...req, requestedTokenQuantity: quantity }, wrong),
  ).rejects.toThrow('STATE_IDENTITY');
});
it('returns explicit missing/unsupported bridge results and rejects wrong orientation', async () => {
  const { source, candidates, s } = sourceFor();
  candidates.pools.mockResolvedValue([]);
  expect(await source.eligibility(s.mint, s.quoteMint)).toMatchObject({
    supported: false,
    diagnostics: 'GENERIC_SOL_BRIDGE_NOT_FOUND',
  });
  candidates.pools.mockResolvedValue([s.targetPool]);
  const rejected = await source.eligibility(s.mint, s.quoteMint);
  expect(rejected.supported).toBe(false);
  expect(JSON.stringify(rejected)).toContain('BRIDGE_PROGRAM_UNSUPPORTED');
  candidates.pools.mockResolvedValue([s.bridgePool]);
  await expect(
    source.resolve(s.mint, 'So11111111111111111111111111111111111111112'),
  ).rejects.toThrow('NATIVE_ROUTE');
  const wrong = structuredClone(s);
  wrong.accounts[wrong.targetPool] = {
    ...wrong.accounts[wrong.targetPool]!,
    base64: Buffer.from(
      Buffer.from(wrong.accounts[wrong.targetPool]!.base64, 'base64').map((b, i) =>
        i === 43 ? b ^ 1 : b,
      ),
    ).toString('base64'),
  };
  const bad = sourceFor(wrong);
  expect((await bad.source.eligibility(s.mint, s.quoteMint)).supported).toBe(false);
});
it('fails unavailable for missing required ticks, evicts addresses and rediscovers on a new operation', async () => {
  const { source, s, rpc, candidates } = sourceFor(),
    identity = await source.resolve(s.mint, s.quoteMint);
  const changed = structuredClone(s);
  const { orcaLink } = await import('../src/composed-pump-orca.js');
  const link = orcaLink(s.bridgePool, s.accounts[s.bridgePool]!);
  for (const a of link.extraAccounts ?? []) delete changed.accounts[a];
  rpc.getMultipleAccounts.mockImplementation(async (addresses) => ({
    context: { slot: s.slot },
    value: addresses.map((a) =>
      changed.accounts[a]
        ? {
            owner: changed.accounts[a]!.owner,
            data: [changed.accounts[a]!.base64, 'base64'] as const,
          }
        : null,
    ),
  }));
  await expect(source.loadMarketState(identity)).rejects.toThrow();
  expect((await source.eligibility(s.mint, s.quoteMint)).supported).toBe(false);
  expect(candidates.pools).toHaveBeenCalledTimes(2);
});
it('deterministically deduplicates unordered bridge hints and pins one topology for both directions', async () => {
  const { source, s, candidates, rpc } = sourceFor();
  candidates.pools.mockResolvedValue([s.bridgePool, s.targetPool, s.bridgePool]);
  const identity = await source.resolve(s.mint, s.quoteMint);
  expect(identity.marketId).toContain(s.bridgePool);
  expect(rpc.getMultipleAccounts.mock.calls[1]![0]).toEqual([s.targetPool, s.bridgePool].sort());
  const state = await source.loadMarketState(identity),
    adapter = new GenericPumpSwapAdapter(source),
    router = new ExecutionRouter([adapter]);
  router.canonicalResolver = async (origin) => ({
    originIdentity: origin,
    executionIdentity: identity,
    migrated: origin.marketId !== identity.marketId,
  });
  adapter.loadMarketState = async () => state;
  const exit = await canonicalExitPreflight(
    router,
    identity,
    BigInt(fixture().references[0]!.targetOutput),
    100000000n,
  );
  expect(exit.full.executable).toBe(true);
  expect(Object.values(exit.percentages).every((x) => x.executable)).toBe(true);
});

it('rejects transfer fees before indexer discovery and rejects genuine empty bridge funding', async () => {
  const { PublicKey } = await import('@solana/web3.js');
  const { TransferFeeConfigLayout } = await import('@solana/spl-token');
  const s = fixture().snapshot,
    raw = Buffer.from(s.accounts[s.quoteMint]!.base64, 'base64'),
    tf = Buffer.alloc(4 + TransferFeeConfigLayout.span);
  tf.writeUInt16LE(1, 0);
  tf.writeUInt16LE(TransferFeeConfigLayout.span, 2);
  const fee = { epoch: 0n, maximumFee: 10n, transferFeeBasisPoints: 100 };
  TransferFeeConfigLayout.encode(
    {
      transferFeeConfigAuthority: PublicKey.default,
      withdrawWithheldAuthority: PublicKey.default,
      withheldAmount: 0n,
      olderTransferFee: fee,
      newerTransferFee: fee,
    },
    tf.subarray(4),
  );
  s.accounts[s.quoteMint] = {
    ...s.accounts[s.quoteMint]!,
    base64: Buffer.concat([raw, tf]).toString('base64'),
  };
  const f = sourceFor(s);
  expect(await f.source.eligibility(s.mint, s.quoteMint)).toMatchObject({
    supported: false,
    diagnostics: 'STAGE1_TRANSFER_FEES_UNSUPPORTED',
  });
  expect(f.candidates.pools).not.toHaveBeenCalled();
  const empty = fixture().snapshot,
    { orcaLink } = await import('../src/composed-pump-orca.js'),
    link = orcaLink(empty.bridgePool, empty.accounts[empty.bridgePool]!);
  const bytes = Buffer.from(empty.accounts[link.vaultB]!.base64, 'base64');
  bytes.writeBigUInt64LE(0n, 64);
  empty.accounts[link.vaultB] = {
    ...empty.accounts[link.vaultB]!,
    base64: bytes.toString('base64'),
  };
  const unavailable = sourceFor(empty);
  expect((await unavailable.source.eligibility(empty.mint, empty.quoteMint)).supported).toBe(false);
  expect(JSON.stringify(unavailable.source.diagnostics)).not.toContain('RPC');
});
it('revalidates a migration transition instead of accepting the completed topology cache', async () => {
  const { source, s } = sourceFor(),
    identity = await source.resolve(s.mint, s.quoteMint);
  const { pumpBondingCurveAddress } = await import('../src/pump-fun.js');
  const a = await pumpBondingCurveAddress(s.mint),
    b = Buffer.from(s.accounts[a]!.base64, 'base64');
  b[48] = 0;
  s.accounts[a] = { ...s.accounts[a]!, base64: b.toString('base64') };
  await expect(source.loadMarketState(identity)).rejects.toThrow('MIGRATION_IDENTITY');
});

it('exit-only preserves historical generic BUY replay while current fresh loads block entry', async () => {
  const { source, s } = sourceFor(),
    identity = await source.resolve(s.mint, s.quoteMint),
    open = new GenericPumpSwapAdapter(source, true),
    old = await open.loadMarketState(identity),
    req = request(identity, s.observedAt),
    input = paperSolBaseUnits(100000000n),
    fill = await open.simulateBuy({ ...req, requestedPaperSol: input }, old);
  const exitOnly = new GenericPumpSwapAdapter(source, false),
    fresh = await exitOnly.loadMarketState(identity);
  await expect(exitOnly.simulateBuy({ ...req, requestedPaperSol: input }, fresh)).rejects.toThrow(
    'EXIT_ONLY',
  );
  expect(await exitOnly.simulateBuy({ ...req, requestedPaperSol: input }, old)).toEqual(fill);
});

it.each(['shunghla-warm', 'nvda-cartridge-cold', 'tesla-teslasi-cold'])(
  'replays real %s with independent SDK percentages and honest capacity boundaries',
  async (name) => {
    const f = JSON.parse(
      readFileSync(
        new URL('./fixtures/generic-pumpswap-live/' + name + '.json', import.meta.url),
        'utf8',
      ),
    ) as {
      snapshot: Stage1Snapshot;
      result: { buyUnits: string; supplyExitCapacity: string | { status: string; reason: string } };
      references: { quantity: string; netSol: string }[];
    };
    const { source, s } = sourceFor(f.snapshot),
      identity = await source.resolve(s.mint, s.quoteMint),
      adapter = new GenericPumpSwapAdapter(source),
      state = await adapter.loadMarketState(identity),
      buy = await adapter.simulateBuy(
        { ...request(identity, s.observedAt), requestedPaperSol: paperSolBaseUnits(100000000n) },
        state,
      );
    expect(buy.actualOutput.amount.toString()).toBe(f.result.buyUnits);
    for (const ref of f.references)
      expect(
        (
          await adapter.valuePositionForExit(
            { identity, tokenQuantity: tokenBaseUnits(BigInt(ref.quantity)) },
            state,
          )
        ).paperSolValue.toString(),
      ).toBe(ref.netSol);
    if (typeof f.result.supplyExitCapacity === 'string') {
      const { unpackMint } = await import('@solana/spl-token');
      const { PublicKey } = await import('@solana/web3.js'),
        a = s.accounts[s.mint]!,
        mint = unpackMint(
          new PublicKey(s.mint),
          {
            data: Buffer.from(a.base64, 'base64'),
            owner: new PublicKey(a.owner),
            lamports: 0,
            executable: false,
            rentEpoch: 0,
          },
          new PublicKey(a.owner),
        );
      expect(
        (
          await adapter.maxExecutableSellQuantity(
            { identity, tokenQuantity: tokenBaseUnits(mint.supply) },
            state,
          )
        ).toString(),
      ).toBe(f.result.supplyExitCapacity);
    } else {
      await expect(
        adapter.maxExecutableSellQuantity(
          { identity, tokenQuantity: tokenBaseUnits(1000000000000000n) },
          state,
        ),
      ).rejects.toThrow('tick range');
    }
  },
);
it('ranks genuinely alternative selections by supported reference size, net recovery and deterministic tie, not discovery order', async () => {
  const { compareGenericBridges } = await import('../src/generic-pump-swap.js');
  const cases = [
    { reference: '1000000', recoveryPpb: '999999999', pool: 'C' },
    { reference: '1000000000', recoveryPpb: '950000000', pool: 'B' },
    { reference: '1000000000', recoveryPpb: '950000000', pool: 'A' },
    { reference: '1000000000', recoveryPpb: '900000000', pool: 'D' },
  ];
  expect(cases.sort(compareGenericBridges).map((x) => x.pool)).toEqual(['A', 'B', 'D', 'C']);
});
it('does not apply exotic fees to independently unvalidated protocol stable/native fee classes', async () => {
  const { source, s, rpc } = sourceFor(),
    { NATIVE_MINT_2022 } = await import('@solana/spl-token');
  await expect(
    source.resolve(s.mint, 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
  ).rejects.toThrow('STABLE_FEE_SCHEDULE_UNSUPPORTED');
  await expect(source.resolve(s.mint, NATIVE_MINT_2022.toBase58())).rejects.toThrow(
    'NATIVE_FEE_SCHEDULE_UNSUPPORTED',
  );
  expect(rpc.getMultipleAccounts).not.toHaveBeenCalled();
});

it('generic OFF retains exact Shunghla rejection before bridge discovery, and historical version replay remains readable', async () => {
  const f = JSON.parse(
    readFileSync(
      new URL('./fixtures/generic-pumpswap-live/shunghla-warm.json', import.meta.url),
      'utf8',
    ),
  ) as { snapshot: Stage1Snapshot };
  const { source, s } = sourceFor(f.snapshot),
    identity = await source.resolve(s.mint, s.quoteMint),
    open = new GenericPumpSwapAdapter(source, true),
    state = await open.loadMarketState(identity),
    req = request(identity, s.observedAt),
    input = paperSolBaseUnits(100000000n),
    original = await new ExecutionRouter([open])
      .resolveVersion(identity.protocolId, state.adapterVersion)
      .simulateBuy({ ...req, requestedPaperSol: input }, state);
  const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const b = JSON.parse(String(init?.body));
    return new Response(
      JSON.stringify({
        result: {
          context: { slot: s.slot },
          value: b.params[0].map((a: string) =>
            s.accounts[a]
              ? { owner: s.accounts[a]!.owner, data: [s.accounts[a]!.base64, 'base64'] }
              : null,
          ),
        },
      }),
    );
  });
  vi.stubGlobal('fetch', fetcher);
  const off = createProductionExecutionRouter({
    rpcUrl: 'https://fixture.invalid',
    rpcTimeoutMs: 1000,
    commitment: 'confirmed',
    nonSolPumpSwapEnabled: true,
    nonSolPumpSwapRoutes: APPROVED_NON_SOL_PUMPSWAP_ROUTES,
  });
  await expect(off.mintResolver!(s.mint)).rejects.toThrow('NON_SOL_NOT_ALLOWLISTED');
  expect(fetcher).toHaveBeenCalledTimes(1);
  const replay = off.resolveVersion(identity.protocolId, state.adapterVersion);
  expect(await replay.simulateBuy({ ...req, requestedPaperSol: input }, state)).toEqual(original);
});

it('keeps recorded pre-bond exotic Pump/Orca outputs equal to the unchanged compiled baseline under generic ON', async () => {
  const raw = JSON.parse(
      readFileSync(new URL('./fixtures/operator-pump-orca.json', import.meta.url), 'utf8'),
    ),
    state = { ...raw, chainSlot: BigInt(raw.chainSlot) },
    before = JSON.parse(
      readFileSync(new URL('./fixtures/generic-prebond-before.json', import.meta.url), 'utf8'),
    );
  const router = createProductionExecutionRouter({
      rpcUrl: 'https://example.invalid',
      rpcTimeoutMs: 1000,
      commitment: 'confirmed',
      genericPumpSwapEnabled: true,
      genericPumpSwapBuysEnabled: true,
    }),
    adapter = router.resolveVersion(state.identity.protocolId, state.adapterVersion),
    rows = [];
  for (const input of [1000000n, 100000000n, 1000000000n, 10000000000n]) {
    const req = {
        identity: state.identity,
        orderId: identifier('prebond-parity', 'OrderId'),
        executionId: identifier('prebond-parity', 'ExecutionId'),
        executedAt: utcInstant(state.observedAt),
      },
      buy = await adapter.simulateBuy(
        { ...req, requestedPaperSol: paperSolBaseUnits(input) },
        state,
      ),
      value = await adapter.valuePositionForExit(
        { identity: state.identity, tokenQuantity: tokenBaseUnits(buy.actualOutput.amount) },
        state,
      );
    rows.push({ amount: input, buy, value });
  }
  expect(
    JSON.parse(JSON.stringify(rows, (_, v) => (typeof v === 'bigint' ? v.toString() : v))),
  ).toEqual(before.rows);
});
