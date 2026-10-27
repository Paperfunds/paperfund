/** Synthetic only: exercises financial plumbing; never promoted into real acquisition. */
import { synthetic, SOL } from './test-support.js';
import { snapshotHash } from './model.js';
import type { Evidence, Identity, Rational } from './model.js';
import { costHash, directionalBuy, directionalSell } from './costs.js';
export function directionalFixture(
  identity: Identity,
  now: number,
  buyPpm = 1600n,
  sellPpm = 1600n,
  price: Rational = { n: 1n, d: 50n },
): Evidence {
  const legacy = synthetic(identity, now, price, [], undefined, { n: 1n, d: 20n });
  const schedule = (ppm: bigint) => ({
    primary: [
      { category: 'PRIMARY_LP', bps: 20n },
      { category: 'PRIMARY_PROTOCOL', bps: 5n },
      { category: 'PRIMARY_CREATOR', bps: 300n },
    ],
    bridgeInputRate: { n: ppm, d: 1000000n },
    adaptive: true,
    proofs: legacy.observations.map((o) => ({
      source: o.source,
      upstream: o.upstream,
      reference: o.reference,
      slot: o.slot!,
      observedAtMs: o.observedAtMs,
      minInput: 1n,
      maxInput: 1000000000000n,
      rateMin: { n: ppm, d: 1000000n },
      rateMax: { n: ppm, d: 1000000n },
    })),
  });
  const e: Evidence = {
    ...legacy,
    directionalCosts: {
      convention: 'PUMPSWAP_QUOTE_CEIL_ORCA_INPUT_CEIL',
      route: [identity.market, 'SYNTHETIC_BRIDGE'],
      BUY: schedule(buyPpm),
      SELL: schedule(sellPpm),
    },
    calibration: {
      ...legacy.calibration,
      feeConvention: 'DIRECTIONAL_QUOTE_CEIL_INPUT_BRIDGE_V1',
      quotes: [],
    },
  };
  const p = { n: price.n, d: price.d * 20n },
    k = { n: 1n, d: 100n * SOL },
    qs = [];
  for (const budget of [SOL, SOL / 100n, 4n * SOL]) {
    const c = directionalBuy(budget, e),
      output = (c.notional * p.d * k.d) / (p.n * (k.d + k.n * c.notional));
    qs.push({
      ...legacy.calibration.quotes[0]!,
      side: 'BUY' as const,
      input: budget,
      output,
      reference: 'SYNTHETIC_DIRECTIONAL_BUY:' + budget + ':' + now,
      feesHash: costHash(e),
    });
  }
  for (const m of [SOL / 100n, SOL, 4n * SOL]) {
    const input = (m * p.d) / p.n,
      g = (m * k.d) / (k.d + k.n * m);
    qs.push({
      ...legacy.calibration.quotes[0]!,
      side: 'SELL' as const,
      input,
      output: directionalSell(g, e).net,
      reference: 'SYNTHETIC_DIRECTIONAL_SELL:' + m + ':' + now,
      feesHash: costHash(e),
    });
  }
  return { ...e, calibration: { ...e.calibration, quotes: qs, snapshotHash: snapshotHash(e) } };
}
