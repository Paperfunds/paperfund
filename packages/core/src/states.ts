export const HOURLY_ROUND_STATES = [
  'SCHEDULED',
  'OPEN',
  'CLOSING',
  'SETTLING',
  'FINALIZED',
  'PAYING',
  'PAID',
] as const;
export type HourlyRoundState = (typeof HOURLY_ROUND_STATES)[number];

export const DAILY_COMPETITION_STATES = [
  'OPEN',
  'CLOSING',
  'FINALIZING',
  'FINALIZED',
  'PAYING',
  'PAID',
] as const;
export type DailyCompetitionState = (typeof DAILY_COMPETITION_STATES)[number];

export const PAYOUT_STATES = [
  'CALCULATED',
  'FROZEN',
  'VALIDATED',
  'APPROVED',
  'SIGNED',
  'BROADCAST',
  'VERIFIED',
] as const;
export type PayoutState = (typeof PAYOUT_STATES)[number];
