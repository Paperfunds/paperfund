import {
  address,
  getAddressDecoder,
  getAddressEncoder,
  getProgramDerivedAddress,
} from '@solana/addresses';

import {
  identifier,
  paperSolBaseUnits,
  tokenBaseUnits,
  type AssetAmount,
  type ExecutionFee,
  type PaperSolBaseUnits,
  type ProtocolId,
} from '@paperfund/core';
import {
  createMarketStateEvidence,
  ExecutionEngineError,
  type BuySimulationRequest,
  type ExecutablePositionValue,
  type ExecutionRoute,
  type ExecutionRouteResolver,
  type JsonObject,
  type MarketIdentity,
  type MarketState,
  type MarketStateSource,
  type PositionExitValuationRequest,
  type ProtocolAdapter,
  type SellSimulationRequest,
  type SimulatedExecution,
} from '@paperfund/execution';

import {
  PUMP_FEE_PROGRAM_ID,
  PUMP_FUN_PROTOCOL_ID,
  PUMP_PROGRAM_ID,
  SPL_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  WRAPPED_SOL_MINT,
  decodePumpBondingCurve,
  pumpBondingCurveAddress,
  type PumpFunLogSink,
  type SolanaRpcClient,
} from './pump-fun.js';

export const PUMP_SWAP_PROTOCOL_ID: ProtocolId = identifier('PUMP_SWAP', 'ProtocolId');
export const PUMP_SWAP_ADAPTER_VERSION = 'pump-swap-canonical-v1';
export const PUMP_SWAP_NORMALIZATION_VERSION = 'pump-swap-state-v1';
export const PUMP_AMM_PROGRAM_ID = 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA';

const ZERO_PUBLIC_KEY = '11111111111111111111111111111111';
const BPS_DENOMINATOR = 10_000n;
const MAYHEM_TOKEN_SUPPLY = 1_000_000_000_000_000n;
const POOL_DISCRIMINATOR = Buffer.from([241, 154, 109, 4, 17, 177, 109, 188]);
const GLOBAL_CONFIG_DISCRIMINATOR = Buffer.from([149, 8, 156, 202, 160, 252, 176, 217]);
const FEE_CONFIG_DISCRIMINATOR = Buffer.from([143, 52, 146, 187, 219, 123, 76, 155]);
const addressDecoder = getAddressDecoder();
const addressEncoder = getAddressEncoder();
const discardLog: PumpFunLogSink = () => undefined;

interface RpcAccount {
  readonly data: readonly [string, string];
  readonly owner: string;
}

function requireBytes(data: Buffer, offset: number, length: number, label: string): void {
  if (offset < 0 || length < 0 || offset + length > data.length) {
    throw new ExecutionEngineError('INVALID_MARKET_STATE', `${label} account data is truncated.`);
  }
}

function assertDiscriminator(data: Buffer, expected: Buffer, label: string): void {
  requireBytes(data, 0, 8, label);
  if (!data.subarray(0, 8).equals(expected)) {
    throw new ExecutionEngineError('INVALID_MARKET_STATE', `${label} discriminator is invalid.`);
  }
}

function readU64(data: Buffer, offset: number, label: string): bigint {
  requireBytes(data, offset, 8, label);
  return data.readBigUInt64LE(offset);
}

function readU128(data: Buffer, offset: number, label: string): bigint {
  return readU64(data, offset, label) + (readU64(data, offset + 8, label) << 64n);
}

function readI128(data: Buffer, offset: number, label: string): bigint {
  const unsigned = readU128(data, offset, label);
  return unsigned >= 1n << 127n ? unsigned - (1n << 128n) : unsigned;
}

function readPublicKey(data: Buffer, offset: number, label: string): string {
  requireBytes(data, offset, 32, label);
  return addressDecoder.decode(data.subarray(offset, offset + 32));
}

function decodeRpcAccount(account: RpcAccount, label: string): Buffer {
  if (!Array.isArray(account.data) || account.data[1] !== 'base64') {
    throw new ExecutionEngineError('INVALID_MARKET_STATE', `${label} RPC encoding is invalid.`);
  }
  return Buffer.from(account.data[0], 'base64');
}

export interface DecodedPumpSwapPool {
  readonly poolBump: number;
  readonly index: number;
  readonly creator: string;
  readonly baseMint: string;
  readonly quoteMint: string;
  readonly lpMint: string;
  readonly baseVault: string;
  readonly quoteVault: string;
  readonly lpSupply: bigint;
  readonly coinCreator: string;
  readonly isMayhemMode: boolean;
  readonly isCashbackCoin: boolean;
  readonly virtualQuoteReserves: bigint;
  readonly creatorFeeBps: bigint;
  readonly canEditCreatorFee: boolean;
}

