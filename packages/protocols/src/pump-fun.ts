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
  type TokenBaseUnits,
} from '@paperfund/core';
import {
  createMarketStateEvidence,
  ExecutionEngineError,
  type BuySimulationRequest,
  type ExecutablePositionValue,
  type ExecutionFeeBreakdown,
  type JsonObject,
  type MarketIdentity,
  type MarketState,
  type MarketStateSource,
  type PositionExitValuationRequest,
  type ProtocolAdapter,
  type SellSimulationRequest,
  type SimulatedExecution,
} from '@paperfund/execution';

export const PUMP_FUN_PROTOCOL_ID: ProtocolId = identifier('PUMP_FUN', 'ProtocolId');
export const PUMP_FUN_ADAPTER_VERSION = 'pump-bonding-curve-v1';
export const PUMP_FUN_NORMALIZATION_VERSION = 'pump-bonding-curve-state-v1';
export const PUMP_PROGRAM_ID = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
export const PUMP_FEE_PROGRAM_ID = 'pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ';
export const WRAPPED_SOL_MINT = 'So11111111111111111111111111111111111111112';
export const SPL_TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

const ZERO_PUBLIC_KEY = '11111111111111111111111111111111';
const ONE_BILLION_TOKEN_BASE_UNITS = 1_000_000_000_000_000n;
const BPS_DENOMINATOR = 10_000n;
const BONDING_CURVE_DISCRIMINATOR = Buffer.from([23, 183, 248, 55, 96, 216, 172, 96]);
const GLOBAL_DISCRIMINATOR = Buffer.from([167, 232, 232, 177, 200, 108, 114, 127]);
const FEE_CONFIG_DISCRIMINATOR = Buffer.from([143, 52, 146, 187, 219, 123, 76, 155]);
const addressDecoder = getAddressDecoder();
const addressEncoder = getAddressEncoder();

export interface PumpFeeTier {
  readonly marketCapLamportsThreshold: bigint;
  readonly protocolFeeBps: bigint;
  readonly creatorFeeBps: bigint;
}

export interface DecodedPumpBondingCurve {
  readonly virtualTokenReserves: bigint;
  readonly virtualSolReserves: bigint;
  readonly realTokenReserves: bigint;
  readonly realSolReserves: bigint;
  readonly tokenTotalSupply: bigint;
  readonly complete: boolean;
  readonly creator: string;
  readonly isMayhemMode: boolean;
  readonly isCashbackCoin: boolean;
  readonly quoteMint: string;
  readonly creatorFeeBps: bigint;
  readonly isHolderReward: boolean;
}

export interface DecodedPumpGlobal {
  readonly feeBasisPoints: bigint;
  readonly creatorFeeBasisPoints: bigint;
  readonly creatorFeeConfigurable: boolean;
}

export interface DecodedPumpFeeConfig {
  readonly feeTiers: readonly PumpFeeTier[];
  readonly accountLength: number;
}

interface PumpNormalizedState extends JsonObject {
  readonly model: 'PUMP_FUN_BONDING_CURVE';
  readonly programId: string;
  readonly feeProgramId: string;
  readonly bondingCurveAddress: string;
  readonly globalAddress: string;
  readonly feeConfigAddress: string;
  readonly tokenMint: string;
  readonly tokenProgram: string;
  readonly tokenDecimals: string;
  readonly quoteAsset: 'SOL';
  readonly virtualTokenReserves: string;
  readonly virtualSolReserves: string;
  readonly realTokenReserves: string;
  readonly realSolReserves: string;
  readonly tokenTotalSupply: string;
  readonly mintSupply: string;
  readonly feeEvaluationMintSupply: string;
  readonly complete: boolean;
  readonly creator: string;
  readonly isMayhemMode: boolean;
  readonly isCashbackCoin: boolean;
  readonly isHolderReward: boolean;
  readonly configuredCreatorFeeBps: string;
  readonly creatorFeeConfigurable: boolean;
  readonly protocolFeeBps: string;
  readonly creatorFeeBps: string;
  readonly feeTierMarketCapLamportsThreshold: string;
  readonly feeConfigAccountLength: string;
}

function requireBytes(data: Buffer, offset: number, length: number, label: string): void {
  if (offset < 0 || length < 0 || offset + length > data.length) {
    throw new ExecutionEngineError('INVALID_MARKET_STATE', `${label} account data is truncated.`);
  }
}

