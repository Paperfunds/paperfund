import { expect, it } from 'vitest';
import { maximumConstantProductSell } from '../src/sell-capacity.js';

it('matches exhaustive integer exits, including independently rounded dust fees', () => {
  for (const base of [1n, 7n, 100n]) {
    for (const quote of [3n, 30n, 101n]) {
      for (const reserves of [0n, 1n, 5n, 100n]) {
        const net = (gross: bigint) =>
          gross - (gross * 95n + 9999n) / 10000n - (gross * 30n + 9999n) / 10000n;
        let expected = 0n;
        for (let q = 1n; q <= 300n; q++) {
          const gross = (q * quote) / (base + q);
          if (gross <= reserves && net(gross) > 0n) expected = q;
        }
        expect(
          maximumConstantProductSell(300n, base, quote, (gross) => gross <= reserves, net),
        ).toBe(expected);
      }
    }
  }
});

it('finds capacity in logarithmic reserve probes even for very large holdings', () => {
  let probes = 0;
  const result = maximumConstantProductSell(
    10n ** 30n,
    10n ** 15n,
    10n ** 11n,
    (gross) => {
      probes++;
      return gross <= 100_000n;
    },
    (gross) => gross - 2n,
  );
  expect((result * 10n ** 11n) / (10n ** 15n + result)).toBe(100_000n);
  expect(((result + 1n) * 10n ** 11n) / (10n ** 15n + result + 1n)).toBe(100_001n);
  expect(probes).toBeLessThan(102);
});