export function decodePumpSwapPool(data: Buffer): DecodedPumpSwapPool {
  if (data.length < 211) {
    throw new ExecutionEngineError('INVALID_MARKET_STATE', 'PumpSwap pool account is truncated.');
  }
  assertDiscriminator(data, POOL_DISCRIMINATOR, 'PumpSwap pool');
  return {
    poolBump: data[8]!,
    index: data.readUInt16LE(9),
    creator: readPublicKey(data, 11, 'PumpSwap pool'),
    baseMint: readPublicKey(data, 43, 'PumpSwap pool'),
    quoteMint: readPublicKey(data, 75, 'PumpSwap pool'),
    lpMint: readPublicKey(data, 107, 'PumpSwap pool'),
    baseVault: readPublicKey(data, 139, 'PumpSwap pool'),
    quoteVault: readPublicKey(data, 171, 'PumpSwap pool'),
    lpSupply: readU64(data, 203, 'PumpSwap pool'),
    coinCreator: data.length >= 243 ? readPublicKey(data, 211, 'PumpSwap pool') : ZERO_PUBLIC_KEY,
    isMayhemMode: data.length > 243 ? data[243] !== 0 : false,
    isCashbackCoin: data.length > 244 ? data[244] !== 0 : false,
    virtualQuoteReserves: data.length >= 261 ? readI128(data, 245, 'PumpSwap pool') : 0n,
    creatorFeeBps: data.length >= 269 ? readU64(data, 261, 'PumpSwap pool') : 0n,
    canEditCreatorFee: data.length > 269 ? data[269] !== 0 : false,
  };
}

interface DecodedGlobalConfig {
  readonly lpFeeBps: bigint;
  readonly protocolFeeBps: bigint;
  readonly creatorFeeBps: bigint;
  readonly disableFlags: number;
  readonly creatorFeeConfigurable: boolean;
  readonly maxConfigurableCreatorFeeBps: bigint;
}

export function decodePumpSwapGlobalConfig(data: Buffer): DecodedGlobalConfig {
  if (data.length < 321) {
    throw new ExecutionEngineError('INVALID_MARKET_STATE', 'PumpSwap global config is truncated.');
  }
  assertDiscriminator(data, GLOBAL_CONFIG_DISCRIMINATOR, 'PumpSwap global config');
  return {
    lpFeeBps: readU64(data, 40, 'PumpSwap global config'),
    protocolFeeBps: readU64(data, 48, 'PumpSwap global config'),
    disableFlags: data[56]!,
    creatorFeeBps: readU64(data, 313, 'PumpSwap global config'),
    creatorFeeConfigurable: data.length > 940 ? data[940] !== 0 : false,
    maxConfigurableCreatorFeeBps:
      data.length >= 949 ? readU64(data, 941, 'PumpSwap global config') : 0n,
  };
}

export interface PumpSwapFees {
  readonly lpFeeBps: bigint;
  readonly protocolFeeBps: bigint;
  readonly creatorFeeBps: bigint;
}

export interface PumpSwapFeeTier {
  readonly marketCapLamportsThreshold: bigint;
  readonly fees: PumpSwapFees;
}

interface DecodedFeeConfig {
  readonly flatFees: PumpSwapFees;
  readonly feeTiers: readonly PumpSwapFeeTier[];
  readonly accountLength: number;
}

function readFees(data: Buffer, offset: number, label: string): PumpSwapFees {
  return {
    lpFeeBps: readU64(data, offset, label),
    protocolFeeBps: readU64(data, offset + 8, label),
    creatorFeeBps: readU64(data, offset + 16, label),
  };
}

export function decodePumpSwapFeeConfig(data: Buffer): DecodedFeeConfig {
  if (data.length < 69) {
    throw new ExecutionEngineError('INVALID_MARKET_STATE', 'PumpSwap fee config is truncated.');
  }
  assertDiscriminator(data, FEE_CONFIG_DISCRIMINATOR, 'PumpSwap fee config');
  const count = data.readUInt32LE(65);
  if (count === 0 || count > 50) {
    throw new ExecutionEngineError('INVALID_MARKET_STATE', 'PumpSwap fee tier count is invalid.');
  }
  const feeTiers: PumpSwapFeeTier[] = [];
  let offset = 69;
  for (let index = 0; index < count; index += 1) {
    requireBytes(data, offset, 40, 'PumpSwap fee config');
    feeTiers.push({
      marketCapLamportsThreshold: readU128(data, offset, 'PumpSwap fee config'),
      fees: readFees(data, offset + 16, 'PumpSwap fee config'),
    });
    offset += 40;
  }
  for (let index = 1; index < feeTiers.length; index += 1) {
    if (
      feeTiers[index]!.marketCapLamportsThreshold < feeTiers[index - 1]!.marketCapLamportsThreshold
    ) {
      throw new ExecutionEngineError('INVALID_MARKET_STATE', 'PumpSwap fee tiers are not sorted.');
    }
  }
  return {
    flatFees: readFees(data, 41, 'PumpSwap fee config'),
    feeTiers,
    accountLength: data.length,
  };
}

