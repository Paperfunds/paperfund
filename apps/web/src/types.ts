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
  user_id: string;
  wallet_address: string;
  score: string;
  rank: number;
  tied: boolean;
  tieGroupSize: number;
  final_settled_balance_lamports?: string;
  completed_hourly_round_count?: number;
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
