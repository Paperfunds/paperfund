import { describe, expect, it } from 'vitest';

import { decodePumpBondingCurve } from '../src/pump-fun.js';
import { decodePumpSwapPool, canonicalPumpSwapPoolAddress } from '../src/pump-swap.js';

// Public mainnet getMultipleAccounts, confirmed slot 451815648 (2026-09-30).
// Program owners checked during capture: Pump for curves; Pump AMM for pools.
const captures = [
  {
    mint: 'BxS9FViALHNNd7bWVHNZ4ift699hUai4Xcj9vsKHpump',
    pool: '66eZ1qK2A5ZbCzNt3jVPPk2Hbefogb5tkcknp6Jc4CGU',
    curve:
      'F7f4N2DYrGAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAxqR+jQMAAajt+4hNslVASpNS2DaNhxEaTPaTXejOZBIqOJCi5rdsAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==',
    poolData:
      '8ZptBBGxbbz9AAA+xOSGYAgyUcTJvHZQ7MhCc6IY+nSFgtqSYmPbQtibsKLIPf/ED8RSfN53yZqgzCMEG6UO3aGkr1PXrE9rZrYPBpuIV/6rgYT7aH9jRhjANdrEOdwa6ztVmKDwAAAAAAEV+anVaxYvnquuMkn3LFSAnRlohGqJPpcfx5Mi2rEBlFCausy/YROOZSVEBZWOe+MTejJUP+sMpAeD+dKDOZ1hypKu/shkhUU2xb5ZiAZSSJ/4PcdxKT+TNy9QieagLA1442tZ0AMAAKjt+4hNslVASpNS2DaNhxEaTPaTXejOZBIqOJCi5rdsAAAhQx4YBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==',
  },
  {
    mint: 'FxMHS3C5EvyPkLoKswvf99VR5RkMLxKKgBqxxDvpump',
    pool: '3MtUk9p9oRZq25x756rgkC3JTV68jryX6WPakuEeQMBN',
    curve:
      'F7f4N2DYrGAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAxqR+jQMAAQqhcjgy93CzNBZNHsp3DCSK2ZedWXuTpr31L9LedEuHAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    poolData:
      '8ZptBBGxbbz/AADKxf/sHQ9sCyC3iZMxXM6DauROeIH/fGhwCBuB10hz5wPUtyd51J9pNRHndjzQHZrvaJxiNP0PRj3Oe+CpkdPfBpuIV/6rgYT7aH9jRhjANdrEOdwa6ztVmKDwAAAAAAF2E9S7X8BRbFH6RyKuvi2X3yzoGdwaftC4C5bDEW+O5mH6bH9o5OsOoGDGp+RQRaFRlyZiJ0hlb85tGtoo1GGVVeK7kWacsB72gClzg2fPdkhsuP6oakWfCnAjh09v5HLsQmtZ0AMAAAqhcjgy93CzNBZNHsp3DCSK2ZedWXuTpr31L9LedEuHAADIQR4YBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==',
  },
];

describe('operator mint current-chain decoder regressions', () => {
  it.each(captures)('decodes canonical migrated market $mint', async (capture) => {
    expect(decodePumpBondingCurve(Buffer.from(capture.curve, 'base64')).complete).toBe(true);
    const pool = decodePumpSwapPool(Buffer.from(capture.poolData, 'base64'));
    expect(pool.baseMint).toBe(capture.mint);
    expect(pool.quoteMint).toBe('So11111111111111111111111111111111111111112');
    expect(await canonicalPumpSwapPoolAddress(capture.mint)).toBe(capture.pool);
  });

  it('decodes the active KdML curve without inferring protocol from its suffix', () => {
    const curve = decodePumpBondingCurve(
      Buffer.from(
        'F7f4N2DYrGAAENhH488DAFCsI/wGAAAAAHjF+1HRAgBQAAAAAAAAAACAxqR+jQMAAEmkmHV2yCOukhcSUnFZZ1nbSzIUa7mPweY64m4qEEQ1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==',
        'base64',
      ),
    );
    expect(curve.complete).toBe(false);
    expect(curve.virtualTokenReserves).toBeGreaterThan(0n);
    expect(curve.virtualSolReserves).toBeGreaterThan(0n);
  });
});