function assertDiscriminator(data: Buffer, expected: Buffer, label: string): void {
  requireBytes(data, 0, expected.length, label);
  if (!data.subarray(0, expected.length).equals(expected)) {
    throw new ExecutionEngineError('INVALID_MARKET_STATE', `${label} discriminator is invalid.`);
  }
}

function readU64(data: Buffer, offset: number, label: string): bigint {
  requireBytes(data, offset, 8, label);
  return data.readBigUInt64LE(offset);
}

function readU128(data: Buffer, offset: number, label: string): bigint {
  requireBytes(data, offset, 16, label);
  return data.readBigUInt64LE(offset) + (data.readBigUInt64LE(offset + 8) << 64n);
}

function readPublicKey(data: Buffer, offset: number, label: string): string {
  requireBytes(data, offset, 32, label);
  return addressDecoder.decode(data.subarray(offset, offset + 32));
}

export function decodePumpBondingCurve(data: Buffer): DecodedPumpBondingCurve {
  if (data.length < 49) {
    throw new ExecutionEngineError('INVALID_MARKET_STATE', 'Bonding curve account is truncated.');
  }
  assertDiscriminator(data, BONDING_CURVE_DISCRIMINATOR, 'Bonding curve');
  const optionalPublicKey = (offset: number): string =>
    data.length >= offset + 32 ? readPublicKey(data, offset, 'Bonding curve') : ZERO_PUBLIC_KEY;
  const optionalBool = (offset: number): boolean =>
    data.length > offset ? data[offset] !== 0 : false;
  const optionalU64 = (offset: number): bigint =>
    data.length >= offset + 8 ? readU64(data, offset, 'Bonding curve') : 0n;
  return {
    virtualTokenReserves: readU64(data, 8, 'Bonding curve'),
    virtualSolReserves: readU64(data, 16, 'Bonding curve'),
    realTokenReserves: readU64(data, 24, 'Bonding curve'),
    realSolReserves: readU64(data, 32, 'Bonding curve'),
    tokenTotalSupply: readU64(data, 40, 'Bonding curve'),
    complete: data[48] !== 0,
    creator: optionalPublicKey(49),
    isMayhemMode: optionalBool(81),
    isCashbackCoin: optionalBool(82),
    quoteMint: optionalPublicKey(83),
    creatorFeeBps: optionalU64(115),
    isHolderReward: optionalBool(124),
  };
}

export function decodePumpGlobal(data: Buffer): DecodedPumpGlobal {
  if (data.length < 162) {
    throw new ExecutionEngineError('INVALID_MARKET_STATE', 'Pump global account is truncated.');
  }
  assertDiscriminator(data, GLOBAL_DISCRIMINATOR, 'Pump global');
  return {
    feeBasisPoints: readU64(data, 105, 'Pump global'),
    creatorFeeBasisPoints: readU64(data, 154, 'Pump global'),
    creatorFeeConfigurable: data.length > 1045 ? data[1045] !== 0 : false,
  };
}

export function decodePumpFeeConfig(data: Buffer): DecodedPumpFeeConfig {
  if (data.length < 69) {
    throw new ExecutionEngineError('INVALID_MARKET_STATE', 'Pump fee config account is truncated.');
  }
  assertDiscriminator(data, FEE_CONFIG_DISCRIMINATOR, 'Pump fee config');
  const count = data.readUInt32LE(65);
  if (count === 0 || count > 50) {
    throw new ExecutionEngineError('INVALID_MARKET_STATE', 'Pump fee tier count is invalid.');
  }
  const tiers: PumpFeeTier[] = [];
  let offset = 69;
  for (let index = 0; index < count; index += 1) {
    requireBytes(data, offset, 40, 'Pump fee config');
    tiers.push({
      marketCapLamportsThreshold: readU128(data, offset, 'Pump fee config'),
      protocolFeeBps: readU64(data, offset + 24, 'Pump fee config'),
      creatorFeeBps: readU64(data, offset + 32, 'Pump fee config'),
    });
    offset += 40;
  }
  for (let index = 1; index < tiers.length; index += 1) {
    if (tiers[index]!.marketCapLamportsThreshold < tiers[index - 1]!.marketCapLamportsThreshold) {
      throw new ExecutionEngineError('INVALID_MARKET_STATE', 'Pump fee tiers are not sorted.');
    }
  }
  return { feeTiers: tiers, accountLength: data.length };
}

export async function pumpBondingCurveAddress(tokenMint: string): Promise<string> {
  try {
    return (
      await getProgramDerivedAddress({
        programAddress: address(PUMP_PROGRAM_ID),
        seeds: [Buffer.from('bonding-curve'), addressEncoder.encode(address(tokenMint))],
      })
    )[0];
  } catch {
    throw new ExecutionEngineError(
      'INVALID_MARKET_STATE',
      'Pump token mint is not a valid public key.',
    );
  }
}

