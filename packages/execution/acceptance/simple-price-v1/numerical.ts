import { writeFileSync } from 'node:fs';
import { fixtureAccount, TOKEN, SOL, CUTOFF, money } from './fixtures.js';
import type { Fill } from '../../candidates/simple-price-v1/model.js';

const rows: unknown[] = [];
function fillSummary(fill: Fill) {
  return {
    side: fill.side,
    input: fill.input,
    output: fill.output,
    gross: fill.gross,
    fees: fill.fees,
    spreadLossLamports: fill.spreadLossLamports,
  };
}
for (const scenario of [
  'immediate-all',
  'half-then-all',
  'price-double',
  'price-half',
  'weighted-average',
  'forced-after-half',
  'cross-token',
] as const) {
  const h = fixtureAccount();
  if (scenario === 'price-half') h.setPrice(TOKEN.mint, 2n);
  const buy = await h.trade('BUY', SOL);
  const fills: unknown[] = [fillSummary(buy)];
  let fullValueBefore: bigint | null = h.sellQuote(buy.output).output;
  if (scenario === 'weighted-average') {
    h.setPrice(TOKEN.mint, 2n);
    fills.push(fillSummary(await h.trade('BUY', SOL / 2n)));
  }
  if (scenario === 'cross-token')
    fills.push(
      fillSummary(await h.trade('BUY', SOL, { ...TOKEN, mint: 'token-b', market: 'market-b' })),
    );
  if (scenario === 'price-double' || scenario === 'cross-token') h.setPrice(TOKEN.mint, 2n);
  if (scenario === 'price-half') h.setPrice(TOKEN.mint, 1n);
  if (scenario === 'half-then-all' || scenario === 'forced-after-half')
    fills.push(fillSummary(await h.trade('SELL', buy.output / 2n)));
  const before = h.state(),
    equityBeforeClose = await h.sandbox.equity('acceptance-a');
  const positions = before.positions.map((p) => ({
    ...p,
    averageLamportsPerBaseUnit: { numerator: p.basis, denominator: p.quantity },
    executableValue: h.sellQuote(p.quantity, p.identity).output,
    unrealizedPnl: h.sellQuote(p.quantity, p.identity).output - p.basis,
  }));
  if (scenario === 'forced-after-half') {
    h.setNow(CUTOFF);
    await h.sandbox.settle('acceptance-a', 1, 3);
  } else if (scenario !== 'weighted-average' && scenario !== 'cross-token')
    fills.push(fillSummary(await h.trade('SELL', 'ALL')));
  if (scenario === 'weighted-average' || scenario === 'cross-token') fullValueBefore = null;
  const after = h.state();
  rows.push({
    scenario,
    fills,
    fullValueBefore,
    positionsBeforeClose: positions,
    equityBeforeClose,
    cashAfter: after.cash,
    cashAfterSol: money(after.cash),
    realizedPnlAfter: after.realizedPnl,
    realizedPnlSol: money(after.realizedPnl),
    provisionalEquityPnlBefore: equityBeforeClose - after.startingCash,
    closed: after.positions.length === 0,
    journalCount: after.journals.length,
    journalsBalanced: after.journals.every((j) => j.reduce((s, l) => s + l.delta, 0n) === 0n),
    state: after.state,
  });
}
const path = 'artifacts/simple-price-v1-acceptance/numerical-results.json';
writeFileSync(
  path,
  JSON.stringify(
    { label: 'DISPOSABLE_OFFLINE_UNAPPROVED_PARAMETERS', rows },
    (_, v: unknown) => (typeof v === 'bigint' ? v.toString() : v),
    2,
  ),
);
console.log(path);
for (const row of rows)
  console.log(JSON.stringify(row, (_, v: unknown) => (typeof v === 'bigint' ? v.toString() : v)));
