/** Replay retained evidence only; no network, signing, activation or financial database. */
import { writeFileSync } from 'node:fs';
import { pumpBank } from './pump-fixtures.js';
import { linkedBindings, linkedRoute } from './shared-bridge.js';
import { transitionLinkedSnapshot } from './native-transition.js';
const s = pumpBank(),
  policy = { nowMs: Date.parse(s.observedAt), maxAgeMs: 10000 },
  rows = [];
for (const binding of linkedBindings(s)) {
  const buy = await transitionLinkedSnapshot(linkedRoute(s, binding.mint), 10000000n, true, policy),
    full = await transitionLinkedSnapshot(buy.next, buy.quote.output, false, policy),
    part = await transitionLinkedSnapshot(buy.next, buy.quote.output / 4n, false, policy),
    rest = await transitionLinkedSnapshot(
      part.next,
      buy.quote.output - buy.quote.output / 4n,
      false,
      policy,
    );
  rows.push({
    mint: binding.mint,
    targetPool: binding.targetPool,
    bridgePool: s.bridgePool,
    sourceSlot: s.slot,
    paperBuyLamports: buy.quote.input,
    buyOutputUnits: buy.quote.output,
    fullSellLamports: full.quote.output,
    partialSellQuantity: part.quote.input,
    partialSellLamports: part.quote.output,
    remainderSellLamports: rest.quote.output,
    creatorFeeDestination: buy.quote.creatorFeeDestination,
    bridgeFees: buy.quote.bridge.detail,
    valuation: 'Same executable full SELL through the carried post-BUY state',
  });
}
const result = {
  schema: 'LINKED_PUMP_RETAINED_SIMULATION_V1',
  evidence:
    'Finalized raw slot459684978 bank; independent per-mint paper scenarios; no external flow between operations',
  rows,
};
writeFileSync(
  new URL(
    '../../../../docs/linked-pair-20261021/pump-bridge/simulation-results.json',
    import.meta.url,
  ),
  JSON.stringify(result, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2) + '\n',
);
console.log(JSON.stringify(result, (_, v) => (typeof v === 'bigint' ? v.toString() : v)));
