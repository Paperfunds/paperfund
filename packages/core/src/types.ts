import type {
  CompetitionAccountId,
  DailyCompetitionId,
  ExecutionId,
  HourlyRoundId,
  LedgerEntryId,
  MarketId,
  OrderId,
  ProtocolId,
  TokenMint,
  UserId,
  WalletAddress,
} from './identifiers.js';
import type {
  Lamports,
  PaperSolBaseUnits,
  PaperSolDelta,
  TokenBaseUnitDelta,
  TokenBaseUnits,
} from './money.js';
import type { BasisPoints } from './percentages.js';
import type { DailyCompetitionState, HourlyRoundState } from './states.js';
import type { UtcInstant } from './time.js';

export interface HourlyRound {
  readonly id: HourlyRoundId;
  readonly state: HourlyRoundState;
  readonly startsAt: UtcInstant;
  readonly endsAtExclusive: UtcInstant;
  readonly configurationVersion: string;
}

export interface DailyCompetition {
  readonly id: DailyCompetitionId;
  readonly state: DailyCompetitionState;
  readonly startsAt: UtcInstant;
  readonly endsAtExclusive: UtcInstant;
  readonly configurationVersion: string;
}

export interface CompetitionAccount {
  readonly id: CompetitionAccountId;
  readonly userId: UserId;
  readonly walletAddress: WalletAddress;
  readonly hourlyRoundId: HourlyRoundId;
  readonly paperSolBalance: PaperSolBaseUnits;
  readonly tokenSlots: readonly TokenSlot[];
}

export interface TokenSlot {
  readonly slotNumber: number;
  readonly tokenMint: TokenMint;
  readonly firstSuccessfulBuyOrderId: OrderId;
  readonly consumedAt: UtcInstant;
}

export interface Position {
  readonly competitionAccountId: CompetitionAccountId;
  readonly hourlyRoundId: HourlyRoundId;
  readonly tokenMint: TokenMint;
  readonly marketId: MarketId;
  readonly protocolId: ProtocolId;
  readonly tokenAmount: TokenBaseUnits;
  readonly paperSolCostBasis: PaperSolBaseUnits;
  readonly updatedAt: UtcInstant;
}

interface OrderRequestBase {
  readonly id: OrderId;
  readonly competitionAccountId: CompetitionAccountId;
  readonly hourlyRoundId: HourlyRoundId;
  readonly tokenMint: TokenMint;
  readonly marketId: MarketId;
  readonly protocolId: ProtocolId;
  readonly requestedAt: UtcInstant;
}

export interface BuyOrderRequest extends OrderRequestBase {
  readonly side: 'BUY';
  readonly paperSolInput: PaperSolBaseUnits;
}

export interface SellOrderRequest extends OrderRequestBase {
  readonly side: 'SELL';
  readonly tokenInput: TokenBaseUnits;
}

export type OrderRequest = BuyOrderRequest | SellOrderRequest;

export type AssetAmount =
  | {
      readonly asset: 'PAPER_SOL';
      readonly amount: PaperSolBaseUnits;
    }
  | {
      readonly asset: 'TOKEN';
      readonly tokenMint: TokenMint;
      readonly amount: TokenBaseUnits;
    };

export interface ExecutionFee {
  /** Audit breakdown only; this amount is already reflected in actualInput/actualOutput. */
  readonly category: string;
  readonly amount: AssetAmount;
}

export interface ExecutionQuote {
  readonly orderId: OrderId;
  readonly marketId: MarketId;
  readonly protocolId: ProtocolId;
  readonly adapterVersion: string;
  readonly marketStateRecordedAt: UtcInstant;
  readonly requestedInput: AssetAmount;
  readonly simulatedOutput: AssetAmount;
  readonly fees: readonly ExecutionFee[];
}

export interface SimulatedExecution {
  readonly id: ExecutionId;
  readonly orderId: OrderId;
  readonly quote: ExecutionQuote;
  /** Total amount leaving the account, inclusive of same-asset execution fees. */
  readonly actualInput: AssetAmount;
  /** Net amount entering the account after any output-asset execution fees. */
  readonly actualOutput: AssetAmount;
  readonly executedAt: UtcInstant;
}

export type LedgerEventType =
  | 'ROUND_CREDIT'
  | 'BUY_PAPER_SOL_DEBIT'
  | 'BUY_TOKEN_CREDIT'
  | 'SELL_TOKEN_DEBIT'
  | 'SELL_PAPER_SOL_CREDIT'
  | 'FORCED_SETTLEMENT_TOKEN_DEBIT'
  | 'FORCED_SETTLEMENT_PAPER_SOL_CREDIT';

