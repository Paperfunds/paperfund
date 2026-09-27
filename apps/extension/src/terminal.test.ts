// @vitest-environment jsdom

import './test/setup.js';

import { describe, expect, it, vi } from 'vitest';

import {
  AxiomTerminalAdapter,
  GMGNTerminalAdapter,
  TerminalAdapterRegistry,
  TerminalTradeAdapter,
  isSolanaAddress,
  type TerminalAdapter,
  type TerminalId,
} from './terminal.js';

const MINT_A = '7LSsEoJGhLeZzGvDofTdNg7M3JttxQqGWNLo6vWMpump';
const MINT_B = '6pobtrZo2hS8ntAwXsP7283ye6oTGdrVj7RqghYQpump';

const fixtures: Array<{
  id: TerminalId;
  adapter: TerminalAdapter;
  valid(mint: string): string;
  unsupported: string;
  nonSolana: string;
  malformed: string;
}> = [
  {
    id: 'AXIOM',
    adapter: new AxiomTerminalAdapter(),
    valid: (mint) => `https://axiom.trade/meme/${mint}?chain=sol`,
    unsupported: 'https://axiom.trade/discover?chain=sol',
    nonSolana: `https://axiom.trade/token/${MINT_A}?chain=bnb`,
    malformed: 'https://axiom.trade/meme/not-a-mint?chain=sol',
  },
  {
    id: 'GMGN',
    adapter: new GMGNTerminalAdapter(),
    valid: (mint) => `https://gmgn.ai/sol/token/${mint}`,
    unsupported: 'https://gmgn.ai/sol',
    nonSolana: `https://gmgn.ai/eth/token/${MINT_A}`,
    malformed: 'https://gmgn.ai/sol/token/not-a-mint',
  },
  {
    id: 'TERMINAL',
    adapter: new TerminalTradeAdapter(),
    valid: (mint) => `https://www.theterminal.trade/token/${mint}?network=solana`,
    unsupported: 'https://www.theterminal.trade/trenches?network=solana',
    nonSolana: `https://www.theterminal.trade/token/${MINT_A}?network=ethereum`,
    malformed: 'https://www.theterminal.trade/token/not-a-mint?network=solana',
  },
];

describe.each(fixtures)(
  '$id terminal adapter',
  ({ id, adapter, valid, unsupported, nonSolana, malformed }) => {
    it('detects the verified current Solana token route', () => {
      expect(adapter.detect(valid(MINT_A))).toMatchObject({
        terminal: id,
        mint: MINT_A,
        status: 'SUPPORTED_ROUTE',
      });
    });

    it('rejects malformed mints', () => {
      expect(adapter.detect(malformed)).toMatchObject({
        terminal: id,
        mint: null,
        status: 'DETECTION_UNAVAILABLE',
      });
    });

    it('clears the mint on unsupported and non-Solana contexts', () => {
      expect(adapter.detect(unsupported)).toMatchObject({ mint: null, status: 'NO_MARKET' });
      expect(adapter.detect(nonSolana)).toMatchObject({ mint: null });
    });

    it('publishes SPA TOKEN_A to TOKEN_B and navigation-away transitions', () => {
      const registry = new TerminalAdapterRegistry([adapter]);
      const changed = vi.fn();
      const stop = registry.observe(changed);
      for (const url of [valid(MINT_A), valid(MINT_B), unsupported, malformed]) {
        window.dispatchEvent(
          new MessageEvent('message', {
            source: window,
            data: { channel: 'paperfund:page-bridge:v1', direction: 'NAVIGATION', url },
          }),
        );
      }
      expect(changed).toHaveBeenCalledWith(expect.objectContaining({ mint: MINT_A }));
      expect(changed).toHaveBeenCalledWith(expect.objectContaining({ mint: MINT_B }));
      expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ mint: null }));
      stop();
    });
  },
);

describe('TerminalAdapterRegistry', () => {
  it('resolves one adapter and returns no context for unsupported hosts', () => {
    const registry = new TerminalAdapterRegistry();
    expect(registry.detect(fixtures[1]!.valid(MINT_A))).toMatchObject({ terminal: 'GMGN' });
    expect(registry.detect('https://example.com/token/' + MINT_A)).toBeNull();
  });

  it('fails on duplicate matches instead of choosing arbitrarily', () => {
    const duplicate: TerminalAdapter = {
      id: 'GMGN',
      matches: () => true,
      detect: (url) => ({ terminal: 'GMGN', mint: null, status: 'NO_MARKET', url }),
    };
    const registry = new TerminalAdapterRegistry([duplicate, duplicate]);
    expect(() => registry.resolve('https://gmgn.ai/')).toThrow(/Multiple terminal adapters/);
  });

  it('validates decoded 32-byte Solana public keys exactly', () => {
    expect(isSolanaAddress(MINT_A)).toBe(true);
    expect(isSolanaAddress('not-a-mint')).toBe(false);
  });
});

describe('Axiom route compatibility', () => {
  it('keeps the verified referral suffix and rejects non-Solana /token routes', () => {
    const adapter = new AxiomTerminalAdapter();
    expect(adapter.detect(`https://axiom.trade/meme/${MINT_A}/@paperfund?chain=sol`).mint).toBe(
      MINT_A,
    );
    expect(adapter.detect(`https://axiom.trade/token/${MINT_A}?chain=bnb`)).toMatchObject({
      mint: null,
      status: 'NO_MARKET',
    });
  });
});
