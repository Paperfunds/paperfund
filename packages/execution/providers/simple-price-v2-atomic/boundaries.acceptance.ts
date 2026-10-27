import { it, expect, vi } from 'vitest';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { identifier, utcInstant } from '@paperfund/core';
import type { MarketState } from '@paperfund/execution';
import { AtomicMarketProvider, ATOMIC_POLICY } from './provider.js';
import type { AtomicCapture } from './provider.js';
import { assertAtomicReceipts, assertRealState } from './adapter.js';
import { quote as oldQuote } from '../../candidates/simple-price-v2/model.js';
import type { Evidence as OldEvidence } from '../../candidates/simple-price-v2/model.js';
import { quote, MODEL_VERSION } from '../../candidates/simple-price-v2-directional/model.js';
import { pack, PROTOCOL } from '../../integration/simple-price-v2-directional/adapter.js';
const root = 'artifacts/simple-price-v2-atomic-review/';
const numeric = new Set([
  'n',
  'd',
  'bps',
  'slot',
  'input',
  'output',
  'minInput',
  'maxInput',
  'lp',
  'protocol',
  'creator',
  'conversionFeePpm',
]);
const parse = (s: string) =>
  JSON.parse(s, (k, v: unknown) =>
    numeric.has(k) && typeof v === 'string' && /^-?\d+$/.test(v) ? BigInt(v) : v,
  );
function recorded(): AtomicCapture {
  const files = readdirSync(root)
    .filter((n) => /^api-results-\d+\.json$/.test(n))
    .sort()
    .reverse();
  for (const f of files) {
    const notes = parse(readFileSync(root + f, 'utf8')) as { captureAttempts?: AtomicCapture[] };
    const c = notes.captureAttempts?.find(
      (c) => c.provenance === 'REAL_READ_ONLY_ATOMIC_MAINNET' && !!c.genesis,
    );
    if (c) {
      c.referenceBudgets = c.referenceBudgets.map(BigInt);
      return c;
    }
  }
  throw new Error('REAL_ATOMIC_RECORDING_REQUIRED');
}
function state(c: AtomicCapture): MarketState {
  const e = c.evidence;
  return {
    identity: {
      protocolId: PROTOCOL,
      marketId: identifier(e.identity.market, 'MarketId'),
      tokenMint: identifier(e.identity.mint, 'TokenMint'),
    },
    adapterVersion: MODEL_VERSION,
    normalizationVersion: 'bounded-quote-price-proportional-net-v2',
    observedAt: utcInstant(e.observations[0]!.observedAtMs),
    chainSlot: e.observations[0]!.slot,
    chainBlockId: null,
    normalizedState: {
      fixtureOnly: true,
      fixtureLabel: 'DISPOSABLE_ACCOUNT_REAL_READ_ONLY_EVIDENCE',
      priceProvenance: 'REAL_READ_ONLY_ATOMIC_CANDIDATE',
      candidate: pack(e),
      policy: pack(ATOMIC_POLICY),
      atomicCapture: pack({ kind: 'NON_SOL', value: c }),
      positionQuantity: '0',
      peakQuantity: '0',
    },
  };
}
it('requires the configured Helius host without accepting an arbitrary credential destination', () => {
  vi.stubEnv('SOLANA_RPC_URL', 'https://unapproved.example/?api-key=TEST_ONLY');
  try {
    expect(() => new AtomicMarketProvider()).toThrow('CONFIGURED_HELIUS_REQUIRED');
  } finally {
    vi.unstubAllEnvs();
  }
});
it('requires a full original response with exact account bytes and matching context slot', () => {
  const c = recorded();
  expect(() => assertAtomicReceipts(c)).not.toThrow();
  for (const r of c.receipts)
    if (
      r.upstream.includes('helius') &&
      r.request.method === 'getMultipleAccounts' &&
      (r.request.params[0] as unknown[]).length >= 20
    ) {
      const body = r.body.result as { context: { slot: number } };
      body.context.slot++;
    }
  expect(() => assertAtomicReceipts(c)).toThrow('COMPLETE_ATOMIC_RECEIPT_REQUIRED');
});
it('rejects fabricated missing account bytes, provenance and changed candidate evidence', async () => {
  const c = recorded(),
    s = state(c);
  await expect(assertRealState(s)).resolves.toBeUndefined();
  Object.assign(s.normalizedState, { priceProvenance: 'SYNTHETIC' });
  await expect(assertRealState(s)).rejects.toThrow('REAL_PRICE_PROVENANCE_REQUIRED');
  const changed = state(c);
  Object.assign(c.evidence.observations[0]!.price, { n: c.evidence.observations[0]!.price.n + 1n });
  Object.assign(changed.normalizedState, { candidate: pack(c.evidence) });
  await expect(assertRealState(changed)).rejects.toThrow('REAL_CAPTURE_BINDING_MISMATCH');
  const missing = recorded();
  delete missing.observations[1]!.sourceState.accounts[
    missing.observations[1]!.sourceState.targetPool
  ];
  expect(() => assertAtomicReceipts(missing)).toThrow('COMPLETE_ATOMIC_RECEIPT_REQUIRED');
});
it('archived receipts support replay but cannot authorize a fresh execution price', () => {
  const e = recorded().evidence;
  expect(() => quote('BUY', 100000000n, e, e.identity, Date.now() + 6000, ATOMIC_POLICY)).toThrow(
    'STALE_OR_INVALID_EVIDENCE',
  );
});
it('all three original SOL captures retain exact before/after BUY and full/partial SELL values', () => {
  const rows = JSON.parse(
    readFileSync('artifacts/simple-price-v2-provider-review/live-markets.json', 'utf8'),
  ) as { label: string; capture: { evidence: unknown; receivedAtMs: number } }[];
  const results = [];
  for (const r of rows.slice(0, 3)) {
    const e = parse(JSON.stringify(r.capture.evidence)) as OldEvidence,
      now = r.capture.receivedAtMs,
      old = oldQuote('BUY', 1000000000n, e, e.identity, now, ATOMIC_POLICY),
      next = quote('BUY', 1000000000n, e, e.identity, now, ATOMIC_POLICY);
    expect(next).toEqual({ ...old, modelVersion: MODEL_VERSION });
    for (const q of [old.output, old.output / 2n]) {
      const a = oldQuote('SELL', q, e, e.identity, now, ATOMIC_POLICY, undefined, old.output),
        b = quote('SELL', q, e, e.identity, now, ATOMIC_POLICY, undefined, old.output);
      expect(b).toEqual({ ...a, modelVersion: MODEL_VERSION });
      results.push({
        label: r.label,
        buy: next.output,
        quantity: q,
        sell: b.output,
        fees: b.costs.fixedFeeLamports,
      });
    }
  }
  writeFileSync(
    root + 'sol-three-market-regressions.json',
    JSON.stringify(results, (_, v: unknown) => (typeof v === 'bigint' ? v.toString() : v), 2),
  );
  expect(results.length).toBe(6);
});
