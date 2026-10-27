import { describe, expect, it } from 'vitest';
import { chartMintSupply } from '../src/chart-supply.js';
import { recordedLaunchlab } from './fixtures/launchlab.js';

describe('recorded chart supply', () => {
  it('reads the active Token-2022 mint from recorded accounts without assuming one billion tokens', () => {
    const state = recordedLaunchlab();
    const supply = chartMintSupply(state.normalizedState, state.identity.tokenMint);
    expect(supply).toMatch(/^[1-9]\d*$/);
    expect(chartMintSupply({ mintSupply: supply! }, state.identity.tokenMint)).toBe(supply);
    expect(chartMintSupply(state.normalizedState, 'missing')).toBeNull();
  });
  it('fails closed on missing, malformed and zero supply', () => {
    expect(chartMintSupply(null, 'mint')).toBeNull();
    expect(chartMintSupply({ mintSupply: '0' }, 'mint')).toBeNull();
    expect(chartMintSupply({ mintSupply: 'bogus' }, 'mint')).toBeNull();
  });
});
