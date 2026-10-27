import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { type MarketState, createMarketStateEvidence } from '@paperfund/execution';
import { cpAmmCoder } from '@meteora-ag/cp-amm-sdk';
import {
  decodeMeteoraSwap,
  verifyNeutralReplay,
  applyMeteoraNumericalEvent,
  packetIdentity,
  compareExternalLocations,
  externalEvidenceHash,
  type ExternalPacket,
} from '../src/experimental/external-event-evidence.js';
import {
  createSequentialSimulation,
  transitionSequentialRoute,
} from '../src/experimental/sequential-route.js';
import type { CapturedAccount } from '../src/solana-routes.js';

interface Fixture {
  neutral: ExternalPacket;
  v1: ExternalPacket;
  failed: ExternalPacket;
  unsupportedPump: ExternalPacket;
  initial: { state: Omit<MarketState, 'chainSlot'> & { chainSlot: string }; fingerprint: string };
  pumpInitial: { state: Omit<MarketState, 'chainSlot'> & { chainSlot: string } };
}
const fixture = JSON.parse(
  readFileSync(new URL('./fixtures/external-event-evidence.json', import.meta.url), 'utf8'),
) as Fixture;
const initial = (): MarketState => ({
  ...structuredClone(fixture.initial.state),
  chainSlot: BigInt(fixture.initial.state.chainSlot),
});
const packet = () => structuredClone(fixture.neutral);
const replay = (state = initial(), p = packet()) =>
  verifyNeutralReplay(state, [p], [packetIdentity(p)], 'POOL_LOCAL_NUMERICAL');
const scope = { accountId: 'numerical-account', roundId: 'isolated-hour' };
function freeze<T>(v: T): T {
  if (v && typeof v === 'object') {
    for (const x of Object.values(v)) freeze(x);
    Object.freeze(v);
  }
  return v;
}
function base58(raw: Uint8Array) {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let n = BigInt('0x' + Buffer.from(raw).toString('hex')),
    s = '';
  while (n) {
    s = alphabet[Number(n % 58n)]! + s;
    n /= 58n;
  }
  let z = 0;
  while (raw[z] === 0) z++;
  return '1'.repeat(z) + s;
}
function mutateReceipt(p: ExternalPacket, work: (p: ExternalPacket) => void) {
  const mutable = structuredClone(p);
  work(mutable);
  return mutable;
}

