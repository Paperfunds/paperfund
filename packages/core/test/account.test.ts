import { describe, expect, it } from 'vitest';

import {
  competitionConfig,
  identifier,
  initializeCompetitionAccount,
  type CompetitionAccountId,
  type HourlyRoundId,
  type UserId,
  type WalletAddress,
} from '../src/index.js';

const input = {
  accountId: identifier('account-1', 'CompetitionAccountId') as CompetitionAccountId,
  userId: identifier('user-1', 'UserId') as UserId,
  walletAddress: identifier('wallet-1', 'WalletAddress') as WalletAddress,
  hourlyRoundId: identifier('2026-09-23T15:00:00Z', 'HourlyRoundId') as HourlyRoundId,
  config: competitionConfig,
};

describe('hourly competition account initialization', () => {
  it('starts with the exact configured balance and no consumed slots', () => {
    const account = initializeCompetitionAccount(input);

    expect(account.paperSolBalance).toBe(10_000_000_000n);
    expect(account.paperSolBalance).toBe(competitionConfig.startingPaperSolBaseUnits);
    expect(account.tokenSlots).toEqual([]);
  });

  it('preserves all caller-supplied identities and hourly round', () => {
    const account = initializeCompetitionAccount(input);

    expect(account.id).toBe(input.accountId);
    expect(account.userId).toBe(input.userId);
    expect(account.walletAddress).toBe(input.walletAddress);
    expect(account.hourlyRoundId).toBe(input.hourlyRoundId);
  });

  it('cannot carry a previous balance or previous token exposure into a new account', () => {
    const first = initializeCompetitionAccount(input);
    const next = initializeCompetitionAccount({
      ...input,
      accountId: identifier('account-2', 'CompetitionAccountId') as CompetitionAccountId,
      hourlyRoundId: identifier('2026-09-23T16:00:00Z', 'HourlyRoundId') as HourlyRoundId,
    });

    expect(first.paperSolBalance).toBe(next.paperSolBalance);
    expect(next.tokenSlots).toEqual([]);
  });

  it('is deterministic and has no wall-clock dependency', () => {
    expect(initializeCompetitionAccount(input)).toEqual(initializeCompetitionAccount(input));
  });
});
