export interface User {
  id: string;
  walletAddress: string;
}

export interface Round {
  id: string;
  startsAt: string;
  endsAtExclusive: string;
  state: string;
  startingPaperSolLamports: string;
  maxUniqueTokens: number;
  maxBuyRatioBps: number;
  rewardFinalizationGracePeriodSeconds: number;
}

export interface Position {
  id: string;
  mint: string;
  originMarketId: string;
  originProtocol: string;
  tokenDecimals: number;
  tokenQuantityBaseUnits: string;
  costBasisPaperSolLamports: string;
  realizedPnlLamports: string;
  valuation: PositionValuation;
}

export type PositionValuation =
  | {
      status: 'AVAILABLE';
      executablePaperSolLamports: string;
      unrealizedPnlLamports: string;
      currentProtocol: string;
      evidenceFingerprint: string;
      observedAt: string;
      chainSlot: string | null;
      valuedAt: string;
    }
  | {
      status: 'UNAVAILABLE' | 'STALE' | 'UNSUPPORTED_ROUTE';
      reason: string;
      valuedAt: string;
    };

export interface PositionValuationResponse {
  accountId: string;
  roundId: string;
  cashLamports: string;
  startingPaperSolLamports: string;
  valuationStatus: 'AVAILABLE' | 'UNAVAILABLE';
  executablePositionsLamports: string | null;
  portfolioEquityLamports: string | null;
  livePnlLamports: string | null;
  valuedAt: string;
  positions: Position[];
}

export interface BuyPreflight {
  accountId: string;
  roundId: string;
  cashLamports: string;
  executablePositionsLamports: string | null;
  portfolioEquityLamports: string | null;
  maxBuyByRatioLamports: string | null;
  maxBuyLamports: string | null;
  maxBuyRatioBps: string;
  slotsUsed: number;
  slotLimit: number;
  targetAlreadyConsumesSlot: boolean;
  requiresNewSlot: boolean;
  slotAvailable: boolean;
  marketSupported: boolean;
  protocol: string | null;
  marketStatus: string;
  valuationStatus: 'AVAILABLE' | 'UNAVAILABLE';
  unavailablePositionIds: string[];
  serverTime: string;
}

export interface Account {
  accountId: string;
  roundId: string;
  paperSolLamports: string;
  startingPaperSolLamports: string;
  realizedPnlLamports: string;
  slotsUsed: number;
  slotLimit: number;
  roundState: string;
  positions: Position[];
}

export interface MarketSupport {
  mint: string;
  supported: boolean;
  executionProtocol?: string;
  status?: 'MIGRATED_POOL' | 'ACTIVE_BONDING_CURVE';
  marketId?: string;
  originMarketId?: string;
  tokenDecimals?: number;
  reason?: string;
}

export interface Trade {
  id: string;
  order_id: string;
  hourly_round_id: string;
  side: 'BUY' | 'SELL';
  execution_context: 'NORMAL_USER' | 'FORCED_HOURLY_SETTLEMENT';
  mint_address: string;
  protocol_id: string;
  base_quantity: string;
  quote_lamports: string;
  fee_lamports: string;
  actual_input_lamports: string | null;
  actual_output_lamports: string | null;
  realized_pnl_lamports: string;
  executed_at: string;
}

export interface HourlyResult {
  id: string;
  hourly_round_id: string;
  starts_at: string;
  ends_at_exclusive: string;
  starting_paper_sol_lamports: string;
  final_settled_balance_lamports: string;
  hourly_pnl_lamports: string;
  finalized_at: string;
}

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

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
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