export async function pumpGlobalAddress(): Promise<string> {
  return (
    await getProgramDerivedAddress({
      programAddress: address(PUMP_PROGRAM_ID),
      seeds: [Buffer.from('global')],
    })
  )[0];
}

export async function pumpFeeConfigAddress(): Promise<string> {
  return (
    await getProgramDerivedAddress({
      programAddress: address(PUMP_FEE_PROGRAM_ID),
      seeds: [Buffer.from('fee_config'), addressEncoder.encode(address(PUMP_PROGRAM_ID))],
    })
  )[0];
}

function selectFeeTier(tiers: readonly PumpFeeTier[], marketCap: bigint): PumpFeeTier {
  let selected = tiers[0]!;
  for (const tier of tiers) {
    if (marketCap >= tier.marketCapLamportsThreshold) selected = tier;
  }
  return selected;
}

function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  if (numerator < 0n || denominator <= 0n) {
    throw new ExecutionEngineError('INVALID_MARKET_STATE', 'Invalid integer division operands.');
  }
  return (numerator + denominator - 1n) / denominator;
}

function calculateFee(amount: bigint, bps: bigint): bigint {
  return ceilDiv(amount * bps, BPS_DENOMINATOR);
}

export function validatePumpBondingCurve(curve: DecodedPumpBondingCurve): void {
  if (curve.complete || curve.realTokenReserves === 0n) {
    throw new ExecutionEngineError(
      'MARKET_MIGRATED',
      'Pump bonding curve is complete or migrated.',
    );
  }
  if (
    curve.virtualTokenReserves <= 0n ||
    curve.virtualSolReserves <= 0n ||
    curve.realTokenReserves < 0n ||
    curve.realSolReserves < 0n ||
    curve.tokenTotalSupply <= 0n
  ) {
    throw new ExecutionEngineError(
      'INVALID_MARKET_STATE',
      'Pump bonding curve reserves are invalid.',
    );
  }
  if (curve.quoteMint !== ZERO_PUBLIC_KEY && curve.quoteMint !== WRAPPED_SOL_MINT) {
    throw new ExecutionEngineError(
      'INVALID_MARKET_STATE',
      'This adapter supports only SOL-paired Pump bonding curves.',
    );
  }
}

interface RpcAccount {
  readonly data: readonly [string, string];
  readonly owner: string;
}

interface MultipleAccountsResponse {
  readonly context: { readonly slot: number };
  readonly value: readonly (RpcAccount | null)[];
}

export interface SolanaRpcClientOptions {
  readonly url: string;
  readonly commitment?: 'processed' | 'confirmed' | 'finalized';
  readonly timeoutMs?: number;
  readonly fetchImplementation?: typeof fetch;
}

export type PumpFunLogSink = (event: string, metadata: JsonObject) => void;

const discardLog: PumpFunLogSink = () => undefined;

export class SolanaRpcClient {
  readonly #url: string;
  readonly #commitment: 'processed' | 'confirmed' | 'finalized';
  readonly #timeoutMs: number;
  readonly #fetch: typeof fetch;
  #requestId = 0;

  constructor(options: SolanaRpcClientOptions) {
    if (!options.url) throw new ExecutionEngineError('RPC_ERROR', 'SOLANA_RPC_URL is required.');
    if ((options.timeoutMs ?? 10_000) <= 0) {
      throw new ExecutionEngineError('RPC_ERROR', 'SOLANA_RPC_TIMEOUT_MS must be positive.');
    }
    this.#url = options.url;
    this.#commitment = options.commitment ?? 'confirmed';
    this.#timeoutMs = options.timeoutMs ?? 10_000;
    this.#fetch = options.fetchImplementation ?? fetch;
  }