interface LedgerEntryBase {
  readonly id: LedgerEntryId;
  readonly competitionAccountId: CompetitionAccountId;
  readonly eventType: LedgerEventType;
  readonly occurredAt: UtcInstant;
}

export interface RoundCreditLedgerEntry extends LedgerEntryBase {
  readonly eventType: 'ROUND_CREDIT';
  readonly asset: 'PAPER_SOL';
  readonly amount: PaperSolDelta;
}

export interface BuyPaperSolDebitLedgerEntry extends LedgerEntryBase {
  readonly eventType: 'BUY_PAPER_SOL_DEBIT';
  readonly asset: 'PAPER_SOL';
  readonly amount: PaperSolDelta;
  readonly orderId: OrderId;
  readonly executionId: ExecutionId;
  /** Audit-only breakdown already reflected in actual input/output; never post it again. */
  readonly executionFees: readonly ExecutionFee[];
}

export interface BuyTokenCreditLedgerEntry extends LedgerEntryBase {
  readonly eventType: 'BUY_TOKEN_CREDIT';
  readonly asset: 'TOKEN';
  readonly tokenMint: TokenMint;
  readonly amount: TokenBaseUnitDelta;
  readonly orderId: OrderId;
  readonly executionId: ExecutionId;
}

export interface SellTokenDebitLedgerEntry extends LedgerEntryBase {
  readonly eventType: 'SELL_TOKEN_DEBIT';
  readonly asset: 'TOKEN';
  readonly tokenMint: TokenMint;
  readonly amount: TokenBaseUnitDelta;
  readonly orderId: OrderId;
  readonly executionId: ExecutionId;
}

export interface SellPaperSolCreditLedgerEntry extends LedgerEntryBase {
  readonly eventType: 'SELL_PAPER_SOL_CREDIT';
  readonly asset: 'PAPER_SOL';
  readonly amount: PaperSolDelta;
  readonly orderId: OrderId;
  readonly executionId: ExecutionId;
  /** Audit-only breakdown already reflected in actual input/output; never post it again. */
  readonly executionFees: readonly ExecutionFee[];
}

export interface ForcedSettlementTokenDebitLedgerEntry extends LedgerEntryBase {
  readonly eventType: 'FORCED_SETTLEMENT_TOKEN_DEBIT';
  readonly asset: 'TOKEN';
  readonly tokenMint: TokenMint;
  readonly amount: TokenBaseUnitDelta;
  readonly orderId: OrderId;
  readonly executionId: ExecutionId;
}

export interface ForcedSettlementPaperSolCreditLedgerEntry extends LedgerEntryBase {
  readonly eventType: 'FORCED_SETTLEMENT_PAPER_SOL_CREDIT';
  readonly asset: 'PAPER_SOL';
  readonly amount: PaperSolDelta;
  readonly orderId: OrderId;
  readonly executionId: ExecutionId;
  readonly executionFees: readonly ExecutionFee[];
}

export type LedgerEntry =
  | RoundCreditLedgerEntry
  | BuyPaperSolDebitLedgerEntry
  | BuyTokenCreditLedgerEntry
  | SellTokenDebitLedgerEntry
  | SellPaperSolCreditLedgerEntry
  | ForcedSettlementTokenDebitLedgerEntry
  | ForcedSettlementPaperSolCreditLedgerEntry;

export interface HourlyResult {
  readonly hourlyRoundId: HourlyRoundId;
  readonly competitionAccountId: CompetitionAccountId;
  readonly userId: UserId;
  readonly finalSettledPaperSol: PaperSolBaseUnits;
  readonly pnl: PaperSolDelta;
  readonly finalizedAt: UtcInstant;
}

export interface DailyResult {
  readonly dailyCompetitionId: DailyCompetitionId;
  readonly userId: UserId;
  readonly cumulativePnl: PaperSolDelta;
  readonly completedHourlyRoundIds: readonly HourlyRoundId[];
  readonly completedHourlyResultCount: number;
}

export interface RewardBufferState {
  readonly balance: Lamports;
  readonly configurationVersion: string;
  readonly updatedAt: UtcInstant;
}

export type CreatorFeeAllocationMode = 'NORMAL' | 'BUFFER_ACCUMULATION';

export interface CreatorFeeAllocation {
  readonly mode: CreatorFeeAllocationMode;
  readonly total: Lamports;
  readonly currentHourly: Lamports;
  readonly daily: Lamports;
  readonly platform: Lamports;
  readonly rewardBuffer: Lamports;
  readonly hourlyRateBps: BasisPoints;
  readonly dailyRateBps: BasisPoints;
  readonly platformRateBps: BasisPoints;
  readonly rewardBufferRateBps: BasisPoints;
}