async function derive(programId: string, seeds: Array<Buffer | Uint8Array>): Promise<string> {
  try {
    return (
      await getProgramDerivedAddress({
        programAddress: address(programId),
        seeds,
      })
    )[0];
  } catch {
    throw new ExecutionEngineError('INVALID_MARKET_STATE', 'A PumpSwap address is invalid.');
  }
}

export function pumpPoolAuthorityAddress(tokenMint: string): Promise<string> {
  return derive(PUMP_PROGRAM_ID, [
    Buffer.from('pool-authority'),
    Buffer.from(addressEncoder.encode(address(tokenMint))),
  ]);
}

export async function canonicalPumpSwapPoolAddress(tokenMint: string): Promise<string> {
  const creator = await pumpPoolAuthorityAddress(tokenMint);
  const index = Buffer.alloc(2);
  index.writeUInt16LE(0);
  return derive(PUMP_AMM_PROGRAM_ID, [
    Buffer.from('pool'),
    index,
    Buffer.from(addressEncoder.encode(address(creator))),
    Buffer.from(addressEncoder.encode(address(tokenMint))),
    Buffer.from(addressEncoder.encode(address(WRAPPED_SOL_MINT))),
  ]);
}

export function pumpSwapGlobalConfigAddress(): Promise<string> {
  return derive(PUMP_AMM_PROGRAM_ID, [Buffer.from('global_config')]);
}

export function pumpSwapFeeConfigAddress(): Promise<string> {
  return derive(PUMP_FEE_PROGRAM_ID, [
    Buffer.from('fee_config'),
    Buffer.from(addressEncoder.encode(address(PUMP_AMM_PROGRAM_ID))),
  ]);
}

interface TokenAccountState {
  readonly mint: string;
  readonly authority: string;
  readonly amount: bigint;
}

function decodeTokenAccount(data: Buffer, label: string): TokenAccountState {
  if (data.length < 165 || data[108] === 0) {
    throw new ExecutionEngineError('INVALID_MARKET_STATE', `${label} token account is invalid.`);
  }
  return {
    mint: readPublicKey(data, 0, label),
    authority: readPublicKey(data, 32, label),
    amount: readU64(data, 64, label),
  };
}

function selectFeeTier(tiers: readonly PumpSwapFeeTier[], marketCap: bigint): PumpSwapFeeTier {
  let selected = tiers[0]!;
  for (const tier of tiers) if (marketCap >= tier.marketCapLamportsThreshold) selected = tier;
  return selected;
}

interface PumpSwapNormalizedState extends JsonObject {
  readonly model: 'PUMP_SWAP_CANONICAL_POOL';
  readonly programId: string;
  readonly feeProgramId: string;
  readonly poolAddress: string;
  readonly canonicalCreator: string;
  readonly baseMint: string;
  readonly quoteMint: string;
  readonly baseVault: string;
  readonly quoteVault: string;
  readonly baseTokenProgram: string;
  readonly quoteTokenProgram: string;
  readonly tokenDecimals: string;
  readonly mintSupply: string;
  readonly baseReserves: string;
  readonly rawQuoteReserves: string;
  readonly virtualQuoteReserves: string;
  readonly effectiveQuoteReserves: string;
  readonly coinCreator: string;
  readonly isMayhemMode: boolean;
  readonly isCashbackCoin: boolean;
  readonly disableFlags: string;
  readonly lpFeeBps: string;
  readonly protocolFeeBps: string;
  readonly creatorFeeBps: string;
  readonly creatorFeeApplies: boolean;
  readonly feeTierMarketCapLamportsThreshold: string;
  readonly feeConfigAccountLength: string;
  readonly poolAccountLength: string;
  readonly stateSlots: JsonObject;
}

export class PumpSwapSolanaMarketStateSource implements MarketStateSource {
  constructor(
    readonly rpc: SolanaRpcClient,
    readonly log: PumpFunLogSink = discardLog,
  ) {}