  async getMultipleAccounts(addresses: readonly string[]): Promise<MultipleAccountsResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.#timeoutMs);
    try {
      const response = await this.#fetch(this.#url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: ++this.#requestId,
          method: 'getMultipleAccounts',
          params: [addresses, { encoding: 'base64', commitment: this.#commitment }],
        }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status.toString()}`);
      const body = (await response.json()) as {
        readonly result?: MultipleAccountsResponse;
        readonly error?: { readonly code?: number; readonly message?: string };
      };
      if (body.error || !body.result || !Array.isArray(body.result.value)) {
        throw new Error('Malformed or rejected JSON-RPC response');
      }
      return body.result;
    } catch (error) {
      if (error instanceof ExecutionEngineError) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw new ExecutionEngineError('RPC_TIMEOUT', 'Solana RPC request timed out.');
      }
      throw new ExecutionEngineError('RPC_ERROR', 'Solana RPC request failed.');
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function solanaRpcClientFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): SolanaRpcClient {
  const timeout = environment['SOLANA_RPC_TIMEOUT_MS'];
  const parsedTimeout = timeout === undefined || timeout === '' ? 10_000 : Number(timeout);
  if (!Number.isSafeInteger(parsedTimeout) || parsedTimeout <= 0) {
    throw new ExecutionEngineError(
      'RPC_ERROR',
      'SOLANA_RPC_TIMEOUT_MS must be a positive integer.',
    );
  }
  const commitment = environment['SOLANA_COMMITMENT'];
  if (
    commitment !== undefined &&
    commitment !== '' &&
    commitment !== 'processed' &&
    commitment !== 'confirmed' &&
    commitment !== 'finalized'
  ) {
    throw new ExecutionEngineError('RPC_ERROR', 'SOLANA_COMMITMENT is invalid.');
  }
  return new SolanaRpcClient({
    url: environment['SOLANA_RPC_URL'] ?? '',
    timeoutMs: parsedTimeout,
    ...(commitment ? { commitment } : {}),
  });
}

function decodeRpcAccount(account: RpcAccount, label: string): Buffer {
  if (!Array.isArray(account.data) || account.data[1] !== 'base64') {
    throw new ExecutionEngineError('INVALID_MARKET_STATE', `${label} RPC encoding is invalid.`);
  }
  try {
    return Buffer.from(account.data[0], 'base64');
  } catch {
    throw new ExecutionEngineError('INVALID_MARKET_STATE', `${label} account data is invalid.`);
  }
}

export class PumpFunSolanaMarketStateSource implements MarketStateSource {
  constructor(
    readonly rpc: SolanaRpcClient,
    readonly log: PumpFunLogSink = discardLog,
  ) {}

  async loadMarketState(identity: MarketIdentity): Promise<MarketState> {
    if (identity.protocolId !== PUMP_FUN_PROTOCOL_ID) {
      throw new ExecutionEngineError('INVALID_MARKET_STATE', 'Pump protocol identity mismatch.');
    }
    const [bondingCurveAddress, globalAddress, feeConfigAddress] = await Promise.all([
      pumpBondingCurveAddress(identity.tokenMint),
      pumpGlobalAddress(),
      pumpFeeConfigAddress(),
    ]);
    if (identity.marketId !== bondingCurveAddress) {
      throw new ExecutionEngineError(
        'INVALID_MARKET_STATE',
        'Requested market is not the bonding-curve PDA for the requested mint.',
      );
    }
    const addresses = [bondingCurveAddress, globalAddress, feeConfigAddress, identity.tokenMint];
    const response = await this.rpc.getMultipleAccounts(addresses);
    if (response.value.length !== addresses.length) {
      throw new ExecutionEngineError(
        'RPC_ERROR',
        'Solana RPC returned an inconsistent account set.',
      );
    }
    const [curveAccount, globalAccount, feeConfigAccount, mintAccount] = response.value;
    if (!curveAccount) {
      throw new ExecutionEngineError(
        'MARKET_ACCOUNT_NOT_FOUND',
        'Pump bonding curve was not found.',
      );
    }
    if (!globalAccount || !feeConfigAccount || !mintAccount) {
      throw new ExecutionEngineError(
        'MARKET_STATE_UNAVAILABLE',
        'Required Pump market state is unavailable.',
      );
    }
    if (curveAccount.owner !== PUMP_PROGRAM_ID || globalAccount.owner !== PUMP_PROGRAM_ID) {
      throw new ExecutionEngineError('INVALID_MARKET_STATE', 'Pump account owner is invalid.');
    }
    if (feeConfigAccount.owner !== PUMP_FEE_PROGRAM_ID) {
      throw new ExecutionEngineError('INVALID_MARKET_STATE', 'Pump fee config owner is invalid.');
    }
    if (mintAccount.owner !== SPL_TOKEN_PROGRAM_ID && mintAccount.owner !== TOKEN_2022_PROGRAM_ID) {
      throw new ExecutionEngineError('INVALID_MARKET_STATE', 'Pump token mint owner is invalid.');
    }
    const curveBytes = decodeRpcAccount(curveAccount, 'Bonding curve');
    const globalBytes = decodeRpcAccount(globalAccount, 'Pump global');
    const feeConfigBytes = decodeRpcAccount(feeConfigAccount, 'Pump fee config');
    const mintBytes = decodeRpcAccount(mintAccount, 'Token mint');
    if (mintBytes.length < 82 || mintBytes[45] === 0) {
      throw new ExecutionEngineError('INVALID_MARKET_STATE', 'Pump token mint account is invalid.');
    }
    const curve = decodePumpBondingCurve(curveBytes);
    validatePumpBondingCurve(curve);
    const global = decodePumpGlobal(globalBytes);
    const feeConfig = decodePumpFeeConfig(feeConfigBytes);
    const mintSupply = readU64(mintBytes, 36, 'Token mint');
    const tokenDecimals = mintBytes[44]!;
    const feeEvaluationMintSupply = curve.isMayhemMode ? mintSupply : ONE_BILLION_TOKEN_BASE_UNITS;
    const marketCap =
      (curve.virtualSolReserves * feeEvaluationMintSupply) / curve.virtualTokenReserves;
    const feeTier = selectFeeTier(feeConfig.feeTiers, marketCap);
    const creatorFeeBps =
      global.creatorFeeConfigurable && curve.creatorFeeBps > 0n
        ? curve.creatorFeeBps
        : feeTier.creatorFeeBps;
    if (feeTier.protocolFeeBps > BPS_DENOMINATOR || creatorFeeBps > BPS_DENOMINATOR) {
      throw new ExecutionEngineError('INVALID_MARKET_STATE', 'Pump fee basis points are invalid.');
    }
    const normalizedState: PumpNormalizedState = {
      model: 'PUMP_FUN_BONDING_CURVE',
      programId: PUMP_PROGRAM_ID,
      feeProgramId: PUMP_FEE_PROGRAM_ID,
      bondingCurveAddress,
      globalAddress,
      feeConfigAddress,
      tokenMint: identity.tokenMint,
      tokenProgram: mintAccount.owner,
      tokenDecimals: tokenDecimals.toString(),
      quoteAsset: 'SOL',
      virtualTokenReserves: curve.virtualTokenReserves.toString(),
      virtualSolReserves: curve.virtualSolReserves.toString(),
      realTokenReserves: curve.realTokenReserves.toString(),
      realSolReserves: curve.realSolReserves.toString(),
      tokenTotalSupply: curve.tokenTotalSupply.toString(),
      mintSupply: mintSupply.toString(),
      feeEvaluationMintSupply: feeEvaluationMintSupply.toString(),
      complete: curve.complete,
      creator: curve.creator,
      isMayhemMode: curve.isMayhemMode,
      isCashbackCoin: curve.isCashbackCoin,
      isHolderReward: curve.isHolderReward,
      configuredCreatorFeeBps: curve.creatorFeeBps.toString(),
      creatorFeeConfigurable: global.creatorFeeConfigurable,
      protocolFeeBps: feeTier.protocolFeeBps.toString(),
      creatorFeeBps: creatorFeeBps.toString(),
      feeTierMarketCapLamportsThreshold: feeTier.marketCapLamportsThreshold.toString(),
      feeConfigAccountLength: feeConfig.accountLength.toString(),
    };
    const state: MarketState = {
      identity,
      observedAt: new Date().toISOString() as MarketState['observedAt'],
      chainSlot: BigInt(response.context.slot),
      chainBlockId: null,
      adapterVersion: PUMP_FUN_ADAPTER_VERSION,
      normalizationVersion: PUMP_FUN_NORMALIZATION_VERSION,
      normalizedState,
      rawSource: {
        source: 'solana-json-rpc:getMultipleAccounts',
        addresses,
        accountDataBase64: [
          curveAccount.data[0],
          globalAccount.data[0],
          feeConfigAccount.data[0],
          mintAccount.data[0],
        ],
      },
    };
    this.log('pump_market_state_loaded', {
      protocol: PUMP_FUN_PROTOCOL_ID,
      market: identity.marketId,
      mint: identity.tokenMint,
      stateSlot: response.context.slot.toString(),
      adapterVersion: PUMP_FUN_ADAPTER_VERSION,
    });
    return state;
  }
}

function asPumpState(state: MarketState): PumpNormalizedState {
  const value = state.normalizedState;
  const requiredStrings = [
    'bondingCurveAddress',
    'tokenMint',
    'virtualTokenReserves',
    'virtualSolReserves',
    'realTokenReserves',
    'realSolReserves',
    'tokenTotalSupply',
    'mintSupply',
    'protocolFeeBps',
    'creatorFeeBps',
  ];
  if (
    state.adapterVersion !== PUMP_FUN_ADAPTER_VERSION ||
    state.normalizationVersion !== PUMP_FUN_NORMALIZATION_VERSION ||
    value['model'] !== 'PUMP_FUN_BONDING_CURVE' ||
    value['programId'] !== PUMP_PROGRAM_ID ||
    value['quoteAsset'] !== 'SOL' ||
    value['complete'] !== false ||
    requiredStrings.some((key) => typeof value[key] !== 'string')
  ) {
    throw new ExecutionEngineError(
      'INVALID_MARKET_STATE',
      'Normalized Pump market state is invalid.',
    );
  }
  if (
    value['tokenMint'] !== state.identity.tokenMint ||
    value['bondingCurveAddress'] !== state.identity.marketId
  ) {
    throw new ExecutionEngineError(
      'INVALID_MARKET_STATE',
      'Normalized Pump market identity is invalid.',
    );
  }
  return value as PumpNormalizedState;
}

interface PumpMathState {
  readonly virtualToken: bigint;
  readonly virtualSol: bigint;
  readonly realToken: bigint;
  readonly realSol: bigint;
  readonly protocolFeeBps: bigint;
  readonly creatorFeeBps: bigint;
  readonly creatorFeeApplies: boolean;
}

function mathState(state: MarketState): PumpMathState {
  const normalized = asPumpState(state);
  const result = {
    virtualToken: BigInt(normalized.virtualTokenReserves),
    virtualSol: BigInt(normalized.virtualSolReserves),
    realToken: BigInt(normalized.realTokenReserves),
    realSol: BigInt(normalized.realSolReserves),
    protocolFeeBps: BigInt(normalized.protocolFeeBps),
    creatorFeeBps: BigInt(normalized.creatorFeeBps),
    creatorFeeApplies: normalized.creator !== ZERO_PUBLIC_KEY,
  };
  if (result.virtualToken <= 0n || result.virtualSol <= 0n || result.realToken <= 0n) {
    throw new ExecutionEngineError(
      'INVALID_MARKET_STATE',
      'Normalized Pump reserves are impossible.',
    );
  }
  return result;
}

function feesFor(
  amount: bigint,
  state: PumpMathState,
): {
  readonly protocol: bigint;
  readonly creator: bigint;
  readonly total: bigint;
} {
  const protocol = calculateFee(amount, state.protocolFeeBps);
  const creator = state.creatorFeeApplies ? calculateFee(amount, state.creatorFeeBps) : 0n;
  return { protocol, creator, total: protocol + creator };
}

function feeBreakdown(value: ReturnType<typeof feesFor>): ExecutionFeeBreakdown {
  const fees: ExecutionFee[] = [];
  if (value.protocol > 0n) {
    fees.push({
      category: 'PUMP_FUN_PROTOCOL_FEE',
      amount: { asset: 'PAPER_SOL', amount: paperSolBaseUnits(value.protocol) },
    });
  }
  if (value.creator > 0n) {
    fees.push({
      category: 'PUMP_FUN_CREATOR_FEE',
      amount: { asset: 'PAPER_SOL', amount: paperSolBaseUnits(value.creator) },
    });
  }
  return { fees, totalPaperSolFees: paperSolBaseUnits(value.total) };
}

interface PumpBuyResult {
  readonly totalInput: bigint;
  readonly curveInput: bigint;
  readonly tokenOutput: bigint;
  readonly fees: ReturnType<typeof feesFor>;
  readonly details: JsonObject;
}

function simulatePumpBuyAmount(maximumTotalInput: bigint, state: PumpMathState): PumpBuyResult {
  if (maximumTotalInput <= 0n) {
    throw new ExecutionEngineError('INVALID_EXECUTION_RESULT', 'Pump BUY input must be positive.');
  }
  const totalFeeBps = state.protocolFeeBps + (state.creatorFeeApplies ? state.creatorFeeBps : 0n);
  const curveBudget =
    maximumTotalInput <= 1n
      ? 0n
      : ((maximumTotalInput - 1n) * BPS_DENOMINATOR) / (BPS_DENOMINATOR + totalFeeBps);
  const uncappedOutput = (curveBudget * state.virtualToken) / (state.virtualSol + curveBudget);
  const tokenOutput = uncappedOutput < state.realToken ? uncappedOutput : state.realToken;
  if (tokenOutput <= 0n || tokenOutput >= state.virtualToken) {
    throw new ExecutionEngineError(
      'INVALID_EXECUTION_RESULT',
      'Pump BUY produces no valid token output.',
    );
  }
  const curveInput = (tokenOutput * state.virtualSol) / (state.virtualToken - tokenOutput) + 1n;
  const fees = feesFor(curveInput, state);
  const totalInput = curveInput + fees.total;
  if (totalInput > maximumTotalInput) {
    throw new ExecutionEngineError(
      'INVALID_EXECUTION_RESULT',
      'Pump BUY exceeds requested total input.',
    );
  }
  const postVirtualToken = state.virtualToken - tokenOutput;
  const postVirtualSol = state.virtualSol + curveInput;
  const postRealToken = state.realToken - tokenOutput;
  const postRealSol = state.realSol + curveInput;
  if (postVirtualToken <= 0n || postRealToken < 0n) {
    throw new ExecutionEngineError(
      'INVALID_EXECUTION_RESULT',
      'Pump BUY reserve result is invalid.',
    );
  }
  const averageVsSpotBps =
    (totalInput * state.virtualToken * BPS_DENOMINATOR) / (tokenOutput * state.virtualSol) -
    BPS_DENOMINATOR;
  return {
    totalInput,
    curveInput,
    tokenOutput,
    fees,
    details: {
      curveInputLamports: curveInput.toString(),
      requestedMaximumTotalLamports: maximumTotalInput.toString(),
      protocolFeeLamports: fees.protocol.toString(),
      creatorFeeLamports: fees.creator.toString(),
      averageVsPreTradeSpotBps: averageVsSpotBps.toString(),
      postTrade: {
        virtualTokenReserves: postVirtualToken.toString(),
        virtualSolReserves: postVirtualSol.toString(),
        realTokenReserves: postRealToken.toString(),
        realSolReserves: postRealSol.toString(),
      },
    },
  };
}

interface PumpSellResult {
  readonly tokenInput: bigint;
  readonly grossSolOutput: bigint;
  readonly netSolOutput: bigint;
  readonly fees: ReturnType<typeof feesFor>;
  readonly details: JsonObject;
}

function simulatePumpSellAmount(tokenInput: bigint, state: PumpMathState): PumpSellResult {
  if (tokenInput <= 0n) {
    throw new ExecutionEngineError('INVALID_EXECUTION_RESULT', 'Pump SELL input must be positive.');
  }
  const grossSolOutput = (tokenInput * state.virtualSol) / (state.virtualToken + tokenInput);
  const fees = feesFor(grossSolOutput, state);
  const netSolOutput = grossSolOutput - fees.total;
  if (grossSolOutput <= 0n || netSolOutput <= 0n || grossSolOutput > state.realSol) {
    throw new ExecutionEngineError(
      'INVALID_EXECUTION_RESULT',
      'Pump SELL exceeds real reserves or produces no net SOL.',
    );
  }
  const postVirtualToken = state.virtualToken + tokenInput;
  const postVirtualSol = state.virtualSol - grossSolOutput;
  const postRealToken = state.realToken + tokenInput;
  const postRealSol = state.realSol - grossSolOutput;
  if (postVirtualSol <= 0n || postRealSol < 0n) {
    throw new ExecutionEngineError(
      'INVALID_EXECUTION_RESULT',
      'Pump SELL reserve result is invalid.',
    );
  }
  const spotVsAverageBps =
    BPS_DENOMINATOR -
    (netSolOutput * state.virtualToken * BPS_DENOMINATOR) / (tokenInput * state.virtualSol);
  return {
    tokenInput,
    grossSolOutput,
    netSolOutput,
    fees,
    details: {
      grossSolOutputLamports: grossSolOutput.toString(),
      protocolFeeLamports: fees.protocol.toString(),
      creatorFeeLamports: fees.creator.toString(),
      preTradeSpotVsAverageBps: spotVsAverageBps.toString(),
      postTrade: {
        virtualTokenReserves: postVirtualToken.toString(),
        virtualSolReserves: postVirtualSol.toString(),
        realTokenReserves: postRealToken.toString(),
        realSolReserves: postRealSol.toString(),
      },
    },
  };
}

function assertIdentity(expected: MarketIdentity, actual: MarketIdentity): void {
  if (
    expected.protocolId !== actual.protocolId ||
    expected.marketId !== actual.marketId ||
    expected.tokenMint !== actual.tokenMint
  ) {
    throw new ExecutionEngineError('INVALID_MARKET_STATE', 'Pump market-state identity mismatch.');
  }
}

export class PumpFunProtocolAdapter implements ProtocolAdapter {
  readonly protocolId = PUMP_FUN_PROTOCOL_ID;
  readonly adapterVersion = PUMP_FUN_ADAPTER_VERSION;

  constructor(
    readonly source: MarketStateSource,
    readonly log: PumpFunLogSink = discardLog,
  ) {}

  async loadMarketState(identity: MarketIdentity): Promise<MarketState> {
    try {
      const state = await this.source.loadMarketState(identity);
      assertIdentity(identity, state.identity);
      asPumpState(state);
      return state;
    } catch (error) {
      this.log('pump_market_state_failed', {
        protocol: this.protocolId,
        market: identity.marketId,
        mint: identity.tokenMint,
        adapterVersion: this.adapterVersion,
        errorCode: error instanceof ExecutionEngineError ? error.code : 'MARKET_STATE_UNAVAILABLE',
      });
      throw error;
    }
  }

  async simulateBuy(
    request: BuySimulationRequest,
    marketState: MarketState,
  ): Promise<SimulatedExecution> {
    assertIdentity(request.identity, marketState.identity);
    const result = simulatePumpBuyAmount(request.requestedPaperSol, mathState(marketState));
    const execution = this.execution(
      request,
      marketState,
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
    this.log('pump_execution_simulated', {
      protocol: this.protocolId,
      market: request.identity.marketId,
      mint: request.identity.tokenMint,
      stateSlot: marketState.chainSlot?.toString() ?? null,
      adapterVersion: this.adapterVersion,
      executionId: request.executionId,
      evidenceFingerprint: execution.quote.marketStateFingerprint,
    });
    return execution;
  }

  async simulateSell(
    request: SellSimulationRequest,
    marketState: MarketState,
  ): Promise<SimulatedExecution> {
    assertIdentity(request.identity, marketState.identity);
    const result = simulatePumpSellAmount(request.requestedTokenQuantity, mathState(marketState));
    const execution = this.execution(
      request,
      marketState,
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
      { asset: 'PAPER_SOL', amount: paperSolBaseUnits(result.netSolOutput) },
      feeBreakdown(result.fees).fees,
      result.details,
    );
    this.log('pump_execution_simulated', {
      protocol: this.protocolId,
      market: request.identity.marketId,
      mint: request.identity.tokenMint,
      stateSlot: marketState.chainSlot?.toString() ?? null,
      adapterVersion: this.adapterVersion,
      executionId: request.executionId,
      evidenceFingerprint: execution.quote.marketStateFingerprint,
    });
    return execution;
  }

  async valuePositionForExit(
    request: PositionExitValuationRequest,
    marketState: MarketState,
  ): Promise<ExecutablePositionValue> {
    assertIdentity(request.identity, marketState.identity);
    const result = simulatePumpSellAmount(request.tokenQuantity, mathState(marketState));
    const evidence = createMarketStateEvidence(marketState);
    return {
      identity: request.identity,
      tokenQuantity: request.tokenQuantity,
      paperSolValue: paperSolBaseUnits(result.netSolOutput),
      feeBreakdown: feeBreakdown(result.fees),
      marketStateFingerprint: evidence.fingerprint,
      adapterVersion: this.adapterVersion,
    };
  }

  private execution(
    request: BuySimulationRequest | SellSimulationRequest,
    marketState: MarketState,
    requestedInput: AssetAmount,
    actualInput: AssetAmount,
    output: AssetAmount,
    fees: readonly ExecutionFee[],
    executionDetails: JsonObject,
  ): SimulatedExecution {
    const evidence = createMarketStateEvidence(marketState);
    return {
      id: request.executionId,
      orderId: request.orderId,
      quote: {
        orderId: request.orderId,
        marketId: request.identity.marketId,
        protocolId: this.protocolId,
        adapterVersion: this.adapterVersion,
        marketStateRecordedAt: marketState.observedAt,
        marketStateFingerprint: evidence.fingerprint,
        normalizationVersion: marketState.normalizationVersion,
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

export function pumpPaperSolFeeTotal(fees: readonly ExecutionFee[]): PaperSolBaseUnits {
  return paperSolBaseUnits(
    fees.reduce(
      (total, fee) => (fee.amount.asset === 'PAPER_SOL' ? total + fee.amount.amount : total),
      0n,
    ),
  );
}

export function pumpTokenAmount(value: bigint): TokenBaseUnits {
  return tokenBaseUnits(value);
}
