import { describe, it, expect, afterEach } from 'vitest';
import { rm } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { harness, synthetic, TOKEN, SOL, CUTOFF, account } from './test-support.js';
import { fingerprint, replayFill } from './model.js';
import type { SandboxAccount } from './sandbox.js';
const roots: string[] = [];
async function setup() {
  const h = await harness();
  roots.push(h.directory);
  return h;
}
afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (!resolve(root).startsWith(resolve(tmpdir()) + sep + 'paperfund-simple-v2-'))
      throw new Error('UNSAFE_TEST_CLEANUP');
    await rm(root, { recursive: true, force: true });
  }
});
function balance(a: SandboxAccount) {
  for (const j of a.journals) expect(j.reduce((s, l) => s + l.delta, 0n)).toBe(0n);
  expect(a.cash + a.positions.reduce((s, p) => s + p.basis, 0n)).toBe(
    a.startingCash + a.realizedPnl,
  );
  for (const fill of a.fills) expect(replayFill(fill)).toEqual(fill);
}
describe('private v2 accounting, peak net exits and settlement', () => {
  it('serializes rapid repeated acquisitions and duplicate concurrent intents', async () => {
    const h = await setup();
    await Promise.all(Array.from({ length: 8 }, () => h.trade('BUY', SOL / 10n)));
    const before = h.sandbox.read('a'),
      q = before.positions[0]!.quantity / 4n;
    const [a, b] = await Promise.all([
      h.trade('SELL', q, TOKEN, 'same-sell'),
      h.trade('SELL', q, TOKEN, 'same-sell'),
    ]);
    expect(a).toEqual(b);
    expect(h.sandbox.read('a').fills.length).toBe(9);
    await h.trade('SELL', 'ALL');
    expect(h.sandbox.read('a').cash).toBeLessThan(10n * SOL);
    balance(h.sandbox.read('a'));
  });
  it('immediate BUY/SELL exactly equals executable equity and loses costs', async () => {
    const h = await setup(),
      buy = await h.trade('BUY', SOL),
      equity = await h.sandbox.equity('a'),
      sell = await h.trade('SELL', 'ALL');
    expect(sell.input).toBe(buy.output);
    expect(h.sandbox.read('a').cash).toBe(equity);
    expect(sell.output).toBeLessThan(SOL);
    expect(h.sandbox.read('a').positions).toEqual([]);
    balance(h.sandbox.read('a'));
  });
  for (const count of [2, 100, 500])
    it(
      count + ' split exits cannot exceed one full exit',
      async () => {
        const h = await setup(),
          buy = await h.trade('BUY', SOL),
          full = (await h.sandbox.equity('a')) - 9n * SOL;
        const n = BigInt(count),
          base = buy.output / n,
          remainder = buy.output % n;
        let proceeds = 0n;
        for (let j = 0n; j < n; j++) {
          const sell = await h.trade('SELL', base + (j < remainder ? 1n : 0n));
          proceeds += sell.output;
          expect(sell.peakQuantity).toBe(buy.output);
        }
        expect(proceeds).toBeLessThanOrEqual(full);
        expect(full - proceeds).toBeLessThan(n);
        expect(h.sandbox.read('a').positions.length).toBe(0);
        balance(h.sandbox.read('a'));
      },
      30000,
    );
  it('refreshes the peak rate for genuine price rises and falls between partials', async () => {
    const h = await setup(),
      buy = await h.trade('BUY', SOL),
      q = buy.output / 4n;
    const first = await h.trade('SELL', q);
    h.move(TOKEN, { n: 2n, d: 1000n });
    const equity = await h.sandbox.equity('a'),
      second = await h.trade('SELL', q);
    expect(second.output).toBeGreaterThan(first.output);
    // Following same-price partial must not increase equity merely by fragmentation.
    expect(await h.sandbox.equity('a')).toBeLessThanOrEqual(equity);
    h.move(TOKEN, { n: 3n, d: 4000n });
    const before = await h.sandbox.equity('a'),
      last = await h.trade('SELL', 'ALL');
    expect(last.output).toBeLessThan(second.output * 2n);
    expect(h.sandbox.read('a').cash).toBe(before);
    balance(h.sandbox.read('a'));
  });
  it('repeated BUYs raise peak, partials do not reduce it, and closing resets the cycle', async () => {
    const h = await setup();
    await h.trade('BUY', SOL);
    await h.trade('BUY', SOL / 2n);
    let p = h.sandbox.read('a').positions[0]!;
    expect(p.basis).toBe((3n * SOL) / 2n);
    expect(p.peakQuantity).toBe(p.quantity);
    const peak = p.peakQuantity;
    await h.trade('SELL', p.quantity / 2n);
    await h.trade('BUY', SOL / 10n);
    p = h.sandbox.read('a').positions[0]!;
    expect(p.peakQuantity).toBe(peak);
    await h.trade('SELL', 'ALL');
    const b = await h.trade('BUY', SOL / 10n);
    expect(h.sandbox.read('a').positions[0]!.peakQuantity).toBe(b.output);
    expect(h.sandbox.read('a').slots).toEqual([TOKEN.mint]);
    balance(h.sandbox.read('a'));
  });
  it('rejects a repeated acquisition whose resulting peak exceeds validated SELL range atomically', async () => {
    const h = await setup();
    await h.trade('BUY', 2n * SOL);
    await h.trade('BUY', SOL);
    await h.trade('BUY', SOL);
    const before = h.sandbox.read('a');
    await expect(h.trade('BUY', SOL)).rejects.toThrow('UNSUPPORTED_SIZE_RANGE');
    expect(h.sandbox.read('a')).toEqual(before);
  });
  it('cross-token values remain isolated and BUY cap uses coherent net exit equity', async () => {
    const h = await setup(),
      other = { ...TOKEN, mint: 'synthetic-b', market: 'synthetic-market-b' };
    await h.trade('BUY', SOL);
    await h.trade('BUY', SOL, other);
    h.move(TOKEN, { n: 2n, d: 1000n });
    // Align the other evidence with the same time without changing its price.
    h.updates.set(other.mint, synthetic(other, h.now));
    const equity = await h.sandbox.equity('a'),
      before = h.sandbox.read('a');
    await expect(h.trade('BUY', equity / 5n + 1n, other)).rejects.toThrow('MAX_BUY_RATIO_EXCEEDED');
    expect(h.sandbox.read('a')).toEqual(before);
    const sold = await h.trade('SELL', 'ALL', other);
    expect(sold.evidence.identity.mint).toBe(other.mint);
    expect(sold.output).toBeLessThan(SOL);
    balance(h.sandbox.read('a'));
  });
  it('five slots remain consumed and a sixth token rejects without mutation', async () => {
    const h = await setup();
    for (let n = 0; n < 5; n++) {
      const i = { ...TOKEN, mint: 'slot-' + n, market: 'market-' + n };
      await h.trade('BUY', SOL / 10n, i);
      await h.trade('SELL', 'ALL', i);
    }
    const before = h.sandbox.read('a');
    await expect(h.trade('BUY', SOL / 10n)).rejects.toThrow('TOKEN_SLOT_LIMIT_REACHED');
    expect(h.sandbox.read('a')).toEqual(before);
    balance(before);
  });
  it('idempotency repeats the original fill even after movement; changed intent rejects', async () => {
    const h = await setup(),
      fill = await h.trade('BUY', SOL, TOKEN, 'same');
    h.move(TOKEN, { n: 2n, d: 1000n });
    const before = h.sandbox.read('a');
    expect(await h.trade('BUY', SOL, TOKEN, 'same')).toEqual(fill);
    expect(h.sandbox.read('a')).toEqual(before);
    await expect(h.trade('BUY', SOL / 2n, TOKEN, 'same')).rejects.toThrow('IDEMPOTENCY_CONFLICT');
  });
  it('missing and stale evidence preserve balances, basis and journals', async () => {
    const h = await setup();
    await h.trade('BUY', SOL);
    const before = h.sandbox.read('a');
    h.missing.add(TOKEN.mint);
    await expect(h.trade('SELL', 'ALL')).rejects.toThrow('PRICE_UNAVAILABLE');
    h.missing.clear();
    h.updates.set(TOKEN.mint, synthetic());
    h.time(h.now + 5001);
    await expect(h.trade('SELL', 'ALL')).rejects.toThrow('STALE_OR_INVALID_EVIDENCE');
    expect(h.sandbox.read('a')).toEqual(before);
  });
  it('normal and forced remainder exits use the same fresh peak rule and idempotent settlement', async () => {
    const h = await setup();
    const b = await h.trade('BUY', SOL);
    await h.trade('SELL', b.output / 2n);
    h.time(CUTOFF);
    h.updates.clear();
    const expected = await h.sandbox.equity('a');
    expect((await h.sandbox.settle('a', 1, 3)).state).toBe('FINALIZED');
    expect(h.sandbox.read('a').cash).toBe(expected);
    const before = h.sandbox.read('a');
    await h.sandbox.settle('a', 1, 3);
    expect(h.sandbox.read('a')).toEqual(before);
    balance(before);
  });
  it('temporary evidence failure recovers within retry budget; exhausted holds retain positions', async () => {
    const h = await setup();
    await h.trade('BUY', SOL);
    h.time(CUTOFF);
    h.missing.add(TOKEN.mint);
    expect((await h.sandbox.settle('a', 1, 3)).state).toBe('RETRY_PENDING');
    h.missing.clear();
    expect((await h.sandbox.settle('a', 2, 3)).state).toBe('FINALIZED');
    const held = await setup();
    await held.trade('BUY', SOL);
    held.time(CUTOFF);
    held.missing.add(TOKEN.mint);
    for (let n = 1; n <= 3; n++) await held.sandbox.settle('a', n, 3);
    held.missing.clear();
    const before = held.sandbox.read('a');
    expect((await held.sandbox.settle('a', 4, 3)).state).toBe('REVIEW_REQUIRED');
    expect(held.sandbox.read('a')).toEqual(before);
  });
  it('sub-lamport dust is an explicit review hold, never deleted or fabricated', async () => {
    const h = await setup();
    const b = await h.trade('BUY', SOL);
    await h.trade('SELL', b.output - 1n);
    expect(h.sandbox.read('a').positions[0]!.basis).toBe(1n);
    h.time(CUTOFF);
    h.updates.clear();
    const before = h.sandbox.read('a').cash;
    expect((await h.sandbox.settle('a', 1, 1)).state).toBe('REVIEW_REQUIRED');
    expect(h.sandbox.read('a').cash).toBe(before);
    expect(h.sandbox.read('a').positions[0]!.quantity).toBe(1n);
    balance(h.sandbox.read('a'));
  });
  it('synthetic non-SOL conversions preserve full provenance without assuming peg or universal fee', async () => {
    const h = await setup(),
      i = { ...TOKEN, quote: 'QUOTE' };
    h.updates.set(
      i.mint,
      synthetic(i, h.now, { n: 1n, d: 2000n }, [{ category: 'FIXTURE', bps: 80n }], undefined, {
        n: 2n,
        d: 1n,
      }),
    );
    const b = await h.trade('BUY', SOL, i);
    const s = await h.trade('SELL', 'ALL', i);
    expect(b.evidence.conversion!.price).toEqual({ n: 2n, d: 1n });
    expect(s.output).toBeLessThan(b.input);
    expect(s.evidenceHash).toBe(fingerprint(s.evidence));
    balance(h.sandbox.read('a'));
  });
  it('historical model, account owner and round mismatch reject; next-hour account starts independently', async () => {
    const h = await setup(),
      old = account('old');
    old.modelVersion = 'simple-price-candidate-v1';
    h.sandbox.add(old);
    await expect(h.sandbox.equity('old')).rejects.toThrow('MODEL_VERSION_MISMATCH');
    await expect(h.sandbox.settle('old', 1, 3)).rejects.toThrow('MODEL_VERSION_MISMATCH');
    await expect(
      h.sandbox.execute({
        owner: 'wrong',
        account: 'a',
        round: 'round-a',
        key: 'bad',
        identity: TOKEN,
        side: 'BUY',
        amount: SOL,
      }),
    ).rejects.toThrow('ACCOUNT_SCOPE_MISMATCH');
    h.sandbox.add(account('next', 'next-hour'));
    expect(h.sandbox.read('next').cash).toBe(10n * SOL);
  });
});