  async loadMarketState(identity: MarketIdentity): Promise<MarketState> {
    if (identity.protocolId !== PUMP_SWAP_PROTOCOL_ID) {
      throw new ExecutionEngineError(
        'INVALID_MARKET_STATE',
        'PumpSwap protocol identity mismatch.',
      );
    }
    const [expectedPool, expectedCreator, globalAddress, feeConfigAddress] = await Promise.all([
      canonicalPumpSwapPoolAddress(identity.tokenMint),
      pumpPoolAuthorityAddress(identity.tokenMint),
      pumpSwapGlobalConfigAddress(),
      pumpSwapFeeConfigAddress(),
    ]);
    if (identity.marketId !== expectedPool) {
      throw new ExecutionEngineError(
        'INVALID_MARKET_STATE',
        'Requested market is not the canonical PumpSwap pool.',
      );
    }
    const first = await this.rpc.getMultipleAccounts([
      expectedPool,
      globalAddress,
      feeConfigAddress,
      identity.tokenMint,
    ]);
    const [poolAccount, globalAccount, feeAccount, mintAccount] =
      first.value as readonly (RpcAccount | null)[];
    if (!poolAccount) {
      throw new ExecutionEngineError(
        'MIGRATION_DESTINATION_UNAVAILABLE',
        'Canonical PumpSwap pool was not found.',
      );
    }
    if (!globalAccount || !feeAccount || !mintAccount) {
      throw new ExecutionEngineError(
        'MARKET_STATE_UNAVAILABLE',
        'Required PumpSwap market state is unavailable.',
      );
    }
    if (poolAccount.owner !== PUMP_AMM_PROGRAM_ID || globalAccount.owner !== PUMP_AMM_PROGRAM_ID) {
      throw new ExecutionEngineError('INVALID_MARKET_STATE', 'PumpSwap account owner is invalid.');
    }
    if (feeAccount.owner !== PUMP_FEE_PROGRAM_ID) {
      throw new ExecutionEngineError(
        'INVALID_MARKET_STATE',
        'PumpSwap fee config owner is invalid.',
      );
    }
    if (mintAccount.owner !== SPL_TOKEN_PROGRAM_ID && mintAccount.owner !== TOKEN_2022_PROGRAM_ID) {
      throw new ExecutionEngineError(
        'INVALID_MARKET_STATE',
        'PumpSwap base mint owner is invalid.',
      );
    }
    const poolBytes = decodeRpcAccount(poolAccount, 'PumpSwap pool');
    const pool = decodePumpSwapPool(poolBytes);
    if (
      pool.index !== 0 ||
      pool.creator !== expectedCreator ||
      pool.baseMint !== identity.tokenMint ||
      pool.quoteMint !== WRAPPED_SOL_MINT
    ) {
      throw new ExecutionEngineError('INVALID_MARKET_STATE', 'PumpSwap pool identity is invalid.');
    }
    const vaults = await this.rpc.getMultipleAccounts([pool.baseVault, pool.quoteVault]);
    const [baseVaultAccount, quoteVaultAccount] = vaults.value as readonly (RpcAccount | null)[];
    if (!baseVaultAccount || !quoteVaultAccount) {
      throw new ExecutionEngineError(
        'MARKET_STATE_UNAVAILABLE',
        'PumpSwap vault state is unavailable.',
      );
    }
    if (
      baseVaultAccount.owner !== mintAccount.owner ||
      quoteVaultAccount.owner !== SPL_TOKEN_PROGRAM_ID
    ) {
      throw new ExecutionEngineError(
        'INVALID_MARKET_STATE',
        'PumpSwap vault token program is invalid.',
      );
    }
    const baseVault = decodeTokenAccount(
      decodeRpcAccount(baseVaultAccount, 'Base vault'),
      'Base vault',
    );
    const quoteVault = decodeTokenAccount(
      decodeRpcAccount(quoteVaultAccount, 'Quote vault'),
      'Quote vault',
    );
    if (
      baseVault.mint !== identity.tokenMint ||
      quoteVault.mint !== WRAPPED_SOL_MINT ||
      baseVault.authority !== expectedPool ||
      quoteVault.authority !== expectedPool ||
      baseVault.amount <= 0n ||
      quoteVault.amount <= 0n
    ) {
      throw new ExecutionEngineError(
        'INVALID_MARKET_STATE',
        'PumpSwap vault identity or reserves are invalid.',
      );
    }
    const mintBytes = decodeRpcAccount(mintAccount, 'Base mint');
    if (mintBytes.length < 82 || mintBytes[45] === 0) {
      throw new ExecutionEngineError('INVALID_MARKET_STATE', 'PumpSwap base mint is invalid.');
    }
    const mintSupply = readU64(mintBytes, 36, 'Base mint');
    const global = decodePumpSwapGlobalConfig(
      decodeRpcAccount(globalAccount, 'PumpSwap global config'),
    );
    const feeConfig = decodePumpSwapFeeConfig(decodeRpcAccount(feeAccount, 'PumpSwap fee config'));
    const effectiveQuote = quoteVault.amount + pool.virtualQuoteReserves;
    if (effectiveQuote <= 0n || pool.virtualQuoteReserves < 0n) {
      throw new ExecutionEngineError(
        'INVALID_MARKET_STATE',
        'PumpSwap effective quote reserves are invalid.',
      );
    }
    const feeSupply = pool.isMayhemMode ? MAYHEM_TOKEN_SUPPLY : mintSupply;
    const marketCap = (effectiveQuote * feeSupply) / baseVault.amount;
    const selectedTier = selectFeeTier(feeConfig.feeTiers, marketCap);
    const creatorFeeBps =
      global.creatorFeeConfigurable && pool.creatorFeeBps > 0n
        ? pool.creatorFeeBps
        : selectedTier.fees.creatorFeeBps;
    const fees = { ...selectedTier.fees, creatorFeeBps };
    if (
      fees.lpFeeBps + fees.protocolFeeBps + fees.creatorFeeBps >= BPS_DENOMINATOR ||
      (global.creatorFeeConfigurable && creatorFeeBps > global.maxConfigurableCreatorFeeBps)
    ) {
      throw new ExecutionEngineError(
        'INVALID_MARKET_STATE',
        'PumpSwap fee configuration is invalid.',
      );
    }
    const normalizedState: PumpSwapNormalizedState = {
      model: 'PUMP_SWAP_CANONICAL_POOL',
      programId: PUMP_AMM_PROGRAM_ID,
      feeProgramId: PUMP_FEE_PROGRAM_ID,
      poolAddress: expectedPool,
      canonicalCreator: expectedCreator,
      baseMint: identity.tokenMint,
      quoteMint: WRAPPED_SOL_MINT,
      baseVault: pool.baseVault,
      quoteVault: pool.quoteVault,
      baseTokenProgram: mintAccount.owner,
      quoteTokenProgram: quoteVaultAccount.owner,
      tokenDecimals: mintBytes[44]!.toString(),
      mintSupply: mintSupply.toString(),
      baseReserves: baseVault.amount.toString(),
      rawQuoteReserves: quoteVault.amount.toString(),
      virtualQuoteReserves: pool.virtualQuoteReserves.toString(),
      effectiveQuoteReserves: effectiveQuote.toString(),
      coinCreator: pool.coinCreator,
      isMayhemMode: pool.isMayhemMode,
      isCashbackCoin: pool.isCashbackCoin,
      disableFlags: global.disableFlags.toString(),
      lpFeeBps: fees.lpFeeBps.toString(),
      protocolFeeBps: fees.protocolFeeBps.toString(),
      creatorFeeBps: fees.creatorFeeBps.toString(),
      creatorFeeApplies: pool.coinCreator !== ZERO_PUBLIC_KEY,
      feeTierMarketCapLamportsThreshold: selectedTier.marketCapLamportsThreshold.toString(),
      feeConfigAccountLength: feeConfig.accountLength.toString(),
      poolAccountLength: poolBytes.length.toString(),
      stateSlots: {
        configuration: first.context.slot.toString(),
        reserves: vaults.context.slot.toString(),
      },
    };
    const state: MarketState = {
      identity,
      observedAt: new Date().toISOString() as MarketState['observedAt'],
      chainSlot: BigInt(vaults.context.slot),
      chainBlockId: null,
      adapterVersion: PUMP_SWAP_ADAPTER_VERSION,
      normalizationVersion: PUMP_SWAP_NORMALIZATION_VERSION,
      normalizedState,
    };
    this.log('pump_swap_market_state_loaded', {
      protocol: PUMP_SWAP_PROTOCOL_ID,
      market: expectedPool,
      mint: identity.tokenMint,
      slot: vaults.context.slot.toString(),
      adapterVersion: PUMP_SWAP_ADAPTER_VERSION,
    });
    return state;
  }
}