describe('recorded external DAMM evidence', () => {
  it('cross-checks the recorded compounding invariant and fees with independent BigInt arithmetic', () => {
    const s = initial(),
      accounts = s.normalizedState['accounts'] as Record<string, CapturedAccount>,
      h = (s.normalizedState['hops'] as { pool: string }[])[0]!;
    const p = cpAmmCoder.accounts.decode<Record<string, unknown>>(
      'Pool',
      Buffer.from(accounts[h.pool]!.base64, 'base64'),
    );
    const n = (v: unknown) => BigInt(String(v)),
      fee = p['pool_fees'] as Record<string, unknown>,
      dynamic = fee['dynamic_fee'] as Record<string, unknown>;
    const baseFee = fee['base_fee'] as { base_fee_info: { data: number[] } };
    const ceil = (a: bigint, b: bigint) => (a + b - 1n) / b;
    const transfer = ceil(9388n * 20n, 10000n),
      net = 9388n - transfer;
    const gross = (net * n(p['token_b_amount'])) / (n(p['token_a_amount']) + net);
    const rate =
      Buffer.from(baseFee.base_fee_info.data).readBigUInt64LE(0) +
      ceil(
        n(dynamic['variable_fee_control']) *
          (n(dynamic['volatility_accumulator']) * n(dynamic['bin_step'])) ** 2n,
        100000000000n,
      );
    const charge = ceil(gross * rate, 1000000000n);
    expect(transfer).toBe(19n);
    expect(gross - charge).toBe(140798n);
    expect(decodeMeteoraSwap(s, packet())).toMatchObject({
      output: gross - charge,
      transferFee: transfer,
    });
  });
  it('binds the real swap to finalized block, CPI ancestry, pool/mints and token movement', () => {
    const p = freeze(packet()),
      copy = structuredClone(p),
      s = freeze(initial());
    const e = decodeMeteoraSwap(s, p);
    expect(e.outcome).toBe('SUCCESS');
    if (e.outcome !== 'SUCCESS') throw new Error('Expected swap');
    expect(e.pool).toBe('2bDQiRwzoeqLfZ2nQ8decjqhDyAp8f1kx8WW33jwhYXH');
    expect(e.inputMint).toBe(s.identity.tokenMint);
    expect(e.input).toBe(9388n);
    expect(e.transferFee).toBe(19n);
    expect(e.output).toBe(140798n);
    expect(e.location).toEqual({
      slot: 456106920n,
      transactionIndex: 395,
      outerIndex: 2,
      innerIndex: 14,
    });
    expect(e.program.historicalBinaryVersion).toBeNull();
    expect(e.program.codec).toBe('cp-amm-sdk-1.5.1');
    expect(e.rawHash).toBe(externalEvidenceHash(p));
    expect(e.rawEventBytes).toBeTruthy();
    expect(p).toEqual(copy);
  });
  it('decodes a genuine recorded version-1 transaction and event-CPI', () => {
    expect(fixture.v1.receipt.version).toBe(1);
    const e = decodeMeteoraSwap(initial(), freeze(structuredClone(fixture.v1)));
    expect(e.outcome).toBe('SUCCESS');
    if (e.outcome !== 'SUCCESS') throw new Error('Expected swap');
    expect(e.location.slot).toBe(BigInt(fixture.v1.receipt.slot));
    expect(e.location.outerIndex).toBe(1);
    expect(e.location.innerIndex).toBe(3);
    const first = decodeMeteoraSwap(initial(), packet());
    if (first.outcome !== 'SUCCESS') throw new Error('Expected swap');
    expect(compareExternalLocations(first.location, e.location)).toBeLessThan(0);
  });
  it('classifies a real failed version-1 receipt without creating an executable event', () => {
    expect(fixture.failed.receipt.meta.err).not.toBeNull();
    expect(decodeMeteoraSwap(initial(), fixture.failed)).toMatchObject({
      outcome: 'FAILED',
      stateChanging: false,
    });
    expect(() => replay(initial(), fixture.failed)).toThrow(/Failed/);
  });
  it('reproduces neutral reserve, fee and price evidence without changing inputs', () => {
    const s = freeze(initial()),
      p = freeze(packet()),
      before = structuredClone(s);
    expect(createMarketStateEvidence(s).fingerprint).toBe(fixture.initial.fingerprint);
    const result = replay(s, p);
    expect(result.transitions[0]!.output).toBe(140798n);
    expect(result.transitions[0]!.beforeFingerprint).not.toBe(
      result.transitions[0]!.afterFingerprint,
    );
    expect(result.sourceFingerprint).toBe(fixture.initial.fingerprint);
    expect(result.model).toBe('EXTERNAL_SWAP_NUMERICAL_V1');
    expect(result.financialUsePermitted).toBe(false);
    expect(result.limitations.length).toBeGreaterThan(0);
    expect(s).toEqual(before);
    expect(replay(s, p)).toEqual(result);
  });
  it('matches modeled external and later paper SELL amounts after a paper BUY without using Stage 2', () => {
    const s = initial(),
      market = s.identity.marketId,
      p = freeze(packet());
    const buy = transitionSequentialRoute(
      createSequentialSimulation(scope, [s]),
      scope,
      market,
      1000000000n,
      true,
    );
    expect(buy.quote.output).toBe(32327549n);
    const before = structuredClone(buy.next),
      external = applyMeteoraNumericalEvent(s, freeze(buy.next), p);
    expect(external.quote.details[0]!['inputTransferFee']).toBe('19');
    expect(external.quote.output).toBe(570912n);
    expect(buy.next).toEqual(before);
    const sell = transitionSequentialRoute(external.next, scope, market, buy.quote.output, false);
    expect(sell.quote.output).toBe(988609207n);
    expect(Object.keys(external.next)).not.toContain('cashLamports');
    expect(Object.keys(external.next)).not.toContain('positions');
  });
});

