import { MODEL_VERSION, fingerprint, quote } from '../../candidates/simple-price-v1/model.js';
import type { Evidence, Identity, Policy } from '../../candidates/simple-price-v1/model.js';
import { DisposableSandbox } from '../../candidates/simple-price-v1/sandbox.js';
import type { SandboxAccount } from '../../candidates/simple-price-v1/sandbox.js';

export const START = Date.parse('2026-10-13T12:00:00.000Z');
export const CUTOFF = START + 3_600_000;
export const SOL = 1_000_000_000n;
export const TOKEN: Identity = {
  mint: 'acceptance-token-a',
  market: 'acceptance-market-a',
  quote: 'SOL',
};
export const POLICY: Policy = {
  version: 'OFFLINE_ACCEPTANCE_UNAPPROVED',
  maxAgeMs: 5000,
  maxFutureMs: 1000,
  maxSkewMs: 2000,
  maxDiscrepancyBps: 300n,
  maxMovementBps: 20_000n,
  trustedSources: { chain: 'test-chain', independent: 'test-publisher' },
  solQuote: 'SOL',
};
export function evidence(identity = TOKEN, now = START, priceNumerator = 1n): Evidence {
  return {
    identity,
    observations: Object.entries(POLICY.trustedSources).map(([source, upstream]) => ({
      source,
      upstream,
      reference: `OFFLINE_FIXTURE:${source}`,
      observedAtMs: now,
      slot: BigInt(now),
      price: { n: priceNumerator, d: 1000n },
      identity,
      tradeable: true,
    })),
    conversion: null,
    fees: [{ category: 'TEST_PROTOCOL', bps: 100n }],
    feeReference: 'OFFLINE_FIXTURE:fees',
    feeObservedAtMs: now,
    quality: {
      depthLamports: 100n * SOL,
      baseSpreadBps: 10n,
      reference: 'UNAPPROVED_FIXED_TEST_SCALE_NOT_MEASURED_LIQUIDITY',
      observedAtMs: now,
    },
  };
}
export function account(id = 'acceptance-a', owner = 'owner-a', round = 'round-a'): SandboxAccount {
  return {
    id,
    owner,
    round,
    modelVersion: MODEL_VERSION,
    state: 'OPEN',
    startsAtMs: START,
    endsAtMs: CUTOFF,
    cash: 10n * SOL,
    startingCash: 10n * SOL,
    realizedPnl: 0n,
    positions: [],
    slots: [],
    fills: [],
    journals: [],
  };
}
export function fixtureAccount() {
  let now = START,
    key = 0;
  const prices = new Map<string, bigint>();
  let alteration: (e: Evidence) => Evidence = (e) => e;
  const sandbox = new DisposableSandbox(
    POLICY,
    async (identities) =>
      new Map(
        identities.map((i) => [
          fingerprint(i),
          alteration(evidence(i, now, prices.get(i.mint) ?? 1n)),
        ]),
      ),
    () => now,
  );
  sandbox.add(account());
  const trade = (
    side: 'BUY' | 'SELL',
    amount: bigint | 'ALL',
    identity = TOKEN,
    explicitKey?: string,
  ) =>
    sandbox.execute({
      owner: 'owner-a',
      account: 'acceptance-a',
      round: 'round-a',
      key: explicitKey ?? `order-${++key}`,
      identity,
      side,
      amount,
    });
  return {
    sandbox,
    trade,
    state: () => sandbox.read('acceptance-a'),
    setNow: (at: number) => {
      now = at;
    },
    setPrice: (mint: string, n: bigint) => {
      if (n !== (prices.get(mint) ?? 1n)) now += 1;
      prices.set(mint, n);
    },
    alterEvidence: (edit: (e: Evidence) => Evidence) => {
      alteration = edit;
    },
    evidence: (i = TOKEN) => alteration(evidence(i, now, prices.get(i.mint) ?? 1n)),
    sellQuote: (quantity: bigint, i = TOKEN) =>
      quote(
        'SELL',
        quantity,
        alteration(evidence(i, now, prices.get(i.mint) ?? 1n)),
        i,
        now,
        POLICY,
      ),
  };
}
export function money(value: bigint): string {
  const sign = value < 0n ? '-' : '',
    amount = value < 0n ? -value : value;
  return `${sign}${amount / SOL}.${(amount % SOL).toString().padStart(9, '0')}`;
}