interface MathState {
  readonly base: bigint;
  readonly rawQuote: bigint;
  readonly effectiveQuote: bigint;
  readonly virtualQuote: bigint;
  readonly lpFeeBps: bigint;
  readonly protocolFeeBps: bigint;
  readonly creatorFeeBps: bigint;
  readonly creatorFeeApplies: boolean;
  readonly disableFlags: number;
}

function asState(state: MarketState): PumpSwapNormalizedState {
  const value = state.normalizedState as Partial<PumpSwapNormalizedState>;
  if (
    state.identity.protocolId !== PUMP_SWAP_PROTOCOL_ID ||
    state.adapterVersion !== PUMP_SWAP_ADAPTER_VERSION ||
    state.normalizationVersion !== PUMP_SWAP_NORMALIZATION_VERSION ||
    value.model !== 'PUMP_SWAP_CANONICAL_POOL' ||
    value.programId !== PUMP_AMM_PROGRAM_ID ||
    value.poolAddress !== state.identity.marketId ||
    value.baseMint !== state.identity.tokenMint ||
    value.quoteMint !== WRAPPED_SOL_MINT
  ) {
    throw new ExecutionEngineError('INVALID_MARKET_STATE', 'PumpSwap normalized state is invalid.');
  }
  return value as PumpSwapNormalizedState;
}

