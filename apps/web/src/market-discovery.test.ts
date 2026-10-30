import { describe, it, expect } from 'vitest';
import { validMint, mintFromSearch, choosePair, dexscreenerEmbed, dexscreenerTokenUrl } from './market-discovery.js';

const MINT = '8NuGjbo1ZcUL3iVCy1hQHJeEABSK6V2D1xpRpHbVpump';
const PAIR = '9m9kaJFtiJK9nBQEuWoYyegabJ9e5p7dTk8YWS33Pump';

describe('website-only market display', () => {
  it('accepts a real Solana mint and rejects arbitrary URLs and scripts', () => {
    expect(validMint(MINT)).toBe(MINT);
    expect(validMint('https://evil.test')).toBeNull();
    expect(validMint('<script>alert(1)</script>')).toBeNull();
    expect(validMint('')).toBeNull();
    expect(validMint('0'.repeat(44))).toBeNull();
  });
  it('parses deep links without trusting invalid query values', () => {
    expect(mintFromSearch('?mint=' + MINT)).toBe(MINT);
    expect(mintFromSearch('?mint=%2F%2Fevil.test')).toBeNull();
  });
  it('requires an actual verified pair address and associated mint', () => {
    const a = { chainId: 'solana', pairAddress: PAIR, baseToken: { address: MINT }, liquidity: { usd: 75 } };
    const b = { chainId: 'solana', pairAddress: '6xLmsMtoAYFFfQ94SyyTXBFexyqXH9scv7f9fyR5b6Gt', quoteToken: { address: MINT }, liquidity: { usd: 100 } };
    expect(choosePair([a,b], MINT)?.pairAddress).toBe(b.pairAddress);
    expect(choosePair([{ ...a, baseToken: { address: 'WRONG' } }], MINT)).toBeNull();
    expect(choosePair([{ ...a, chainId: 'ethereum' }], MINT)).toBeNull();
  });
  it('builds a fixed informational domain, never using names as URLs', () => {
    const a = { chainId: 'solana', pairAddress: PAIR };
    expect(dexscreenerEmbed(a)).toContain('dexscreener.com/solana/' + PAIR);
    expect(dexscreenerTokenUrl(MINT)).toBe('https://dexscreener.com/solana/' + MINT);
    expect(dexscreenerEmbed({ ...a, pairAddress: 'javascript:alert(1)' })).toBeNull();
  });
});
