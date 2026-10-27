import { describe, expect, it } from 'vitest';
import {
  CandidateError,
  quote,
  validateEvidence,
  valueForExit,
} from '../../candidates/simple-price-v1/model.js';
import type { Evidence } from '../../candidates/simple-price-v1/model.js';
import { DisposableSandbox } from '../../candidates/simple-price-v1/sandbox.js';
import {
  account,
  evidence,
  fixtureAccount,
  CUTOFF,
  POLICY,
  SOL,
  START,
  TOKEN,
} from './fixtures.js';
import { fingerprint } from '../../candidates/simple-price-v1/model.js';
import {
  buildHourlyLeaderboard,
  identifier,
  paperSolBaseUnits,
  paperSolDelta,
  utcInstant,
} from '@paperfund/core';

function reconcile(h: ReturnType<typeof fixtureAccount>) {
  const a = h.state();
  expect(a.cash + a.positions.reduce((s, p) => s + p.basis, 0n)).toBe(
    a.startingCash + a.realizedPnl,
  );
  expect(a.journals.every((j) => j.reduce((s, l) => s + l.delta, 0n) === 0n)).toBe(true);
}
describe('offline numerical financial acceptance — unchanged implementation', () => {
  it('starts at 10 SOL; 1 SOL BUY and immediate full exit agree with valuation', async () => {
    const h = fixtureAccount();
    expect(h.state().cash).toBe(10n * SOL);
    const b = await h.trade('BUY', SOL);
    expect(b.output).toBe(979_412_743_236n);
    expect(h.state().cash).toBe(9n * SOL);
    const equity = await h.sandbox.equity('acceptance-a');
    expect(equity).toBe(9_959_253_941n);
    const sell = await h.trade('SELL', 'ALL');
    expect(sell.output).toBe(959_253_941n);
    expect(h.state().cash).toBe(equity);
    expect(h.state().realizedPnl).toBe(-40_746_059n);
    reconcile(h);
  });
  it('sells 50% then all with proportional basis and explicit size effects', async () => {
    const h = fixtureAccount();
    const b = await h.trade('BUY', SOL);
    const fullValue = h.sellQuote(b.output).output;
    const first = await h.trade('SELL', b.output / 2n);
    expect(h.state().positions[0]!.basis).toBe(500_000_000n);
    const remaining = h.state().positions[0]!;
    expect(h.state().realizedPnl).toBe(first.output - 500_000_000n);
    const displayed = await h.sandbox.equity('acceptance-a');
    const second = await h.trade('SELL', 'ALL');
    expect(second.output).toBe(h.sellQuote(remaining.quantity).output);
    expect(h.state().cash).toBe(displayed);
    // Splitting legitimately avoids some convex size loss; this is not an integer mistake.
    expect(first.output + second.output).toBeGreaterThan(fullValue);
    expect(first.output + second.output).toBeLessThan(b.input);
    expect(h.state().realizedPnl).toBe(first.output + second.output - b.input);
    reconcile(h);
  });
  it('repeated BUYs retain exact weighted AVG basis; partial SELL rounding is bounded', async () => {
    const h = fixtureAccount();
    const a = await h.trade('BUY', SOL);
    h.setPrice(TOKEN.mint, 2n);
    const b = await h.trade('BUY', SOL / 2n);
    const p = h.state().positions[0]!;
    expect(p.basis).toBe(a.input + b.input);
    expect(p.quantity).toBe(a.output + b.output);
    // AVG = basis/quantity (lamports/base-unit), exact ratio, not average of order prices.
    expect(p.basis).toBe(1_500_000_000n);
    expect(p.quantity).toBe(1_225_472_102_125n);
    const sold = p.quantity / 2n;
    const removed = (p.basis * sold) / p.quantity;
    await h.trade('SELL', sold);
    const left = h.state().positions[0]!;
    expect(left.basis).toBe(p.basis - removed);
    const beforeCross = p.basis * left.quantity,
      afterCross = left.basis * p.quantity;
    expect(afterCross - beforeCross).toBeGreaterThanOrEqual(0n);
    expect(afterCross - beforeCross).toBeLessThan(p.quantity);
    reconcile(h);
  });
  it.each([
    ['increase', 2n],
    ['decrease', 1n],
  ] as const)('records %s realized and unrealized P&L', async (direction, next) => {
    const h = fixtureAccount();
    h.setPrice(TOKEN.mint, direction === 'decrease' ? 2n : 1n);
    await h.trade('BUY', SOL);
    const p = h.state().positions[0]!;
    h.setPrice(TOKEN.mint, next);
    const value = h.sellQuote(p.quantity).output,
      unrealized = value - p.basis;
    expect(h.state().realizedPnl).toBe(0n);
    expect((await h.sandbox.equity('acceptance-a')) - 10n * SOL).toBe(unrealized);
    if (direction === 'increase') expect(unrealized).toBeGreaterThan(0n);
    else expect(unrealized).toBeLessThan(0n);
    await h.trade('SELL', 'ALL');
    expect(h.state().realizedPnl).toBe(unrealized);
    reconcile(h);
  });
  it('values distinct tokens and enforces an equity-based 20% restriction', async () => {
    const h = fixtureAccount(),
      other = { ...TOKEN, mint: 'token-b', market: 'market-b' };
    await h.trade('BUY', SOL);
    await h.trade('BUY', SOL, other);
    h.setPrice(TOKEN.mint, 2n);
    const a = h.state(),
      values = a.positions.map((p) => h.sellQuote(p.quantity, p.identity).output);
    const equity = a.cash + values.reduce((s, v) => s + v, 0n);
    expect(await h.sandbox.equity('acceptance-a')).toBe(equity);
    const cap = (equity * 2000n) / 10_000n,
      before = h.state();
    await expect(h.trade('BUY', cap + 1n)).rejects.toThrow('MAX_BUY_RATIO_EXCEEDED');
    expect(h.state()).toEqual(before);
    await h.trade('BUY', cap);
    reconcile(h);
  });
  it('keeps five consumed slots after exits and permits same-token rebuy', async () => {
    const h = fixtureAccount();
    for (let i = 0; i < 5; i++)
      await h.trade('BUY', 10_000_000n, { ...TOKEN, mint: `token-${i}`, market: `market-${i}` });
    const before = h.state();
    await expect(h.trade('BUY', SOL)).rejects.toThrow('TOKEN_SLOT_LIMIT_REACHED');
    expect(h.state()).toEqual(before);
    const prior = before.positions[0]!.identity;
    await h.trade('SELL', 'ALL', prior);
    await h.trade('BUY', 10_000_000n, prior);
    expect(h.state().slots).toHaveLength(5);
    reconcile(h);
  });
  it('serializes rapid BUY/SELL orders and replays duplicates without a second posting', async () => {
    const h = fixtureAccount();
    await Promise.all(Array.from({ length: 8 }, () => h.trade('BUY', 10_000_000n)));
    const p = h.state().positions[0]!,
      q = p.quantity / 16n;
    await Promise.all(Array.from({ length: 8 }, () => h.trade('SELL', q)));
    const first = await h.trade('BUY', 10_000_000n, TOKEN, 'duplicate'),
      before = h.state();
    const again = await h.trade('BUY', 10_000_000n, TOKEN, 'duplicate');
    expect(again).toEqual(first);
    expect(h.state()).toEqual(before);
    await expect(h.trade('BUY', 20_000_000n, TOKEN, 'duplicate')).rejects.toThrow(
      'IDEMPOTENCY_CONFLICT',
    );
    expect(h.state()).toEqual(before);
    reconcile(h);
  });
  it('rolls back an unavailable-source order and allows the same key after evidence recovers', async () => {
    const h = fixtureAccount();
    const before = h.state();
    h.alterEvidence((e) => ({ ...e, observations: [] }));
    await expect(h.trade('BUY', SOL, TOKEN, 'failed-key')).rejects.toThrow(
      'PRICE_QUORUM_UNAVAILABLE',
    );
    expect(h.state()).toEqual(before);
    h.alterEvidence((e) => e);
    await h.trade('BUY', SOL, TOKEN, 'failed-key');
    reconcile(h);
  });
});
describe('competition, rounding and source safety', () => {
  it('10 repeated BUY/SELL cycles cannot mint cash at an unchanged price', async () => {
    const h = fixtureAccount();
    for (let i = 0; i < 10; i++) {
      const before = h.state().cash;
      await h.trade('BUY', SOL / 10n);
      await h.trade('SELL', 'ALL');
      expect(h.state().cash).toBeLessThan(before);
    }
    reconcile(h);
  });
  it('has no positive immediate P&L across tiny/large sizes and cost parameters', () => {
    for (const fee of [0n, 1n, 100n, 9000n])
      for (const spread of [0n, 10n, 500n, 9000n])
        for (const amount of [1n, 1000n, SOL, 2n * SOL, 10n ** 26n]) {
          const e = evidence();
          Object.assign(e, { fees: [{ category: 'fee', bps: fee }] });
          Object.assign(e.quality, { baseSpreadBps: spread });
          try {
            const buy = quote('BUY', amount, e, TOKEN, START, POLICY);
            expect(buy.input).toBeLessThanOrEqual(amount);
            try {
              expect(quote('SELL', buy.output, e, TOKEN, START, POLICY).output).toBeLessThanOrEqual(
                buy.input,
              );
            } catch (error) {
              expect(error).toBeInstanceOf(CandidateError);
              expect((error as CandidateError).code).toBe('ZERO_OUTPUT');
            }
          } catch (error) {
            expect(error).toBeInstanceOf(CandidateError);
            expect((error as CandidateError).code).toBe('ZERO_OUTPUT');
          }
        }
  });
  it('quantifies legitimate split benefits and bounds all proceeds below coherent mark', () => {
    const e = evidence(),
      buy = quote('BUY', SOL, e, TOKEN, START, POLICY);
    const whole = quote('SELL', buy.output, e, TOKEN, START, POLICY),
      half = buy.output / 2n;
    const sum =
      quote('SELL', half, e, TOKEN, START, POLICY).output +
      quote('SELL', buy.output - half, e, TOKEN, START, POLICY).output;
    expect(sum).toBeGreaterThan(whole.output);
    expect(sum).toBeLessThan(buy.input);
    expect(sum).toBeLessThanOrEqual(buy.output / 1000n);
    // At effectively infinite depth with zero spread/fees, any split excess can only be zero.
    Object.assign(e.quality, { depthLamports: 10n ** 40n, baseSpreadBps: 0n });
    Object.assign(e, { fees: [{ category: 'fee', bps: 0n }] });
    const full = quote('SELL', buy.output, e, TOKEN, START, POLICY).output;
    const parts =
      quote('SELL', half, e, TOKEN, START, POLICY).output +
      quote('SELL', buy.output - half, e, TOKEN, START, POLICY).output;
    expect(parts).toBeLessThanOrEqual(full);
  });
  it('uses fee-exclusive prices; applying costs to an all-in reference quote would double-charge', () => {
    const clean = evidence();
    Object.assign(clean.quality, { depthLamports: 10n ** 30n, baseSpreadBps: 0n });
    const buy = quote('BUY', SOL, clean, TOKEN, START, POLICY);
    const incorrectlyAllIn = structuredClone(clean);
    incorrectlyAllIn.observations.forEach((o) =>
      Object.assign(o, { price: { n: buy.input, d: buy.output } }),
    );
    const duplicated = quote('BUY', SOL, incorrectlyAllIn, TOKEN, START, POLICY);
    expect(duplicated.output).toBeLessThan(buy.output);
    expect(buy.input).toBe(buy.gross + buy.fees[0]!.amount);
    // The candidate's schema cannot determine whether a registered provider already included costs.
    expect(() => validateEvidence(incorrectlyAllIn, TOKEN, START, POLICY)).not.toThrow();
  });
  it('rejects unsupported price providers before equity or financial mutation', async () => {
    const h = fixtureAccount();
    await h.trade('BUY', SOL);
    const before = h.state();
    h.alterEvidence((e) => ({
      ...e,
      observations: e.observations.map((o) => ({ ...o, source: 'unverified-chart' })),
    }));
    await expect(h.sandbox.equity('acceptance-a')).rejects.toThrow('UNTRUSTED_SOURCE');
    await expect(h.trade('SELL', 'ALL')).rejects.toThrow('UNTRUSTED_SOURCE');
    expect(h.state()).toEqual(before);
  });
  it('rejects disagreeing manipulation and extreme changes beyond the fixture threshold', async () => {
    const h = fixtureAccount();
    await h.trade('BUY', SOL);
    const before = h.state();
    h.alterEvidence((e) => ({
      ...e,
      observations: e.observations.map((o, i) => ({ ...o, price: { n: i ? 20n : 1n, d: 1000n } })),
    }));
    await expect(h.trade('SELL', 'ALL')).rejects.toThrow('CONTRADICTORY_PRICE');
    expect(h.state()).toEqual(before);
    h.alterEvidence((e) => e);
    h.setPrice(TOKEN.mint, 4n);
    await expect(h.trade('SELL', 'ALL')).rejects.toThrow('CONTRADICTORY_PRICE');
    expect(h.state()).toEqual(before);
  });
  it('documents remaining correlated-pool manipulation risk rather than claiming protection', async () => {
    const h = fixtureAccount();
    await h.trade('BUY', SOL);
    // Two registered services can report the same manipulated pool price inside the loose test band.
    h.setPrice(TOKEN.mint, 2n);
    const full = h.sellQuote(h.state().positions[0]!.quantity).output;
    expect(full).toBeGreaterThan(SOL);
    expect(await h.sandbox.equity('acceptance-a')).toBeGreaterThan(10n * SOL);
    expect(h.state().realizedPnl).toBe(0n); // This is exactly why provider economic independence is a gate.
  });
  it('keeps account/round/legacy versions separate and cannot carry cash between rounds', async () => {
    const h = fixtureAccount();
    const future = account('account-next', 'owner-a', 'round-next');
    future.startsAtMs = CUTOFF;
    future.endsAtMs = CUTOFF + 3_600_000;
    h.sandbox.add(future);
    const next = h.sandbox.read('account-next');
    await h.trade('BUY', SOL);
    expect(h.sandbox.read('account-next')).toEqual(next);
    await expect(
      h.sandbox.execute({
        owner: 'owner-a',
        account: 'account-next',
        round: 'round-next',
        key: 'too-early',
        identity: TOKEN,
        side: 'BUY',
        amount: SOL,
      }),
    ).rejects.toThrow('ROUND_NOT_OPEN');
    await expect(
      h.sandbox.execute({
        owner: 'owner-a',
        account: 'acceptance-a',
        round: 'round-next',
        key: 'wrong-round',
        identity: TOKEN,
        side: 'BUY',
        amount: SOL,
      }),
    ).rejects.toThrow('ACCOUNT_SCOPE_MISMATCH');
    const old = account('legacy', 'owner-a', 'round-old');
    old.modelVersion = 'old-pool-model';
    h.sandbox.add(old);
    await expect(h.sandbox.equity('legacy')).rejects.toThrow('MODEL_VERSION_MISMATCH');
    expect(h.sandbox.read('legacy')).toEqual(old);
    h.setNow(CUTOFF);
    await h.sandbox.settle('acceptance-a', 1, 3);
    expect(h.sandbox.read('account-next').cash).toBe(10n * SOL);
    await h.sandbox.execute({
      owner: 'owner-a',
      account: 'account-next',
      round: 'round-next',
      key: 'next-round',
      identity: TOKEN,
      side: 'BUY',
      amount: SOL,
    });
    expect(h.sandbox.read('account-next').cash).toBe(9n * SOL);
  });
  it('rejects the previously reproduced conversion chronology regression', () => {
    const i = { ...TOKEN, quote: 'QUOTE' },
      before = evidence(i);
    const fxIdentity = { mint: 'QUOTE', quote: 'SOL', market: 'conversion:QUOTE' };
    const fx = evidence(fxIdentity);
    fx.observations.forEach((o) => Object.assign(o, { price: { n: 10n, d: 1n } }));
    Object.assign(before, {
      conversion: { price: { n: 10n, d: 1n }, observations: fx.observations },
    });
    const current = structuredClone(before);
    current.conversion!.observations.forEach((o) =>
      Object.assign(o, { slot: 0n, observedAtMs: START - 1 }),
    );
    // The approved candidate-only correction applies the same cursor guard to conversion feeds.
    expect(() => validateEvidence(current, i, START, POLICY, before)).toThrow(
      'REGRESSING_EVIDENCE',
    );
  });
});
describe('UTC cutoff and settlement financial acceptance', () => {
  it('retains a sub-lamport position explicitly, including its unresolved equity and settlement', async () => {
    const h = fixtureAccount();
    const b = await h.trade('BUY', SOL);
    await h.trade('SELL', b.output - 1n);
    expect(h.state().positions[0]!.quantity).toBe(1n);
    expect(h.state().positions[0]!.basis).toBe(1n);
    await expect(h.sandbox.equity('acceptance-a')).rejects.toThrow('ZERO_OUTPUT');
    const before = h.state();
    h.setNow(CUTOFF);
    for (let attempt = 1; attempt <= 3; attempt++)
      await h.sandbox.settle('acceptance-a', attempt, 3);
    expect(h.state()).toEqual({ ...before, state: 'SETTLING' });
    expect(h.sandbox.readSettlementAudit('acceptance-a').at(-1)!.state).toBe('REVIEW_REQUIRED');
  });
  it('passes the exact settled result to the existing pure leaderboard and blocks unsettled results', async () => {
    const h = fixtureAccount();
    await h.trade('BUY', SOL);
    h.setNow(CUTOFF);
    await h.sandbox.settle('acceptance-a', 1, 3);
    const a = h.state(),
      round = {
        id: identifier(a.round, 'HourlyRoundId'),
        state: 'FINALIZED' as const,
        startsAt: utcInstant(START),
        endsAtExclusive: utcInstant(CUTOFF),
        configurationVersion: POLICY.version,
      };
    const result = {
      hourlyRoundId: round.id,
      competitionAccountId: identifier(a.id, 'CompetitionAccountId'),
      userId: identifier(a.owner, 'UserId'),
      finalSettledPaperSol: paperSolBaseUnits(a.cash),
      pnl: paperSolDelta(a.cash - a.startingCash),
      finalizedAt: utcInstant(CUTOFF),
    };
    const leaderboard = buildHourlyLeaderboard({ round, results: [result], winnerCount: 10 });
    expect(leaderboard.ok).toBe(true);
    if (leaderboard.ok)
      expect(leaderboard.leaderboard.rankGroups[0]!.results[0]!.pnl).toBe(a.realizedPnl);
    expect(
      buildHourlyLeaderboard({
        round: { ...round, state: 'SETTLING' },
        results: [result],
        winnerCount: 10,
      }),
    ).toEqual({ ok: false, reason: 'HOURLY_RESULT_NOT_FINALIZED' });
  });
  it('ordinary full SELL and forced SELL produce identical balances, P&L and journals', async () => {
    const user = fixtureAccount(),
      worker = fixtureAccount();
    await user.trade('BUY', SOL);
    await worker.trade('BUY', SOL);
    const equity = await worker.sandbox.equity('acceptance-a');
    await user.trade('SELL', 'ALL');
    worker.setNow(CUTOFF);
    expect((await worker.sandbox.settle('acceptance-a', 1, 3)).state).toBe('FINALIZED');
    expect(worker.state().cash).toBe(equity);
    expect(worker.state().cash).toBe(user.state().cash);
    expect(worker.state().realizedPnl).toBe(user.state().realizedPnl);
    expect(worker.state().journals).toEqual(user.state().journals);
    expect(worker.state().cash - worker.state().startingCash).toBe(worker.state().realizedPnl);
    reconcile(worker);
  });
  it('partial exit then forced close equals the same remaining-position valuation', async () => {
    const h = fixtureAccount();
    const b = await h.trade('BUY', SOL);
    await h.trade('SELL', b.output / 2n);
    const equity = await h.sandbox.equity('acceptance-a');
    h.setNow(CUTOFF);
    await h.sandbox.settle('acceptance-a', 1, 3);
    expect(h.state().cash).toBe(equity);
    expect(h.state().positions).toHaveLength(0);
    reconcile(h);
  });
  it.each(['missing', 'expired'] as const)(
    'holds %s evidence without write-off, fabricated result or duplicated workers',
    async (kind) => {
      const h = fixtureAccount();
      await h.trade('BUY', SOL);
      h.setNow(CUTOFF);
      h.alterEvidence((e) =>
        kind === 'missing'
          ? { ...e, observations: [] }
          : {
              ...e,
              observations: e.observations.map((o) => ({ ...o, observedAtMs: CUTOFF - 5001 })),
            },
      );
      const financialBefore = h.state();
      const [first, duplicate] = await Promise.all([
        h.sandbox.settle('acceptance-a', 1, 3),
        h.sandbox.settle('acceptance-a', 1, 3),
      ]);
      expect(first).toEqual(duplicate);
      expect(first.state).toBe('RETRY_PENDING');
      expect(h.state()).toEqual({ ...financialBefore, state: 'SETTLING' });
      await h.sandbox.settle('acceptance-a', 2, 3);
      expect((await h.sandbox.settle('acceptance-a', 3, 3)).state).toBe('REVIEW_REQUIRED');
      const hold = h.state();
      expect((await h.sandbox.settle('acceptance-a', 4, 3)).state).toBe('REVIEW_REQUIRED');
      expect(h.state()).toEqual(hold);
      expect(h.sandbox.readSettlementAudit('acceptance-a')).toHaveLength(3);
      expect(h.state().fills).toHaveLength(1);
      expect(h.state().positions).toHaveLength(1);
      reconcile(h);
    },
  );
  it('recovers a failed pass once reliable evidence returns within the existing retry budget', async () => {
    const h = fixtureAccount();
    await h.trade('BUY', SOL);
    h.setNow(CUTOFF);
    h.alterEvidence((e) => ({ ...e, observations: [] }));
    await h.sandbox.settle('acceptance-a', 1, 3);
    h.alterEvidence((e) => e);
    expect((await h.sandbox.settle('acceptance-a', 2, 3)).state).toBe('FINALIZED');
    const final = h.state();
    await h.sandbox.settle('acceptance-a', 2, 3);
    expect(h.state()).toEqual(final);
    reconcile(h);
  });
  it('blocks extreme cutoff movement and settles a corroborated movement within the fixture band', async () => {
    const h = fixtureAccount();
    await h.trade('BUY', SOL);
    h.setNow(CUTOFF);
    h.setPrice(TOKEN.mint, 4n);
    expect((await h.sandbox.settle('acceptance-a', 1, 3)).state).toBe('RETRY_PENDING');
    expect(h.state().positions).toHaveLength(1);
    h.setPrice(TOKEN.mint, 2n);
    const equity = await h.sandbox.equity('acceptance-a');
    await h.sandbox.settle('acceptance-a', 2, 3);
    expect(h.state().cash).toBe(equity);
    expect(h.state().realizedPnl).toBe(900_078_766n);
    reconcile(h);
  });
  it('retains successful token settlements when a separate token fails and never finalizes partial equity', async () => {
    const h = fixtureAccount(),
      b = { ...TOKEN, mint: 'token-b', market: 'market-b' };
    await h.trade('BUY', SOL);
    await h.trade('BUY', SOL, b);
    h.setNow(CUTOFF);
    h.alterEvidence((e) => (e.identity.mint === b.mint ? { ...e, observations: [] } : e));
    expect((await h.sandbox.settle('acceptance-a', 1, 3)).state).toBe('RETRY_PENDING');
    expect(h.state().positions).toHaveLength(1);
    expect(h.state().positions[0]!.identity).toEqual(b);
    const cash = h.state().cash,
      fillCount = h.state().fills.length;
    h.alterEvidence((e) => e);
    await h.sandbox.settle('acceptance-a', 2, 3);
    expect(h.state().cash).toBe(cash + 959_253_941n);
    expect(h.state().fills).toHaveLength(fillCount + 1);
    reconcile(h);
  });
  it('rejects stale snapshots after slow acquisition and retains the original accounting', async () => {
    let now = START;
    const sandbox = new DisposableSandbox(
      POLICY,
      async (ids) => {
        const captured = ids.map((i) => [fingerprint(i), evidence(i, now)] as const);
        now += 5001;
        return new Map(captured);
      },
      () => now,
    );
    sandbox.add(account());
    const before = sandbox.read('acceptance-a');
    await expect(
      sandbox.execute({
        owner: 'owner-a',
        account: 'acceptance-a',
        round: 'round-a',
        key: 'slow',
        identity: TOKEN,
        side: 'BUY',
        amount: SOL,
      }),
    ).rejects.toThrow('STALE_OR_INVALID_EVIDENCE');
    expect(sandbox.read('acceptance-a')).toEqual(before);
  });
  it('same non-SOL snapshot gives exact conversion, valuation and SELL proceeds', () => {
    const i = { ...TOKEN, quote: 'QUOTE' },
      e: Evidence = evidence(i),
      fx = evidence({ mint: 'QUOTE', market: 'conversion:QUOTE', quote: 'SOL' });
    fx.observations.forEach((o) => Object.assign(o, { price: { n: 7n, d: 3n } }));
    Object.assign(e, { conversion: { price: { n: 7n, d: 3n }, observations: fx.observations } });
    const b = quote('BUY', SOL, e, i, START, POLICY),
      s = quote('SELL', b.output, e, i, START, POLICY);
    expect(valueForExit(b.output, e, i, START, POLICY)).toBe(s.output);
    expect(s.output).toBeLessThan(b.input);
  });
});