function bigintField(value: unknown, label: string): bigint {
  if (typeof value !== 'string' || !/^-?[0-9]+$/.test(value)) {
    throw new ExecutionEngineError('INVALID_MARKET_STATE', `PumpSwap ${label} is invalid.`);
  }
  return BigInt(value);
}

function mathState(state: MarketState): MathState {
  const value = asState(state);
  const result = {
    base: bigintField(value.baseReserves, 'base reserves'),
    rawQuote: bigintField(value.rawQuoteReserves, 'quote reserves'),
    effectiveQuote: bigintField(value.effectiveQuoteReserves, 'effective quote reserves'),
    virtualQuote: bigintField(value.virtualQuoteReserves, 'virtual quote reserves'),
    lpFeeBps: bigintField(value.lpFeeBps, 'LP fee'),
    protocolFeeBps: bigintField(value.protocolFeeBps, 'protocol fee'),
    creatorFeeBps: bigintField(value.creatorFeeBps, 'creator fee'),
    creatorFeeApplies: value.creatorFeeApplies,
    disableFlags: Number(bigintField(value.disableFlags, 'disable flags')),
  };
  if (result.base <= 0n || result.rawQuote <= 0n || result.effectiveQuote <= 0n) {
    throw new ExecutionEngineError('INVALID_MARKET_STATE', 'PumpSwap reserves are invalid.');
  }
  return result;
}

function ceilDiv(value: bigint, divisor: bigint): bigint {
  if (value < 0n || divisor <= 0n)
    throw new ExecutionEngineError('INVALID_MARKET_STATE', 'Invalid division.');
  return (value + divisor - 1n) / divisor;
}

function fee(amount: bigint, bps: bigint): bigint {
  return bps === 0n ? 0n : ceilDiv(amount * bps, BPS_DENOMINATOR);
}

function feesFor(amount: bigint, state: MathState) {
  const lp = fee(amount, state.lpFeeBps);
  const protocol = fee(amount, state.protocolFeeBps);
  const creator = state.creatorFeeApplies ? fee(amount, state.creatorFeeBps) : 0n;
  return { lp, protocol, creator, total: lp + protocol + creator };
}

function feeBreakdown(fees: ReturnType<typeof feesFor>) {
  const values: ExecutionFee[] = [];
  if (fees.lp > 0n)
    values.push({
      category: 'PUMP_SWAP_LP_FEE',
      amount: { asset: 'PAPER_SOL', amount: paperSolBaseUnits(fees.lp) },
    });
  if (fees.protocol > 0n)
    values.push({
      category: 'PUMP_SWAP_PROTOCOL_FEE',
      amount: { asset: 'PAPER_SOL', amount: paperSolBaseUnits(fees.protocol) },
    });
  if (fees.creator > 0n)
    values.push({
      category: 'PUMP_SWAP_CREATOR_FEE',
      amount: { asset: 'PAPER_SOL', amount: paperSolBaseUnits(fees.creator) },
    });
  return { fees: values, totalPaperSolFees: paperSolBaseUnits(fees.total) };
}

