import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import {
  newLinkedBranch,
  reconcileLinkedInterval,
  type ProviderInterval,
} from './external-flow.js';
import { transitionLinkedSnapshot } from './native-transition.js';
const dir = 'docs/linked-pair-20261021/external-flow-completion',
  rows = [];
for (const file of readdirSync(dir).filter((n) => n.startsWith('provider-') && n.endsWith('.gz'))) {
  const e = JSON.parse(gunzipSync(readFileSync(dir + '/' + file)).toString()) as ProviderInterval;
  for (const impact of [false, true]) {
    const b = newLinkedBranch('evidence', 'round', e.before);
    if (impact)
      b.simulated = (
        await transitionLinkedSnapshot(b.simulated, 10000000n, true, {
          nowMs: Date.parse(e.before.observedAt),
          maxAgeMs: 10000,
        })
      ).next;
    try {
      const r = await reconcileLinkedInterval(b, e, Date.parse(e.after.observedAt), 10000);
      const row = {
        file,
        impact,
        result: 'PASS',
        events: r.events,
        failed: r.failedTransactions,
        inventory: r.branch.inventoryDeltas,
      };
      console.log(
        JSON.stringify({ ...row, ...('inventory' in row ? { inventory: undefined } : {}) }),
      );
      rows.push(row);
    } catch (error) {
      const row = { file, impact, result: 'BLOCKED', reason: (error as Error).message };
      console.log(JSON.stringify(row));
      rows.push(row);
    }
  }
}
writeFileSync(dir + '/replay-results.json', JSON.stringify(rows, null, 2));
