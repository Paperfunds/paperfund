import type { Brand } from './brand.js';

type Identifier<Name extends string> = Brand<string, Name>;

export type UserId = Identifier<'UserId'>;
export type WalletAddress = Identifier<'WalletAddress'>;
export type HourlyRoundId = Identifier<'HourlyRoundId'>;
export type DailyCompetitionId = Identifier<'DailyCompetitionId'>;
export type CompetitionAccountId = Identifier<'CompetitionAccountId'>;
export type TokenMint = Identifier<'TokenMint'>;
export type MarketId = Identifier<'MarketId'>;
export type ProtocolId = Identifier<'ProtocolId'>;
export type OrderId = Identifier<'OrderId'>;
export type ExecutionId = Identifier<'ExecutionId'>;
export type LedgerEntryId = Identifier<'LedgerEntryId'>;

export function identifier<Name extends string>(value: string, name: Name): Identifier<Name> {
  if (value.length === 0 || value.trim() !== value) {
    throw new TypeError(`${name} must be a non-empty string without surrounding whitespace.`);
  }
  return value as Identifier<Name>;
}