export function simulatePumpSwapBuyAmount(totalBudget: bigint, state: MathState) {
  if (totalBudget <= 1n || (state.disableFlags & 8) !== 0) {
    throw new ExecutionEngineError(
      'INVALID_EXECUTION_RESULT',
      'PumpSwap BUY is disabled or has no usable input.',
    );
  }
  const totalFeeBps =
    state.lpFeeBps + state.protocolFeeBps + (state.creatorFeeApplies ? state.creatorFeeBps : 0n);
  let internalQuote = (totalBudget * BPS_DENOMINATOR) / (BPS_DENOMINATOR + totalFeeBps);
  let fees = feesFor(internalQuote, state);
  if (internalQuote + fees.total > totalBudget)
    internalQuote -= internalQuote + fees.total - totalBudget;
  if (internalQuote <= 1n)
    throw new ExecutionEngineError('INVALID_EXECUTION_RESULT', 'PumpSwap BUY produces no output.');
  const invariantInput = internalQuote - 1n;
  const tokenOutput = (state.base * invariantInput) / (state.effectiveQuote + invariantInput);
  if (tokenOutput <= 0n || tokenOutput >= state.base)
    throw new ExecutionEngineError('INVALID_EXECUTION_RESULT', 'PumpSwap BUY produces no output.');
  const exactInternalQuote = ceilDiv(state.effectiveQuote * tokenOutput, state.base - tokenOutput);
  fees = feesFor(exactInternalQuote, state);
  const totalInput = exactInternalQuote + fees.total;
  if (totalInput > totalBudget)
    throw new ExecutionEngineError(
      'INVALID_EXECUTION_RESULT',
      'PumpSwap BUY exceeds its input budget.',
    );
  return {
    totalInput,
    internalQuote: exactInternalQuote,
    tokenOutput,
    fees,
    details: {
      internalQuoteInputLamports: exactInternalQuote.toString(),
      requestedMaximumTotalLamports: totalBudget.toString(),
      postTrade: {
        baseReserves: (state.base - tokenOutput).toString(),
        rawQuoteReserves: (state.rawQuote + totalInput - fees.protocol - fees.creator).toString(),
        effectiveQuoteReserves: (
          state.effectiveQuote +
          totalInput -
          fees.protocol -
          fees.creator
        ).toString(),
      },
    } satisfies JsonObject,
  };
}

export function simulatePumpSwapSellAmount(tokenInput: bigint, state: MathState) {
  if (tokenInput <= 0n || (state.disableFlags & 16) !== 0) {
    throw new ExecutionEngineError(
      'INVALID_EXECUTION_RESULT',
      'PumpSwap SELL is disabled or invalid.',
    );
  }
  const gross = (state.effectiveQuote * tokenInput) / (state.base + tokenInput);
  const fees = feesFor(gross, state);
  const net = gross - fees.total;
  if (gross <= 0n || net <= 0n || state.rawQuote < gross - fees.lp) {
    throw new ExecutionEngineError(
      'INVALID_EXECUTION_RESULT',
      'PumpSwap SELL exceeds reserves or produces no output.',
    );
  }
  return {
    tokenInput,
    grossQuoteOutput: gross,
    netQuoteOutput: net,
    fees,
    details: {
      grossQuoteOutputLamports: gross.toString(),
      postTrade: {
        baseReserves: (state.base + tokenInput).toString(),
        rawQuoteReserves: (state.rawQuote - gross + fees.lp).toString(),
        effectiveQuoteReserves: (state.effectiveQuote - gross + fees.lp).toString(),
      },
    } satisfies JsonObject,
  };
}

function assertIdentity(expected: MarketIdentity, actual: MarketIdentity): void {
  if (
    expected.protocolId !== actual.protocolId ||
    expected.marketId !== actual.marketId ||
    expected.tokenMint !== actual.tokenMint
  ) {
    throw new ExecutionEngineError('INVALID_MARKET_STATE', 'PumpSwap identity mismatch.');
  }
}

