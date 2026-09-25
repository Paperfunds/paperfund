import { describe, expect, it } from 'vitest';

import { isPaperfundAuthMessage } from './wallet-message.js';

const wallet = '7LSsEoJGhLeZzGvDofTdNg7M3JttxQqGWNLo6vWMpump';
const valid = [
  'Paperfund Authentication',
  'Purpose: Sign in to Paperfund (message only; no transaction)',
  `Wallet: ${wallet}`,
  'Nonce: abcdefghijklmnopqrstuvwxyz012345',
  'Issued At: 2026-09-25T12:00:00.000Z',
  'Expires At: 2026-09-25T12:05:00.000Z',
].join('\n');

describe('wallet message scope', () => {
  it('accepts only the structured Paperfund message for the connected wallet', () => {
    expect(isPaperfundAuthMessage(valid, wallet)).toBe(true);
    expect(isPaperfundAuthMessage(valid, '11111111111111111111111111111111')).toBe(false);
    expect(isPaperfundAuthMessage('Sign this arbitrary message', wallet)).toBe(false);
  });
});
