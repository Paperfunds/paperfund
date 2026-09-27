const LAMPORTS_PER_SOL = 1_000_000_000n;

export function formatUnits(value: string | bigint, decimals: number, places = 4): string {
  const raw = typeof value === 'bigint' ? value : BigInt(value);
  const negative = raw < 0n;
  const absolute = negative ? -raw : raw;
  const scale = 10n ** BigInt(decimals);
  const whole = absolute / scale;
  const fraction = (absolute % scale)
    .toString()
    .padStart(decimals, '0')
    .slice(0, places)
    .replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole.toLocaleString('en-US')}${fraction ? `.${fraction}` : ''}`;
}

export function formatSol(value: string | bigint, places = 4): string {
  return `${formatUnits(value, 9, places)} SOL`;
}

export function solTextToLamports(value: string): bigint | null {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{0,9})?$/.test(value)) return null;
  const [whole = '0', fraction = ''] = value.split('.');
  return BigInt(whole) * LAMPORTS_PER_SOL + BigInt(fraction.padEnd(9, '0'));
}

export function lamportsToSolInput(value: bigint): string {
  const whole = value / LAMPORTS_PER_SOL;
  const fraction = (value % LAMPORTS_PER_SOL).toString().padStart(9, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export function percentageQuantity(quantity: string, percentage: 25 | 50 | 75 | 100): string {
  const total = BigInt(quantity);
  return percentage === 100 ? total.toString() : ((total * BigInt(percentage)) / 100n).toString();
}

export function shorten(value: string, size = 5): string {
  return value.length <= size * 2 + 1 ? value : `${value.slice(0, size)}…${value.slice(-size)}`;
}

export function venueName(protocol?: string | null): string {
  if (protocol === 'PUMP_FUN') return 'Pump.fun';
  if (protocol === 'PUMP_SWAP') return 'PumpSwap';
  return protocol ?? '—';
}

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
  | { status: 'UNAVAILABLE' | 'STALE' | 'UNSUPPORTED_ROUTE'; reason: string; valuedAt: string };
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
  reward_rank?: number | null;
  reward_allocation_lamports?: string | null;
  payout_plan_state?:
    | 'CALCULATED'
    | 'FROZEN'
    | 'VALIDATED'
    | 'APPROVED'
    | 'SIGNED'
    | 'BROADCAST'
    | 'VERIFIED'
    | 'FAILED_RETRYABLE'
    | 'FAILED_FINAL'
    | 'RECONCILIATION_REQUIRED'
    | null;
}
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}
export interface BuyResult {
  tokenMint: string;
  executionProtocol: string;
  actualPaperSolSpentLamports: string;
  tokenQuantityReceivedBaseUnits: string;
  feeLamports: string;
  executedAt: string;
}
export interface SellResult {
  tokenMint: string;
  executionProtocol: string;
  tokenAmountSoldBaseUnits: string;
  paperSolCreditedLamports: string;
  feeLamports: string;
  realizedPnlLamports: string;
  executedAt: string;
}
