export type {
  Account,
  BuyPreflight,
  HourlyResult,
  MarketSupport,
  Page,
  Position,
  PositionValuation,
  PositionValuationResponse,
  Round,
  Trade,
  User,
} from '@paperfund/shared/browser';

export interface LeaderboardEntry {
  equityLamports?: string;
  slotsUsed?: number;
  openPositions?: number;
  user_id: string;
  wallet_address: string;
  score: string;
  rank: number;
  tied: boolean;
  tieGroupSize: number;
  final_settled_balance_lamports?: string;
  completed_hourly_round_count?: number;
}
export interface LiveHourlyLeaderboard {
  round: { id: string; starts_at: string; ends_at_exclusive: string; state: string };
  phase: 'LIVE' | 'SETTLING' | 'FINALIZED';
  status: 'AVAILABLE' | 'UNAVAILABLE';
  reason: string | null;
  serverTime: string;
  entries: LeaderboardEntry[];
}

export interface RewardAllocation {
  payoutPlanId: string;
  competitionType: 'HOURLY' | 'DAILY';
  hourlyRoundId: string | null;
  dailyCompetitionId: string | null;
  competitiveRank: number;
  tied: boolean;
  tieGroupSize: number;
  won: boolean;
  rewardAllocationLamports: string;
  status: 'PENDING' | 'APPROVED' | 'PROCESSING' | 'PAID' | 'FAILED_REVIEW' | 'NOT_A_WINNER';
  payoutPlanState:
    | 'CALCULATED'
    | 'FROZEN'
    | 'VALIDATED'
    | 'APPROVED'
    | 'SIGNED'
    | 'BROADCAST'
    | 'VERIFIED'
    | 'FAILED_RETRYABLE'
    | 'FAILED_FINAL'
    | 'RECONCILIATION_REQUIRED';
}

export interface InjectedWallet {
  isConnected?: boolean;
  publicKey?: { toString(): string };
  connect(): Promise<{ publicKey: { toString(): string } }>;
  disconnect?(): Promise<void>;
  signMessage(message: Uint8Array, encoding?: string): Promise<{ signature: Uint8Array }>;
}

declare global {
  interface Window {
    solana?: InjectedWallet;
    phantom?: { solana?: InjectedWallet };
  }
}
