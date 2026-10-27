/** Read-only disposable numerical report. No live account, provider, database or service calls. */
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { quote } from './model.js';
import { synthetic, TOKEN, POLICY, START, SOL } from './test-support.js';
import { evaluateRecorded } from './recorded-review.js';
export function numerical() {
  const e = synthetic(),
    buy = quote('BUY', SOL, e, TOKEN, START, POLICY),
    full = quote('SELL', buy.output, e, TOKEN, START, POLICY, undefined, buy.output);
  const splitting = [1, 2, 100, 500].map((count) => {
    const n = BigInt(count),
      base = buy.output / n,
      rem = buy.output % n;
    let total = 0n,
      fees = 0n;
    for (let j = 0n; j < n; j++) {
      const f = quote(
        'SELL',
        base + (j < rem ? 1n : 0n),
        e,
        TOKEN,
        START,
        POLICY,
        undefined,
        buy.output,
      );
      total += f.output;
      fees += f.costs.fixedFeeLamports;
    }
    return {
      count,
      net: total,
      advantageOverFull: total - full.output,
      apportionedFixedFees: fees,
    };
  });
  return {
    label: 'SYNTHETIC_PRIVATE_ACCOUNTING_AND_HISTORICAL_MATH_ONLY',
    synthetic: { buy, full, splitting },
    historicalMath: evaluateRecorded(),
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const output = JSON.stringify(
    numerical(),
    (_, v: unknown) => (typeof v === 'bigint' ? v.toString() : v),
    2,
  );
  writeFileSync('artifacts/simple-price-v2-final/numerical.json', output);
  console.log(output);
}
