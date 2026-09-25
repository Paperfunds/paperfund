// @vitest-environment jsdom

import './test/setup.js';

import { describe, expect, it, vi } from 'vitest';

import { AxiomTerminalAdapter, isSolanaAddress } from './terminal.js';

const MINT_A = '7LSsEoJGhLeZzGvDofTdNg7M3JttxQqGWNLo6vWMpump';
const MINT_B = '6pobtrZo2hS8ntAwXsP7283ye6oTGdrVj7RqghYQpump';

describe('AxiomTerminalAdapter', () => {
  it('detects the verified current Solana /meme route', () => {
    expect(
      new AxiomTerminalAdapter().detect(`https://axiom.trade/meme/${MINT_A}?chain=sol`),
    ).toMatchObject({ mint: MINT_A, status: 'SUPPORTED_ROUTE' });
  });

  it('accepts a referral suffix but rejects non-Solana /token routes', () => {
    const adapter = new AxiomTerminalAdapter();
    expect(adapter.detect(`https://axiom.trade/meme/${MINT_A}/@paperfund?chain=sol`).mint).toBe(
      MINT_A,
    );
    expect(adapter.detect(`https://axiom.trade/token/${MINT_A}?chain=bnb`)).toMatchObject({
      mint: null,
      status: 'NO_MARKET',
    });
  });

  it('validates the decoded 32-byte Solana public key', () => {
    expect(isSolanaAddress(MINT_A)).toBe(true);
    expect(isSolanaAddress('not-a-mint')).toBe(false);
    expect(
      new AxiomTerminalAdapter().detect('https://axiom.trade/meme/not-a-mint?chain=sol'),
    ).toMatchObject({ mint: null, status: 'DETECTION_UNAVAILABLE' });
  });

  it('clears the old mint when navigation no longer detects a market', () => {
    history.replaceState({}, '', `/meme/${MINT_A}?chain=sol`);
    const states: Array<string | null> = [];
    const stop = new AxiomTerminalAdapter().observe((state) => states.push(state.mint));
    history.pushState({}, '', '/discover');
    window.dispatchEvent(
      new MessageEvent('message', {
        source: window,
        data: {
          channel: 'paperfund:page-bridge:v1',
          direction: 'NAVIGATION',
          url: 'https://axiom.trade/discover',
        },
      }),
    );
    expect(states.at(-1)).toBeNull();
    stop();
  });

  it('publishes SPA mint changes without a reload', () => {
    history.replaceState({}, '', `/meme/${MINT_A}?chain=sol`);
    const changed = vi.fn();
    const stop = new AxiomTerminalAdapter().observe(changed);
    history.pushState({}, '', `/meme/${MINT_B}?chain=sol`);
    window.dispatchEvent(
      new MessageEvent('message', {
        source: window,
        data: {
          channel: 'paperfund:page-bridge:v1',
          direction: 'NAVIGATION',
          url: `https://axiom.trade/meme/${MINT_B}?chain=sol`,
        },
      }),
    );
    expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ mint: MINT_B }));
    stop();
  });
});