describe('explicit evidence and replay failures', () => {
  it('rejects omitted receipts, gaps in declared manifests and duplicates', () => {
    const s = freeze(initial()),
      p = freeze(packet()),
      copy = structuredClone(s),
      id = packetIdentity(p);
    expect(() => verifyNeutralReplay(s, [], [id], 'POOL_LOCAL_NUMERICAL')).toThrow(/incomplete/);
    expect(() => verifyNeutralReplay(s, [p], [id, 'missing'], 'POOL_LOCAL_NUMERICAL')).toThrow(
      /incomplete/,
    );
    expect(() => verifyNeutralReplay(s, [p], ['wrong'], 'POOL_LOCAL_NUMERICAL')).toThrow(
      /manifest/,
    );
    expect(() => verifyNeutralReplay(s, [p, p], [id, id], 'POOL_LOCAL_NUMERICAL')).toThrow(
      /Duplicate/,
    );
    expect(s).toEqual(copy);
  });
  it('rejects reversed actual chain ordering before advancing any state', () => {
    const p = packet(),
      later = structuredClone(fixture.v1),
      s = freeze(initial()),
      copy = structuredClone(s);
    expect(() =>
      verifyNeutralReplay(
        s,
        [later, p],
        [packetIdentity(later), packetIdentity(p)],
        'POOL_LOCAL_NUMERICAL',
      ),
    ).toThrow(/order/);
    expect(s).toEqual(copy);
  });
  it.each([
    'commitment',
    'slot',
    'blockhash',
    'transactionIndex',
    'loadedAddresses',
    'innerInstructions',
  ] as const)('rejects missing/contradictory %s', (field) => {
    const p = packet();
    if (field === 'commitment') Object.assign(p.block, { commitment: 'confirmed' });
    if (field === 'slot') Object.assign(p.receipt, { slot: p.receipt.slot + 1 });
    if (field === 'blockhash') Object.assign(p.block, { blockhash: '' });
    if (field === 'transactionIndex')
      Object.assign(p, { transactionIndex: p.transactionIndex + 1 });
    if (field === 'loadedAddresses')
      Object.assign(p.receipt.meta, { loadedAddresses: { writable: [], readonly: [] } });
    if (field === 'innerInstructions') Object.assign(p.receipt.meta, { innerInstructions: [] });
    expect(() => decodeMeteoraSwap(initial(), freeze(p))).toThrow();
  });
  it('rejects missing token dependencies and unknown transaction versions', () => {
    const s = initial(),
      accounts = s.normalizedState['accounts'] as Record<string, CapturedAccount>;
    delete accounts[s.identity.tokenMint];
    expect(() => decodeMeteoraSwap(s, packet())).toThrow(/dependency/);
    const p = packet();
    Object.assign(p.receipt, { version: 99 });
    expect(() => decodeMeteoraSwap(initial(), p)).toThrow(/version/);
  });
  it('rejects spoofed event authority, ancestry, pool identity and token-balance contradictions', () => {
    const mutations = [
      (p: ExternalPacket) =>
        Object.assign(p.receipt.meta.innerInstructions[0]!.instructions[14]!, { accounts: [0] }),
      (p: ExternalPacket) =>
        Object.assign(p.receipt.meta.innerInstructions[0]!.instructions[14]!, { stackHeight: 2 }),
      (p: ExternalPacket) =>
        Object.assign(p.receipt.meta.innerInstructions[0]!.instructions[11]!, { accounts: [0, 0] }),
      (p: ExternalPacket) =>
        Object.assign(
          p.receipt.meta.postTokenBalances.find((b) => b.accountIndex === 12)!.uiTokenAmount,
          { amount: '63751287' },
        ),
    ];
    for (const m of mutations) {
      const p = mutateReceipt(packet(), m),
        before = structuredClone(p);
      expect(() => decodeMeteoraSwap(initial(), freeze(p))).toThrow();
      expect(p).toEqual(before);
    }
  });
  it('rejects unsupported configuration calls and withheld/token operations', () => {
    const p = packet(),
      group = p.receipt.meta.innerInstructions[0]!;
    const unknown = { ...group.instructions[11]!, data: '111111111' };
    Object.assign(group, { instructions: [...group.instructions, unknown] });
    expect(() => decodeMeteoraSwap(initial(), p)).toThrow(/Unknown/);
    const token = packet(),
      ix = token.receipt.meta.innerInstructions[0]!.instructions[12]!;
    Object.assign(ix, { data: base58(Buffer.from([26, 4, 0, 0, 0, 0, 0, 0, 0, 0])) });
    expect(() => decodeMeteoraSwap(initial(), token)).toThrow(/Token/);
  });
  it('rejects transfer amount contradictions without accepting timestamps as identity', () => {
    const p = packet(),
      bytes = Buffer.alloc(10);
    bytes[0] = 12;
    bytes.writeBigUInt64LE(9389n, 1);
    bytes[9] = 9;
    Object.assign(p.receipt.meta.innerInstructions[0]!.instructions[12]!, { data: base58(bytes) });
    expect(() => decodeMeteoraSwap(initial(), p)).toThrow(/transfer/);
  });
  it('keeps Pump multi-hop semantics explicitly unsupported', () => {
    const s = {
      ...structuredClone(fixture.pumpInitial.state),
      chainSlot: BigInt(fixture.pumpInitial.state.chainSlot),
    };
    expect(() => decodeMeteoraSwap(s, fixture.unsupportedPump)).toThrow(/Pump/);
  });
  it('rejects changed mint/withheld state and leaves sandbox input unchanged', () => {
    const s = initial(),
      world = createSequentialSimulation(scope, [s]),
      m = s.identity.tokenMint;
    const accounts = world.accounts as Record<string, CapturedAccount>,
      raw = Buffer.from(accounts[m]!.base64, 'base64');
    raw[raw.length - 1] = raw[raw.length - 1]! ^ 1;
    accounts[m] = { ...accounts[m]!, base64: raw.toString('base64') };
    const before = structuredClone(world);
    expect(() => applyMeteoraNumericalEvent(s, freeze(world), packet())).toThrow();
    expect(world).toEqual(before);
  });
  it('rejects an altered pool configuration rather than resetting it', () => {
    const s = initial(),
      world = createSequentialSimulation(scope, [s]),
      h = (s.normalizedState['hops'] as { pool: string }[])[0]!;
    const accounts = world.accounts as Record<string, CapturedAccount>,
      raw = Buffer.from(accounts[h.pool]!.base64, 'base64');
    const p = cpAmmCoder.accounts.decode<Record<string, unknown>>('Pool', raw);
    p['liquidity'] = (p['liquidity'] as { addn: (n: number) => unknown }).addn(1);
    const layout = (
      cpAmmCoder.accounts as unknown as {
        accountLayouts: Map<string, { layout: { encode: (v: unknown, b: Buffer) => number } }>;
      }
    ).accountLayouts.get('Pool')!.layout;
    layout.encode(p, raw.subarray(8));
    accounts[h.pool] = { ...accounts[h.pool]!, base64: raw.toString('base64') };
    const before = structuredClone(world);
    expect(() => applyMeteoraNumericalEvent(s, freeze(world), packet())).toThrow(/configuration/);
    expect(world).toEqual(before);
  });
  it('rejects impossible counterfactual capacity without emitting a partial transition', () => {
    const s = initial(),
      world = createSequentialSimulation(scope, [s]),
      h = (s.normalizedState['hops'] as { pool: string }[])[0]!;
    const accounts = world.accounts as Record<string, CapturedAccount>,
      raw = Buffer.from(accounts[h.pool]!.base64, 'base64');
    const p = cpAmmCoder.accounts.decode<Record<string, unknown>>('Pool', raw);
    p['token_b_amount'] = (p['token_b_amount'] as { sub: (v: unknown) => unknown }).sub(
      p['token_b_amount'],
    );
    const layout = (
      cpAmmCoder.accounts as unknown as {
        accountLayouts: Map<string, { layout: { encode: (v: unknown, b: Buffer) => number } }>;
      }
    ).accountLayouts.get('Pool')!.layout;
    layout.encode(p, raw.subarray(8));
    accounts[h.pool] = { ...accounts[h.pool]!, base64: raw.toString('base64') };
    const before = structuredClone(world);
    expect(() => applyMeteoraNumericalEvent(s, freeze(world), packet())).toThrow();
    expect(world).toEqual(before);
  });
  it('rejects financial-use requests while initial fork and dependency completeness remain unknown', () => {
    expect(() =>
      verifyNeutralReplay(
        initial(),
        [packet()],
        [packetIdentity(packet())],
        'FINANCIAL_RECONCILIATION',
      ),
    ).toThrow(/not established/);
    expect(
      readFileSync(
        new URL('../src/experimental/external-event-evidence.ts', import.meta.url),
        'utf8',
      ),
    ).not.toMatch(/sequential-state|financial-service|DisposableSequentialStore/);
    expect(readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')).not.toMatch(
      /external-event-evidence/,
    );
  });
});
