import { describe, expect, it } from 'vitest';
import {
  CANDIDATE_ENABLED,
  MODEL_VERSION,
  fingerprint,
  quote,
  replayFill,
  settlementFailure,
  validateEvidence,
  valueForExit,
} from './model.js';
import type { Evidence, Identity, Policy } from './model.js';
import { DisposableSandbox } from './sandbox.js';
import type { SandboxAccount } from './sandbox.js';
import { captureVerifiedEvidence } from './sources.js';
import { asExecution } from './contract.js';
import { identifier } from '@paperfund/core';

const NOW = Date.parse('2026-10-13T12:00:00Z');
const identity: Identity = { mint: 'fixture-token', market: 'fixture-market', quote: 'SOL' };
const policy: Policy = {
  version: 'TEST_ONLY_UNAPPROVED',
  maxAgeMs: 5000,
  maxFutureMs: 1000,
  maxSkewMs: 2000,
  maxDiscrepancyBps: 300n,
  maxMovementBps: 20_000n,
  trustedSources: { chain: 'verified-chain', oracle: 'independent-publisher' },
  solQuote: 'SOL',
};
function evidence(i = identity, multiplier = 1n): Evidence {
  return {
    identity: i,
    observations: ['chain', 'oracle'].map((source) => ({
      source,
      upstream: policy.trustedSources[source]!,
      reference: `recorded-test:${source}`,
      observedAtMs: NOW,
      slot: 1n,
      price: { n: multiplier, d: 1000n },
      identity: i,
      tradeable: true,
    })),
    conversion: null,
    fees: [{ category: 'protocol', bps: 100n }],
    feeReference: 'recorded-test:fees',
    feeObservedAtMs: NOW,
    quality: {
      depthLamports: 100_000_000_000n,
      baseSpreadBps: 10n,
      reference: 'recorded-test:measured-quotes',
      observedAtMs: NOW,
    },
  };
}
function account(id = 'account-a', owner = 'owner-a', version = MODEL_VERSION): SandboxAccount {
  return {
    id,
    owner,
    round: 'round-1',
    modelVersion: version,
    state: 'OPEN',
    startsAtMs: NOW - 1000,
    endsAtMs: NOW + 1000,
    cash: 10_000_000_000n,
    startingCash: 10_000_000_000n,
    realizedPnl: 0n,
    positions: [],
    slots: [],
    fills: [],
    journals: [],
  };
}
function harness() {
  let now = NOW,
    priceSlot = 1n,
    multiplier = 1n,
    missing = false;
  const s = new DisposableSandbox(
    policy,
    async (ids) =>
      new Map(
        ids
          .map((i) => {
            const e = evidence(i, multiplier);
            e.observations.forEach((o) => Object.assign(o, { observedAtMs: now, slot: priceSlot }));
            Object.assign(e, { feeObservedAtMs: now });
            Object.assign(e.quality, { observedAtMs: now });
            return [fingerprint(i), e] as const;
          })
          .filter(() => !missing),
      ),
    () => now,
  );
  s.add(account());
  let key = 0;
  const trade = (side: 'BUY' | 'SELL', amount: bigint | 'ALL', i = identity, k = String(++key)) =>
    s.execute({
      owner: 'owner-a',
      account: 'account-a',
      round: 'round-1',
      key: k,
      identity: i,
      side,
      amount,
    });
  return {
    s,
    trade,
    time: (t: number) => {
      now = t;
    },
    price: (p: bigint) => {
      if (p !== multiplier) {
        now += 1;
        priceSlot += 1n;
      }
      multiplier = p;
    },
    unavailable: () => {
      missing = true;
    },
  };
}
describe('disabled simple price candidate math and evidence', () => {
  it('is disabled, deterministic and preserves exact spend and price evidence', () => {
    expect(CANDIDATE_ENABLED).toBe(false);
    const a = quote('BUY', 1_000_000_000n, evidence(), identity, NOW, policy);
    expect(a).toEqual(quote('BUY', 1_000_000_000n, evidence(), identity, NOW, policy));
    expect(a.input).toBeLessThanOrEqual(1_000_000_000n);
    expect(a.input).toBe(a.gross + a.fees.reduce((s, f) => s + f.amount, 0n));
    expect(a.evidenceHash).toBe(fingerprint(a.evidence));
    expect(a.output).toBe(979412743236n);
  });
  it('values precisely as the identical full SELL snapshot', () => {
    const buy = quote('BUY', 1_000_000_000n, evidence(), identity, NOW, policy);
    expect(valueForExit(buy.output, evidence(), identity, NOW, policy)).toBe(
      quote('SELL', buy.output, evidence(), identity, NOW, policy).output,
    );
  });
  it('replays archived fills and retains the existing normalized execution interface', () => {
    const f = quote('BUY', 1_000_000_000n, evidence(), identity, NOW, policy);
    expect(replayFill(f)).toEqual(f);
    const execution = asExecution(
      f,
      identifier('o', 'OrderId'),
      identifier('e', 'ExecutionId'),
      identifier('FIXTURE', 'ProtocolId'),
    );
    expect(execution.actualInput.amount).toBe(f.input);
    expect(execution.actualOutput.amount).toBe(f.output);
    expect(execution.quote.adapterVersion).toBe(MODEL_VERSION);
    expect(() => replayFill({ ...f, output: f.output + 1n })).toThrow('FILL_REPLAY_MISMATCH');
    const changed = structuredClone(f);
    Object.assign(changed.evidence.quality, { depthLamports: 1n });
    expect(() => replayFill(changed)).toThrow('EVIDENCE_CORRUPTED');
  });
  it('has size-dependent losses exceeding 5% with no reserve capacity cap', () => {
    const e = evidence();
    Object.assign(e.quality, { depthLamports: 1_000_000n });
    const small = quote('SELL', 100_000n, e, identity, NOW, policy);
    const large = quote('SELL', 100_000_000_000n, e, identity, NOW, policy);
    expect(large.output).toBeGreaterThan(0n);
    expect(large.spreadLossLamports * 20n).toBeGreaterThan(100_000_000n);
    expect(small.output * 100_000_000_000n).toBeGreaterThan(large.output * 100_000n);
  });
  it('does not mint free cash on unchanged-price round trips or with huge integers', () => {
    for (const size of [1000n, 1_000_000_000n, 10n ** 28n]) {
      const b = quote('BUY', size, evidence(), identity, NOW, policy);
      expect(quote('SELL', b.output, evidence(), identity, NOW, policy).output).toBeLessThan(size);
    }
  });
  it('has an independently calculable integer example and does not double-charge fees', () => {
    const e = evidence();
    e.observations.forEach((o) => Object.assign(o, { price: { n: 1n, d: 1n } }));
    Object.assign(e, { fees: [{ category: 'protocol', bps: 0n }] });
    Object.assign(e.quality, { depthLamports: 100n, baseSpreadBps: 0n });
    expect(quote('BUY', 100n, e, identity, NOW, policy).output).toBe(50n);
    expect(quote('SELL', 50n, e, identity, NOW, policy).output).toBe(33n);
    Object.assign(e, { fees: [{ category: 'protocol', bps: 1000n }] });
    const fill = quote('BUY', 110n, e, identity, NOW, policy);
    expect(fill.input).toBe(110n);
    expect(fill.gross).toBe(100n);
    expect(fill.output).toBe(50n);
    expect(fill.fees[0]!.amount).toBe(10n);
  });
  it('supports exact validated non-SOL conversion without assuming stablecoin parity', () => {
    const i = { ...identity, quote: 'USDC' },
      e = evidence(i);
    const fx = evidence({ mint: 'USDC', quote: 'SOL', market: 'conversion:USDC' });
    fx.observations.forEach((o) => Object.assign(o, { price: { n: 10n, d: 1n } }));
    Object.assign(e, { conversion: { price: { n: 10n, d: 1n }, observations: fx.observations } });
    expect(validateEvidence(e, i, NOW, policy)).toEqual({ n: 10n, d: 1000n });
    expect(quote('SELL', 1_000_000n, e, i, NOW, policy).output).toBeGreaterThan(
      quote('SELL', 1_000_000n, evidence(), identity, NOW, policy).output * 9n,
    );
    Object.assign(e.conversion!, { price: { n: 11n, d: 1n } });
    expect(() => quote('BUY', 1000n, e, i, NOW, policy)).toThrow('CONTRADICTORY_CONVERSION');
  });
  const invalid: [string, (e: Evidence) => void][] = [
    ['missing quorum', (e) => Object.assign(e, { observations: [] })],
    ['stale price', (e) => Object.assign(e.observations[0]!, { observedAtMs: NOW - 5001 })],
    ['future price', (e) => Object.assign(e.observations[0]!, { observedAtMs: NOW + 1001 })],
    [
      'wrong mint',
      (e) => Object.assign(e.observations[0]!, { identity: { ...identity, mint: 'wrong' } }),
    ],
    [
      'wrong quote',
      (e) => Object.assign(e.observations[0]!, { identity: { ...identity, quote: 'USD' } }),
    ],
    ['zero price', (e) => Object.assign(e.observations[0]!.price, { n: 0n })],
    ['negative denominator', (e) => Object.assign(e.observations[0]!.price, { d: -1n })],
    ['unverified chart', (e) => Object.assign(e.observations[0]!, { source: 'chart' })],
    [
      'same upstream',
      (e) => Object.assign(e.observations[1]!, { source: 'chain', upstream: 'verified-chain' }),
    ],
    ['untradeable', (e) => Object.assign(e.observations[0]!, { tradeable: false })],
    ['manipulated price', (e) => Object.assign(e.observations[1]!.price, { n: 50n })],
    ['snapshot skew', (e) => Object.assign(e.observations[0]!, { observedAtMs: NOW - 3000 })],
    ['missing fees', (e) => Object.assign(e, { fees: [] })],
    ['duplicate fee', (e) => Object.assign(e, { fees: [...e.fees, ...e.fees] })],
    ['100% fee', (e) => Object.assign(e, { fees: [{ category: 'fee', bps: 10_000n }] })],
    ['missing quality', (e) => Object.assign(e.quality, { depthLamports: 0n })],
    ['stale quality', (e) => Object.assign(e.quality, { observedAtMs: NOW - 5001 })],
    ['stale fees', (e) => Object.assign(e, { feeObservedAtMs: NOW - 5001 })],
    [
      'missing conversion',
      (e) =>
        Object.assign(e, {
          identity: { ...identity, quote: 'USDC' },
          observations: e.observations.map((o) => ({
            ...o,
            identity: { ...identity, quote: 'USDC' },
          })),
        }),
    ],
  ];
  it.each(invalid)('rejects %s', (_, edit) => {
    const e = evidence();
    edit(e);
    expect(() => quote('BUY', 1000n, e, e.identity, NOW, policy)).toThrow();
  });
  it('rejects regressing slots and quarantines extreme movement', () => {
    const prior = evidence(),
      current = evidence(identity, 4n);
    current.observations.forEach((o) => Object.assign(o, { observedAtMs: NOW + 1, slot: 2n }));
    expect(() =>
      quote('BUY', 1000n, current, identity, NOW, { ...policy, maxMovementBps: 1000n }, prior),
    ).toThrow('CONTRADICTORY_PRICE');
    current.observations.forEach((o) => Object.assign(o, { slot: 0n }));
    expect(() => quote('BUY', 1000n, current, identity, NOW, policy, prior)).toThrow(
      'REGRESSING_EVIDENCE',
    );
  });
  it.each([0n, -1n, 1n])('rejects invalid or microscopic amount %s', (amount) => {
    expect(() => quote('SELL', amount, evidence(), identity, NOW, policy)).toThrow();
  });
});
describe('disposable account regressions', () => {
  it('supports repeated BUY, partial SELL, SELL ALL and rebuy with retained slot', async () => {
    const h = harness();
    await h.trade('BUY', 1_000_000_000n);
    await h.trade('BUY', 500_000_000n);
    const before = h.s.read('account-a').positions[0]!;
    await h.trade('SELL', before.quantity / 4n);
    expect(h.s.read('account-a').positions[0]!.basis).toBe(
      before.basis - (before.basis * (before.quantity / 4n)) / before.quantity,
    );
    await h.trade('SELL', 'ALL');
    await h.trade('BUY', 1_000_000n);
    const a = h.s.read('account-a');
    expect(a.slots).toEqual([identity.mint]);
    expect(a.journals.every((j) => j.reduce((s, l) => s + l.delta, 0n) === 0n)).toBe(true);
  });
  it.each([2n, 1n])('tracks verified market price multiplier %s', async (multiplier) => {
    const h = harness();
    await h.trade('BUY', 1_000_000_000n);
    const old = await h.s.equity('account-a');
    h.price(multiplier);
    const next = await h.s.equity('account-a');
    if (multiplier === 2n) expect(next).toBeGreaterThan(old);
    else expect(next).toBe(old);
    await h.trade('SELL', 'ALL');
    expect(h.s.read('account-a').cash).toBe(next);
  });
  it('tracks a price fall', async () => {
    const h = harness();
    h.price(2n);
    await h.trade('BUY', 1_000_000_000n);
    const old = await h.s.equity('account-a');
    h.price(1n);
    expect(await h.s.equity('account-a')).toBeLessThan(old);
  });
  it('enforces 20% all-in cap before rounding', async () => {
    const h = harness();
    await expect(h.trade('BUY', 2_000_000_001n)).rejects.toThrow('MAX_BUY_RATIO_EXCEEDED');
    await h.trade('BUY', 2_000_000_000n);
    await expect(h.trade('BUY', 2_000_000_000n)).rejects.toThrow('MAX_BUY_RATIO_EXCEEDED');
  });
  it('serializes competing final slots and preserves rejected preimages', async () => {
    const h = harness();
    for (let j = 0; j < 4; j++)
      await h.trade('BUY', 1_000_000n, { ...identity, mint: `token-${j}`, market: `market-${j}` });
    const results = await Promise.allSettled(
      [4, 5].map((j) =>
        h.trade('BUY', 1_000_000n, { ...identity, mint: `token-${j}`, market: `market-${j}` }),
      ),
    );
    expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(h.s.read('account-a').slots).toHaveLength(5);
  });
  it('serializes duplicate BUY and SELL ALL and detects changed duplicate intent', async () => {
    const h = harness();
    const buys = await Promise.all([
      h.trade('BUY', 1_000_000_000n, identity, 'buy'),
      h.trade('BUY', 1_000_000_000n, identity, 'buy'),
    ]);
    expect(buys[0]).toEqual(buys[1]);
    expect(h.s.read('account-a').fills).toHaveLength(1);
    await expect(h.trade('BUY', 2_000_000n, identity, 'buy')).rejects.toThrow(
      'IDEMPOTENCY_CONFLICT',
    );
    const sells = await Promise.all([
      h.trade('SELL', 'ALL', identity, 'sell'),
      h.trade('SELL', 'ALL', identity, 'sell'),
    ]);
    expect(sells[0]).toEqual(sells[1]);
    expect(h.s.read('account-a').fills).toHaveLength(2);
  });
  it('isolates accounts and ownership', async () => {
    const h = harness();
    h.s.add(account('account-b', 'owner-b'));
    const preimage = h.s.read('account-b');
    await h.trade('BUY', 1_000_000n);
    expect(h.s.read('account-b')).toEqual(preimage);
    await expect(
      h.s.execute({
        owner: 'owner-a',
        account: 'account-b',
        round: 'round-1',
        key: 'x',
        identity,
        side: 'BUY',
        amount: 1n,
      }),
    ).rejects.toThrow('ACCOUNT_SCOPE_MISMATCH');
  });
  it('serializes concurrent full exits with different keys without duplicate cash', async () => {
    const h = harness();
    await h.trade('BUY', 1_000_000_000n);
    const equity = await h.s.equity('account-a');
    const results = await Promise.allSettled([h.trade('SELL', 'ALL'), h.trade('SELL', 'ALL')]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(h.s.read('account-a').cash).toBe(equity);
  });
  it('serializes rapid BUYs without overspending', async () => {
    const h = harness();
    const results = await Promise.allSettled(
      Array.from({ length: 12 }, () => h.trade('BUY', 1_700_000_000n)),
    );
    expect(results.some((r) => r.status === 'rejected')).toBe(true);
    const a = h.s.read('account-a');
    expect(a.cash).toBeGreaterThanOrEqual(0n);
    expect(a.cash + a.positions.reduce((s, p) => s + p.basis, 0n)).toBe(a.startingCash);
  });
  it('rejects an order whose evidence capture crosses the cutoff', async () => {
    let now = NOW;
    let release: () => void = () => undefined;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const s = new DisposableSandbox(
      policy,
      async (ids) => {
        await pending;
        return new Map(ids.map((i) => [fingerprint(i), evidence(i)]));
      },
      () => now,
    );
    s.add(account());
    const before = s.read('account-a');
    const order = s.execute({
      owner: 'owner-a',
      account: 'account-a',
      round: 'round-1',
      key: 'race',
      identity,
      side: 'BUY',
      amount: 1000n,
    });
    await Promise.resolve();
    await Promise.resolve();
    now = NOW + 1000;
    release();
    await expect(order).rejects.toThrow('ROUND_NOT_OPEN');
    expect(s.read('account-a')).toEqual(before);
  });
  it('serializes concurrent settlement passes and audits one attempt', async () => {
    const h = harness();
    await h.trade('BUY', 1_000_000n);
    h.time(NOW + 1000);
    const results = await Promise.all([
      h.s.settle('account-a', 1, 3),
      h.s.settle('account-a', 1, 3),
    ]);
    expect(results[0]).toEqual(results[1]);
    expect(h.s.read('account-a').fills).toHaveLength(2);
    expect(h.s.readSettlementAudit('account-a')).toHaveLength(1);
  });
  it('rejects incoherent multi-position equity snapshots atomically', async () => {
    let skew = false;
    const s = new DisposableSandbox(
      policy,
      async (ids) =>
        new Map(
          ids.map((i, index) => {
            const e = evidence(i);
            if (skew && index === 0)
              e.observations.forEach((o) => Object.assign(o, { observedAtMs: NOW - 3000 }));
            return [fingerprint(i), e];
          }),
        ),
      () => NOW,
    );
    s.add(account());
    const request = {
      owner: 'owner-a',
      account: 'account-a',
      round: 'round-1',
      identity,
      side: 'BUY' as const,
      amount: 1_000_000n,
    };
    await s.execute({ ...request, key: 'first' });
    skew = true;
    const before = s.read('account-a');
    await expect(
      s.execute({
        ...request,
        key: 'second',
        identity: { ...identity, mint: 'token-b', market: 'market-b' },
      }),
    ).rejects.toThrow('INCOHERENT_PORTFOLIO');
    expect(s.read('account-a')).toEqual(before);
  });
  it('rejects legacy model and preserves historical account', async () => {
    const h = harness();
    h.s.add(account('old', 'owner-a', 'legacy-pool-v1'));
    const before = h.s.read('old');
    await expect(
      h.s.execute({
        owner: 'owner-a',
        account: 'old',
        round: 'round-1',
        key: 'x',
        identity,
        side: 'BUY',
        amount: 1000n,
      }),
    ).rejects.toThrow('MODEL_VERSION_MISMATCH');
    await expect(h.s.settle('old', 1, 3)).rejects.toThrow('MODEL_VERSION_MISMATCH');
    expect(h.s.read('old')).toEqual(before);
  });
  it('force settles once using exactly the full-exit equity value', async () => {
    const h = harness();
    await h.trade('BUY', 1_000_000_000n);
    const equity = await h.s.equity('account-a');
    h.time(NOW + 1000);
    expect((await h.s.settle('account-a', 1, 3)).state).toBe('FINALIZED');
    expect(h.s.read('account-a').cash).toBe(equity);
    const a = h.s.read('account-a');
    await h.s.settle('account-a', 2, 3);
    expect(h.s.read('account-a')).toEqual(a);
  });
  it('bounds failed settlement retries with no write-off or final value', async () => {
    const h = harness();
    await h.trade('BUY', 1_000_000_000n);
    h.time(NOW + 1000);
    h.unavailable();
    expect((await h.s.settle('account-a', 1, 3)).state).toBe('RETRY_PENDING');
    const a = h.s.read('account-a');
    await h.s.settle('account-a', 2, 3);
    expect((await h.s.settle('account-a', 3, 3)).state).toBe('REVIEW_REQUIRED');
    expect((await h.s.settle('account-a', 4, 3)).state).toBe('REVIEW_REQUIRED');
    expect(h.s.readSettlementAudit('account-a')).toHaveLength(3);
    expect(h.s.read('account-a')).toEqual(a);
    expect(a.state).toBe('SETTLING');
    expect(a.positions).toHaveLength(1);
    expect(() => settlementFailure(0, 3, 'missing')).toThrow();
  });
  it('fails missing equity evidence atomically and rejects admission at cutoff', async () => {
    const h = harness();
    await h.trade('BUY', 1_000_000n);
    h.unavailable();
    const a = h.s.read('account-a');
    await expect(h.trade('BUY', 1_000_000n)).rejects.toThrow('PRICE_UNAVAILABLE');
    expect(h.s.read('account-a')).toEqual(a);
    h.time(NOW + 1000);
    await expect(h.trade('SELL', 'ALL')).rejects.toThrow('ROUND_NOT_OPEN');
  });
});
describe('server-only source acquisition', () => {
  it('binds provider provenance and clones evidence', async () => {
    const e = evidence();
    const providers = e.observations.map((o) => ({
      id: o.source,
      upstream: o.upstream,
      capture: async () => o,
    }));
    const captured = await captureVerifiedEvidence(
      identity,
      providers,
      { capture: async () => e },
      policy,
      () => NOW,
      1000,
    );
    expect(captured.observations).toEqual(e.observations);
    Object.assign(e.quality, { depthLamports: 1n });
    expect(captured.quality.depthLamports).toBe(100_000_000_000n);
  });
  it('bounds hung providers, even those ignoring abort', async () => {
    const providers = ['chain', 'oracle'].map((id) => ({
      id,
      upstream: policy.trustedSources[id]!,
      capture: () => new Promise<never>(() => undefined),
    }));
    await expect(
      captureVerifiedEvidence(
        identity,
        providers,
        { capture: async () => evidence() },
        policy,
        () => NOW,
        5,
      ),
    ).rejects.toThrow('PRICE_SOURCE_TIMEOUT');
  });
});