export class PumpSwapProtocolAdapter implements ProtocolAdapter {
  readonly protocolId = PUMP_SWAP_PROTOCOL_ID;
  readonly adapterVersion = PUMP_SWAP_ADAPTER_VERSION;
  constructor(
    readonly source: MarketStateSource,
    readonly log: PumpFunLogSink = discardLog,
  ) {}
  async loadMarketState(identity: MarketIdentity): Promise<MarketState> {
    const state = await this.source.loadMarketState(identity);
    assertIdentity(identity, state.identity);
    asState(state);
    return state;
  }
  async simulateBuy(
    request: BuySimulationRequest,
    state: MarketState,
  ): Promise<SimulatedExecution> {
    assertIdentity(request.identity, state.identity);
    const result = simulatePumpSwapBuyAmount(request.requestedPaperSol, mathState(state));
    return this.execution(
      request,
      state,
      { asset: 'PAPER_SOL', amount: request.requestedPaperSol },
      { asset: 'PAPER_SOL', amount: paperSolBaseUnits(result.totalInput) },
      {
        asset: 'TOKEN',
        tokenMint: request.identity.tokenMint,
        amount: tokenBaseUnits(result.tokenOutput),
      },
      feeBreakdown(result.fees).fees,
      result.details,
    );
  }
  async simulateSell(
    request: SellSimulationRequest,
    state: MarketState,
  ): Promise<SimulatedExecution> {
    assertIdentity(request.identity, state.identity);
    const result = simulatePumpSwapSellAmount(request.requestedTokenQuantity, mathState(state));
    return this.execution(
      request,
      state,
      {
        asset: 'TOKEN',
        tokenMint: request.identity.tokenMint,
        amount: request.requestedTokenQuantity,
      },
      {
        asset: 'TOKEN',
        tokenMint: request.identity.tokenMint,
        amount: tokenBaseUnits(result.tokenInput),
      },
      { asset: 'PAPER_SOL', amount: paperSolBaseUnits(result.netQuoteOutput) },
      feeBreakdown(result.fees).fees,
      result.details,
    );
  }
  async valuePositionForExit(
    request: PositionExitValuationRequest,
    state: MarketState,
  ): Promise<ExecutablePositionValue> {
    assertIdentity(request.identity, state.identity);
    const result = simulatePumpSwapSellAmount(request.tokenQuantity, mathState(state));
    return {
      identity: request.identity,
      tokenQuantity: request.tokenQuantity,
      paperSolValue: paperSolBaseUnits(result.netQuoteOutput),
      feeBreakdown: feeBreakdown(result.fees),
      marketStateFingerprint: createMarketStateEvidence(state).fingerprint,
      adapterVersion: this.adapterVersion,
    };
  }
  private execution(
    request: BuySimulationRequest | SellSimulationRequest,
    state: MarketState,
    requestedInput: AssetAmount,
    actualInput: AssetAmount,
    output: AssetAmount,
    fees: readonly ExecutionFee[],
    executionDetails: JsonObject,
  ): SimulatedExecution {
    const evidence = createMarketStateEvidence(state);
    return {
      id: request.executionId,
      orderId: request.orderId,
      quote: {
        orderId: request.orderId,
        marketId: request.identity.marketId,
        protocolId: this.protocolId,
        adapterVersion: this.adapterVersion,
        marketStateRecordedAt: state.observedAt,
        marketStateFingerprint: evidence.fingerprint,
        normalizationVersion: state.normalizationVersion,
        requestedInput,
        simulatedOutput: output,
        fees,
      },
      actualInput,
      actualOutput: output,
      executedAt: request.executedAt,
      executionDetails,
    };
  }
}

export class PumpMigrationResolver implements ExecutionRouteResolver {
  readonly originProtocolId = PUMP_FUN_PROTOCOL_ID;
  constructor(readonly rpc: SolanaRpcClient) {}
  async resolveExecutionRoute(identity: MarketIdentity): Promise<ExecutionRoute> {
    if (identity.protocolId !== PUMP_FUN_PROTOCOL_ID)
      throw new ExecutionEngineError(
        'POSITION_EXECUTION_ROUTE_UNAVAILABLE',
        'Pump migration resolver received another protocol.',
      );
    const curveAddress = await pumpBondingCurveAddress(identity.tokenMint);
    if (identity.marketId !== curveAddress)
      throw new ExecutionEngineError(
        'INVALID_MARKET_STATE',
        'Pump position market is not its bonding curve.',
      );
    const response = await this.rpc.getMultipleAccounts([curveAddress]);
    const account = response.value[0] as RpcAccount | null;
    if (!account)
      throw new ExecutionEngineError(
        'MARKET_ACCOUNT_NOT_FOUND',
        'Pump bonding curve was not found.',
      );
    if (account.owner !== PUMP_PROGRAM_ID)
      throw new ExecutionEngineError(
        'INVALID_MARKET_STATE',
        'Pump bonding curve owner is invalid.',
      );
    const curve = decodePumpBondingCurve(decodeRpcAccount(account, 'Bonding curve'));
    if (!curve.complete && curve.realTokenReserves > 0n)
      return { originIdentity: identity, executionIdentity: identity, migrated: false };
    if (curve.quoteMint !== ZERO_PUBLIC_KEY && curve.quoteMint !== WRAPPED_SOL_MINT) {
      throw new ExecutionEngineError(
        'UNSUPPORTED_MIGRATED_PROTOCOL',
        'Only SOL-paired Pump migrations are supported.',
      );
    }
    const pool = await canonicalPumpSwapPoolAddress(identity.tokenMint);
    return {
      originIdentity: identity,
      executionIdentity: {
        protocolId: PUMP_SWAP_PROTOCOL_ID,
        marketId: identifier(pool, 'MarketId'),
        tokenMint: identity.tokenMint,
      },
      migrated: true,
    };
  }
}

export function pumpSwapPaperSolFeeTotal(fees: readonly ExecutionFee[]): PaperSolBaseUnits {
  return paperSolBaseUnits(
    fees.reduce(
      (total, item) => (item.amount.asset === 'PAPER_SOL' ? total + item.amount.amount : total),
      0n,
    ),
  );
}
