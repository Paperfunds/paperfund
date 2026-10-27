import { advisoryReadContext, advisoryClockTime } from './rpc-read-context.js';
import { createHash } from 'node:crypto';
import BN from 'bn.js';
import { PublicKey } from '@solana/web3.js';
import {
  unpackMint,
  unpackAccount,
  getExtensionTypes,
  getTransferFeeConfig,
  calculateEpochFee,
  getTransferHook,
  getDefaultAccountState,
  getPausableConfig,
} from '@solana/spl-token';
import {
  CpmmPoolInfoLayout,
  CpmmConfigInfoLayout,
  CurveCalculator,
  LaunchpadPool,
  LaunchpadConfig,
  Curve,
  LaunchConstantProductCurve,
  LinearPriceCurve,
  PlatformConfig,
  getPdaLaunchpadAuth,
  getPdaLaunchpadPoolId,
  getPdaLaunchpadVaultId,
} from '@raydium-io/raydium-sdk-v2';
import {
  cpAmmCoder,
  getFeeMode,
  getSwapResultFromExactInput,
  isSwapEnabled,
  derivePoolAuthority,
  InsufficientLiquidityError,
  type PoolState,
} from '@meteora-ag/cp-amm-sdk';
import {
  identifier,
  paperSolBaseUnits,
  tokenBaseUnits,
  utcInstant,
  type AssetAmount,
  type ExecutionFee,
  type ProtocolId,
} from '@paperfund/core';
import {
  createMarketStateEvidence,
  executionRouteRecord,
  ExecutionEngineError,
  type MarketIdentity,
  type MarketState,
  type JsonObject,
  type ProtocolAdapter,
  type BuySimulationRequest,
  type SellSimulationRequest,
  type PositionExitValuationRequest,
  type ExecutionRouter,
  type SimulatedExecution,
} from '@paperfund/execution';
import {
  SPL_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  WRAPPED_SOL_MINT,
  PUMP_FUN_PROTOCOL_ID,
  PUMP_PROGRAM_ID,
  pumpBondingCurveAddress,
  decodePumpBondingCurve,
  type SolanaRpcClient,
} from './pump-fun.js';
import {
  decodePumpSwapPool,
  canonicalPumpSwapPoolAddress,
  PUMP_SWAP_PROTOCOL_ID,
  PUMP_AMM_PROGRAM_ID,
} from './pump-swap.js';
import {
  ORCA_WHIRLPOOL_PROGRAM,
  orcaLink,
  pumpLink,
  pumpQuoteMint,
  quoteSupplementalHop,
} from './composed-pump-orca.js';

export const SOLANA_ROUTE_PROTOCOL_ID: ProtocolId = identifier('SOLANA_ROUTE', 'ProtocolId');
export const RAYDIUM_CPMM_PROGRAM = 'CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C';
export const METEORA_DAMM_V2_PROGRAM = 'cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG';
export const RAYDIUM_LAUNCHLAB_PROGRAM = 'LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj';
const CLOCK = 'SysvarC1ock11111111111111111111111111111111';
const VERSION = 'solana-composed-route-v1';
type ChainAccount = { readonly owner: string; readonly data: readonly [string, string] };
export interface CapturedAccount extends JsonObject {
  readonly owner: string;
  readonly base64: string;
}
export interface PoolLink extends JsonObject {
  readonly pool: string;
  readonly program: string;
  readonly mintA: string;
  readonly mintB: string;
  readonly vaultA: string;
  readonly vaultB: string;
  readonly config: string | null;
  readonly platform?: string;
  readonly extraAccounts?: readonly string[];
}
interface RouteSnapshot extends JsonObject {
  readonly model: 'SOLANA_COMPOSED_ROUTE';
  readonly tokenDecimals: string;
  readonly hops: readonly PoolLink[];
  readonly accounts: { readonly [key: string]: CapturedAccount };
}
function fail(message: string): never {
  throw new ExecutionEngineError('POSITION_EXECUTION_ROUTE_UNAVAILABLE', message);
}
function bytes(account: CapturedAccount) {
  return Buffer.from(account.base64, 'base64');
}
function camelFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(camelFields);
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype)
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key.replace(/_([a-z0-9])/g, (_, letter: string) => letter.toUpperCase()),
        camelFields(item),
      ]),
    );
  return value;
}
function dammPool(data: Buffer): PoolState {
  return camelFields(cpAmmCoder.accounts.decode('Pool', data)) as PoolState;
}
function discriminator(data: Buffer, name: string) {
  if (
    !data
      .subarray(0, 8)
      .equals(createHash('sha256').update(`account:${name}`).digest().subarray(0, 8))
  )
    fail(`Invalid ${name} discriminator.`);
}
export function decodePoolLink(pool: string, account: CapturedAccount): PoolLink {
  if (account.owner === ORCA_WHIRLPOOL_PROGRAM) return orcaLink(pool, account);
  const data = bytes(account);
  if (account.owner === RAYDIUM_CPMM_PROGRAM) {
    discriminator(data, 'PoolState');
    if (data.length !== CpmmPoolInfoLayout.span)
      fail('Raydium CPMM account version/size is unknown.');
    const p = CpmmPoolInfoLayout.decode(data);
    return {
      pool,
      program: account.owner,
      mintA: p.mintA.toBase58(),
      mintB: p.mintB.toBase58(),
      vaultA: p.vaultA.toBase58(),
      vaultB: p.vaultB.toBase58(),
      config: p.configId.toBase58(),
    };
  }
  if (account.owner === RAYDIUM_LAUNCHLAB_PROGRAM) {
    discriminator(data, 'PoolState');
    if (data.length !== LaunchpadPool.span)
      fail('Raydium LaunchLab account version/size is unknown.');
    const p = LaunchpadPool.decode(data);
    return {
      pool,
      program: account.owner,
      mintA: p.mintA.toBase58(),
      mintB: p.mintB.toBase58(),
      vaultA: p.vaultA.toBase58(),
      vaultB: p.vaultB.toBase58(),
      config: p.configId.toBase58(),
      platform: p.platformId.toBase58(),
    };
  }
  if (account.owner === METEORA_DAMM_V2_PROGRAM) {
    const p = dammPool(data);
    return {
      pool,
      program: account.owner,
      mintA: p.tokenAMint.toBase58(),
      mintB: p.tokenBMint.toBase58(),
      vaultA: p.tokenAVault.toBase58(),
      vaultB: p.tokenBVault.toBase58(),
      config: null,
    };
  }
  return fail(`No verified decoder for market ${pool}, owner ${account.owner}.`);
}
function accountInfo(a: CapturedAccount) {
  return {
    data: bytes(a),
    owner: new PublicKey(a.owner),
    executable: false,
    lamports: 0,
    rentEpoch: 0,
  };
}
function mintInfo(address: string, a: CapturedAccount) {
  if (![SPL_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID].includes(a.owner))
    fail(`Mint ${address} has invalid owner.`);
  const mint = unpackMint(new PublicKey(address), accountInfo(a), new PublicKey(a.owner));
  if (!mint.isInitialized) fail(`Mint ${address} is uninitialized.`);
  // These extensions do not alter raw swap transfers, except explicitly modeled transfer fees.
  const safe = new Set([0, 1, 3, 4, 6, 10, 12, 14, 18, 19, 20, 21, 22, 23, 25, 26, 28]);
  const unknown = getExtensionTypes(mint.tlvData).filter((type) => !safe.has(type));
  if (unknown.length)
    fail(`Mint ${address} requires transfer-extension simulation (${unknown.join(',')}).`);
  const hook = getTransferHook(mint);
  if (hook && !hook.programId.equals(PublicKey.default))
    fail(`Mint ${address} has an active transfer hook ${hook.programId.toBase58()}.`);
  if (getDefaultAccountState(mint)?.state === 2 || getPausableConfig(mint)?.paused)
    fail(`Mint ${address} is frozen by default or paused.`);
  return mint;
}
function captured(account: ChainAccount): CapturedAccount {
  return { owner: account.owner, base64: account.data[0] };
}
function snapshot(state: MarketState): RouteSnapshot {
  if (
    state.adapterVersion !== VERSION ||
    state.normalizedState['model'] !== 'SOLANA_COMPOSED_ROUTE'
  )
    fail('Route evidence version mismatch.');
  return state.normalizedState as RouteSnapshot;
}
function need(s: RouteSnapshot, address: string) {
  const a = s.accounts[address];
  if (!a) fail(`Missing recorded account ${address}.`);
  return a;
}
const n = (value: BN) => BigInt(value.toString(10));
function asset(mint: string, amount: bigint): AssetAmount {
  return mint === WRAPPED_SOL_MINT
    ? { asset: 'PAPER_SOL', amount: paperSolBaseUnits(amount) }
    : { asset: 'TOKEN', tokenMint: identifier(mint, 'TokenMint'), amount: tokenBaseUnits(amount) };
}

/** Exact per-hop simulation; every input (including Clock and token extensions) is recorded. */
function quoteRoute(
  state: MarketState,
  input: bigint,
  buy: boolean,
  startMint?: string,
  endMint?: string,
) {
  if (input <= 0n || input > 0xffffffffffffffffn)
    throw new ExecutionEngineError('ZERO_EXECUTABLE_OUTPUT', 'Swap input must be a positive u64.');
  const s = snapshot(state);
  if (
    s.tokenDecimals !==
    mintInfo(state.identity.tokenMint, need(s, state.identity.tokenMint)).decimals.toString()
  )
    fail('Recorded token decimals differ from authoritative mint.');
  const clock = bytes(need(s, CLOCK));
  if (clock.length < 40 || state.chainSlot === null || clock.readBigUInt64LE(0) > state.chainSlot)
    fail('Route Clock/slot snapshot is malformed or incoherent.');
  const epoch = clock.readBigUInt64LE(16),
    slot = clock.readBigUInt64LE(0),
    time = clock.readBigInt64LE(32);
  let mint = startMint ?? (buy ? WRAPPED_SOL_MINT : state.identity.tokenMint);
  let amount = input;
  let consumedInput = input;
  const fees: ExecutionFee[] = [];
  const details: JsonObject[] = [];
  const hops = buy ? [...s.hops].reverse() : s.hops;
  for (const hop of hops) {
    if (mint !== hop.mintA && mint !== hop.mintB)
      fail('Route does not connect the requested mint.');
    const poolAccount = need(s, hop.pool);
    const link =
      hop.program === PUMP_PROGRAM_ID
        ? pumpLink(
            hop.pool,
            poolAccount,
            hop.mintA,
            need(s, hop.mintA).owner,
            need(s, hop.mintB).owner,
          )
        : decodePoolLink(hop.pool, poolAccount);
    if (
      Object.keys(link).some(
        (key) =>
          key !== 'extraAccounts' &&
          !(key === 'platform' && hop.platform === undefined) &&
          link[key] !== hop[key],
      )
    )
      fail('Recorded market linkage changed.');
    const aToB = mint === hop.mintA;
    const outMint = aToB ? hop.mintB : hop.mintA;
    const inputMint = mintInfo(mint, need(s, mint)),
      outputMint = mintInfo(outMint, need(s, outMint));
    const transfer = (address: string, value: bigint, info: ReturnType<typeof mintInfo>) => {
      const config = getTransferFeeConfig(info);
      const fee = config ? calculateEpochFee(config, epoch, value) : 0n;
      if (fee > 0n) fees.push({ category: 'TOKEN_TRANSFER_FEE', amount: asset(address, fee) });
      return value - fee;
    };
    const afterTransfer = transfer(mint, amount, inputMint);
    const vault = (address: string, expectedMint: string) => {
      const raw = need(s, address);
      const expectedProgram = need(s, expectedMint).owner;
      if (raw.owner !== expectedProgram) fail('Vault token program differs from mint.');
      const v = unpackAccount(new PublicKey(address), accountInfo(raw), new PublicKey(raw.owner));
      if (v.mint.toBase58() !== expectedMint || !v.isInitialized || v.isFrozen)
        fail('Vault mint/state is invalid.');
      return v;
    };
    const va = vault(hop.vaultA, hop.mintA),
      vb = vault(hop.vaultB, hop.mintB);
    const addFee = (category: string, feeMint: string, value: bigint) => {
      if (value > 0n) fees.push({ category, amount: asset(feeMint, value) });
    };
    let output: bigint;
    if ([PUMP_PROGRAM_ID, ORCA_WHIRLPOOL_PROGRAM].includes(hop.program)) {
      const authority = hop.pool;
      if (va.owner.toBase58() !== authority || vb.owner.toBase58() !== authority)
        fail('Composed vault authority mismatch.');
      const q = quoteSupplementalHop(
        hop,
        s.accounts,
        afterTransfer,
        aToB,
        time,
        mintInfo(hop.mintA, need(s, hop.mintA)).supply,
        (state.normalizedState['absentAccounts'] as string[] | undefined) ?? [],
      );
      output = q.output;
      addFee('PROTOCOL_FEE', q.feeMint, q.protocol);
      addFee('CREATOR_FEE', q.feeMint, q.creator);
      addFee('feeCategory' in q ? q.feeCategory : 'LP_FEE', q.feeMint, q.lp);
      details.push({
        pool: hop.pool,
        programId: hop.program,
        input: amount.toString(),
        outputBeforeTransfer: output.toString(),
        ...q.detail,
      });
    } else if (hop.program === RAYDIUM_CPMM_PROGRAM) {
      const p = CpmmPoolInfoLayout.decode(bytes(poolAccount));
      const config = need(s, hop.config!);
      if (config.owner !== RAYDIUM_CPMM_PROGRAM) fail('CPMM config owner mismatch.');
      discriminator(bytes(config), 'AmmConfig');
      const c = CpmmConfigInfoLayout.decode(bytes(config));
      const authority = PublicKey.findProgramAddressSync(
        [Buffer.from('vault_and_lp_mint_auth_seed')],
        new PublicKey(hop.program),
      )[0].toBase58();
      if (va.owner.toBase58() !== authority || vb.owner.toBase58() !== authority)
        fail('CPMM vault authority mismatch.');
      if (
        p.mintProgramA.toBase58() !== need(s, hop.mintA).owner ||
        p.mintProgramB.toBase58() !== need(s, hop.mintB).owner ||
        p.mintDecimalA !== mintInfo(hop.mintA, need(s, hop.mintA)).decimals ||
        p.mintDecimalB !== mintInfo(hop.mintB, need(s, hop.mintB)).decimals
      )
        fail('CPMM mint program/decimals mismatch.');
      if ((p.status & 4) !== 0 || time <= n(p.openTime))
        fail('CPMM swaps disabled or pool not open.');
      const ra = va.amount - n(p.protocolFeesMintA) - n(p.fundFeesMintA) - n(p.creatorFeesMintA);
      const rb = vb.amount - n(p.protocolFeesMintB) - n(p.fundFeesMintB) - n(p.creatorFeesMintB);
      if (ra < 0n || rb < 0n)
        fail('CPMM recorded fees exceed vault balances; reserves are inconsistent.');
      if (ra <= 0n || rb <= 0n)
        throw new ExecutionEngineError(
          'INSUFFICIENT_EXECUTABLE_LIQUIDITY',
          'CPMM has no available reserves.',
        );
      if (![0, 1, 2].includes(p.feeOn)) fail('CPMM creator fee mode invalid.');
      const creatorOnInput = p.feeOn === 0 || (aToB ? p.feeOn === 1 : p.feeOn === 2);
      const creatorRate = p.enableCreatorFee ? c.creatorFeeRate : new BN(0);
      if (n(c.tradeFeeRate) + n(creatorRate) >= 1_000_000n) fail('CPMM fee rate invalid.');
      const q = CurveCalculator.swapBaseInput(
        new BN(afterTransfer.toString()),
        new BN((aToB ? ra : rb).toString()),
        new BN((aToB ? rb : ra).toString()),
        c.tradeFeeRate,
        creatorRate,
        c.protocolFeeRate,
        c.fundFeeRate,
        creatorOnInput,
      );
      output = n(q.outputAmount);
      addFee('LP_FEE', mint, n(q.tradeFee) - n(q.protocolFee) - n(q.fundFee));
      addFee('PROTOCOL_FEE', mint, n(q.protocolFee));
      addFee('FUND_FEE', mint, n(q.fundFee));
      addFee('CREATOR_FEE', creatorOnInput ? mint : outMint, n(q.creatorFee));
      details.push({
        pool: hop.pool,
        programId: hop.program,
        input: amount.toString(),
        reserveA: ra.toString(),
        reserveB: rb.toString(),
        outputBeforeTransfer: output.toString(),
      });
    } else if (hop.program === RAYDIUM_LAUNCHLAB_PROGRAM && hop.platform === undefined) {
      // Replay-only compatibility for immutable pre-correction evidence. Live decoders always
      // include platform linkage; no new snapshot can select these historical fee mechanics.
      const p = LaunchpadPool.decode(bytes(poolAccount));
      const configAccount = need(s, hop.config!);
      if (configAccount.owner !== RAYDIUM_LAUNCHLAB_PROGRAM)
        fail('LaunchLab config owner mismatch.');
      const config = LaunchpadConfig.decode(bytes(configAccount));
      if (
        config.mintB.toBase58() !== hop.mintB ||
        p.status !== 0 ||
        ![0, 1].includes(config.curveType)
      )
        fail('Legacy LaunchLab state invalid.');
      const fee = (afterTransfer * n(config.tradeFeeRate) + 999_999n) / 1_000_000n;
      if (afterTransfer <= fee)
        throw new ExecutionEngineError('ZERO_EXECUTABLE_OUTPUT', 'LaunchLab fee consumes input.');
      const curve = config.curveType === 0 ? LaunchConstantProductCurve : LinearPriceCurve;
      output = n(
        aToB
          ? curve.sellExactIn({ poolInfo: p, amount: new BN((afterTransfer - fee).toString()) })
          : curve.buyExactIn({ poolInfo: p, amount: new BN((afterTransfer - fee).toString()) }),
      );
      addFee('PROTOCOL_FEE', mint, fee);
      details.push({
        pool: hop.pool,
        programId: hop.program,
        input: amount.toString(),
        virtualA: p.virtualA.toString(),
        virtualB: p.virtualB.toString(),
        realA: p.realA.toString(),
        realB: p.realB.toString(),
        curveType: config.curveType,
        tradeFeeRate: config.tradeFeeRate.toString(),
        outputBeforeTransfer: output.toString(),
      });
    } else if (hop.program === RAYDIUM_LAUNCHLAB_PROGRAM) {
      const p = LaunchpadPool.decode(bytes(poolAccount));
      const configAccount = need(s, hop.config!);
      if (configAccount.owner !== RAYDIUM_LAUNCHLAB_PROGRAM)
        fail('LaunchLab config owner mismatch.');
      if (p.configId.toBase58() !== hop.config) fail('LaunchLab config linkage changed.');
      if (bytes(configAccount).length !== LaunchpadConfig.span)
        fail('LAUNCHLAB_STATE_UNAVAILABLE: config size mismatch.');
      const config = LaunchpadConfig.decode(bytes(configAccount));
      discriminator(bytes(configAccount), 'GlobalConfig');
      const platformAccount = need(s, p.platformId.toBase58());
      if (
        platformAccount.owner !== RAYDIUM_LAUNCHLAB_PROGRAM ||
        bytes(platformAccount).length !== PlatformConfig.span
      )
        fail('LAUNCHLAB_STATE_UNAVAILABLE: platform config owner/size mismatch.');
      discriminator(bytes(platformAccount), 'PlatformConfig');
      const platform = PlatformConfig.decode(bytes(platformAccount));
      if (
        p.mintA.toBase58() !== hop.mintA ||
        p.mintB.toBase58() !== hop.mintB ||
        config.mintB.toBase58() !== hop.mintB ||
        p.status !== 0
      )
        fail(`LAUNCHLAB_STATE_UNAVAILABLE: pool identity/status ${p.status} is invalid.`);
      const expectedAuthority = getPdaLaunchpadAuth(
        new PublicKey(hop.program),
      ).publicKey.toBase58();
      if (va.owner.toBase58() !== expectedAuthority || vb.owner.toBase58() !== expectedAuthority)
        fail('LaunchLab vault authority mismatch.');
      const program = new PublicKey(hop.program);
      if (
        getPdaLaunchpadPoolId(program, p.mintA, p.mintB).publicKey.toBase58() !== hop.pool ||
        getPdaLaunchpadVaultId(program, new PublicKey(hop.pool), p.mintA).publicKey.toBase58() !==
          hop.vaultA ||
        getPdaLaunchpadVaultId(program, new PublicKey(hop.pool), p.mintB).publicKey.toBase58() !==
          hop.vaultB
      )
        fail('LAUNCHLAB_STATE_UNAVAILABLE: pool/vault PDA mismatch.');
      if (
        inputMint.decimals !== (aToB ? p.mintDecimalsA : p.mintDecimalsB) ||
        outputMint.decimals !== (aToB ? p.mintDecimalsB : p.mintDecimalsA) ||
        need(s, hop.mintA).owner !==
          ((p.mintProgramFlag & 1) === 0 ? SPL_TOKEN_PROGRAM_ID : TOKEN_2022_PROGRAM_ID) ||
        need(s, hop.mintB).owner !==
          ((p.mintProgramFlag & 2) === 0 ? SPL_TOKEN_PROGRAM_ID : TOKEN_2022_PROGRAM_ID) ||
        ![0, 1, 2, 3].includes(p.mintProgramFlag)
      )
        fail('LAUNCHLAB_STATE_UNAVAILABLE: mint program/decimals mismatch.');
      if (![0, 1, 2].includes(config.curveType))
        fail('LAUNCHLAB_QUOTE_FAILED: unsupported curve type.');
      if (n(config.tradeFeeRate) + n(platform.feeRate) + n(platform.creatorFeeRate) >= 1_000_000n)
        fail('LAUNCHLAB_QUOTE_FAILED: invalid total fee rate.');
      if (n(p.realA) > n(p.totalSellA) || (config.curveType === 0 && n(p.realA) >= n(p.virtualA)))
        fail('LAUNCHLAB_STATE_UNAVAILABLE: inconsistent curve reserves.');
      if (aToB && afterTransfer > n(p.realA))
        throw new ExecutionEngineError(
          'INSUFFICIENT_EXECUTABLE_LIQUIDITY',
          'LAUNCHLAB_QUOTE_FAILED: SELL exceeds sold base quantity.',
        );
      const params = {
        poolInfo: p,
        protocolFeeRate: config.tradeFeeRate,
        platformFeeRate: platform.feeRate,
        creatorFeeRate: platform.creatorFeeRate,
        shareFeeRate: new BN(0),
        curveType: config.curveType,
        transferFeeConfigA: undefined,
        slot: 0,
      };
      // Transfer fees are already applied from the recorded Clock epoch. SDK handles curve,
      // quote-denominated trade fees, rounding, splitting and the remaining-sale BUY cap.
      const q = aToB
        ? Curve.sellExactIn({ ...params, amountA: new BN(afterTransfer.toString()) })
        : Curve.buyExactIn({ ...params, amountB: new BN(afterTransfer.toString()) });
      output = aToB ? n(q.amountB) : n(q.amountA.amount);
      const totalFee =
        n(q.splitFee.protocolFee) + n(q.splitFee.platformFee) + n(q.splitFee.creatorFee);
      if (aToB && (afterTransfer > n(p.realA) || output + totalFee > n(p.realB)))
        throw new ExecutionEngineError(
          'INSUFFICIENT_EXECUTABLE_LIQUIDITY',
          'LAUNCHLAB_QUOTE_FAILED: SELL exceeds real curve liquidity.',
        );
      if (!aToB && n(q.amountB) < afterTransfer) {
        if (hops.length !== 1)
          throw new ExecutionEngineError(
            'INSUFFICIENT_EXECUTABLE_LIQUIDITY',
            'LAUNCHLAB_BUY_CAP: composed input exceeds remaining sale.',
          );
        consumedInput = n(q.amountB);
      }
      addFee('PROTOCOL_FEE', hop.mintB, n(q.splitFee.protocolFee));
      addFee('PLATFORM_FEE', hop.mintB, n(q.splitFee.platformFee));
      addFee('CREATOR_FEE', hop.mintB, n(q.splitFee.creatorFee));
      details.push({
        pool: hop.pool,
        programId: hop.program,
        input: amount.toString(),
        virtualA: p.virtualA.toString(),
        virtualB: p.virtualB.toString(),
        realA: p.realA.toString(),
        realB: p.realB.toString(),
        curveType: config.curveType,
        tradeFeeRate: config.tradeFeeRate.toString(),
        platformFeeRate: platform.feeRate.toString(),
        creatorFeeRate: platform.creatorFeeRate.toString(),
        stage: 'LAUNCHLAB_ACTIVE',
        outputBeforeTransfer: output.toString(),
      });
    } else {
      const p = dammPool(bytes(poolAccount));
      const point = p.activationType === 0 ? slot : time;
      if (!isSwapEnabled(p, new BN(point.toString())))
        fail('DAMM v2 swaps disabled or activation pending.');
      const mode = getFeeMode(p.collectFeeMode, aToB ? 0 : 1, false);
      if (
        va.owner.toBase58() !== derivePoolAuthority().toBase58() ||
        vb.owner.toBase58() !== derivePoolAuthority().toBase58()
      )
        fail('DAMM v2 vault authority mismatch.');
      let q;
      try {
        q = getSwapResultFromExactInput(
          p,
          new BN(afterTransfer.toString()),
          mode,
          aToB ? 0 : 1,
          new BN(point.toString()),
        );
      } catch (error) {
        if (error instanceof InsufficientLiquidityError)
          throw new ExecutionEngineError(
            'INSUFFICIENT_EXECUTABLE_LIQUIDITY',
            'DAMM v2 price range exhausted.',
          );
        throw error;
      }
      if (!q.amountLeft.isZero())
        throw new ExecutionEngineError(
          'INSUFFICIENT_EXECUTABLE_LIQUIDITY',
          'DAMM v2 price range cannot execute all input.',
        );
      output = n(q.outputAmount);
      const feeMint = mode.feesOnInput ? mint : outMint;
      addFee('LP_CLAIM_FEE', feeMint, n(q.claimingFee));
      addFee('LP_COMPOUND_FEE', feeMint, n(q.compoundingFee));
      addFee('PROTOCOL_FEE', feeMint, n(q.protocolFee));
      details.push({
        pool: hop.pool,
        programId: hop.program,
        input: amount.toString(),
        outputBeforeTransfer: output.toString(),
        sqrtPrice: p.sqrtPrice.toString(10),
        liquidity: p.liquidity.toString(10),
        reserveA: p.tokenAAmount.toString(10),
        reserveB: p.tokenBAmount.toString(10),
        nextSqrtPrice: q.nextSqrtPrice.toString(10),
      });
    }
    if (output < 0n) fail('Protocol returned a negative route output.');
    if (output > (aToB ? vb : va).amount)
      throw new ExecutionEngineError(
        'INSUFFICIENT_EXECUTABLE_LIQUIDITY',
        'Output exceeds actual vault liquidity.',
      );
    amount = transfer(outMint, output, outputMint);
    const detail = details.at(-1)!;
    details[details.length - 1] = {
      ...detail,
      inputMint: mint,
      outputMint: outMint,
      inputDecimals: inputMint.decimals,
      outputDecimals: outputMint.decimals,
      inputAfterTransfer: afterTransfer.toString(),
      inputTransferFee: (BigInt(detail['input'] as string) - afterTransfer).toString(),
      outputTransferFee: (output - amount).toString(),
      direction: aToB ? 'A_TO_B' : 'B_TO_A',
      outputAfterTransfer: amount.toString(),
      stateSlot: state.chainSlot?.toString() ?? null,
    };
    mint = outMint;
    if (amount <= 0n)
      throw new ExecutionEngineError(
        'ZERO_EXECUTABLE_OUTPUT',
        'Route output rounds to zero after fees.',
      );
  }
  if (mint !== (endMint ?? (buy ? state.identity.tokenMint : WRAPPED_SOL_MINT)))
    fail('Route output mint mismatch.');
  return { output: amount, consumedInput, fees, details };
}

function quoteSelectedRoute(
  state: MarketState,
  input: bigint,
  buy: boolean,
): ReturnType<typeof quoteRoute> {
  const capped = (error: unknown) =>
    error instanceof ExecutionEngineError && error.message.startsWith('LAUNCHLAB_BUY_CAP:');
  try {
    return quoteRoute(state, input, buy);
  } catch (error) {
    if (
      !(error instanceof ExecutionEngineError) &&
      snapshot(state).hops.some((h) => h.program === RAYDIUM_LAUNCHLAB_PROGRAM)
    )
      fail(
        `LAUNCHLAB_QUOTE_FAILED: ${error instanceof Error ? error.message : 'SDK curve failure.'}`,
      );
    if (!buy || !capped(error)) throw error;
  }
  // For a bounded composed BUY, select the largest SOL input that the launch can fully accept.
  // Each upstream quote is replayed against the same accounts; no intermediate surplus is credited.
  let low = 0n,
    high = input;
  while (low < high) {
    const mid = (low + high + 1n) / 2n;
    try {
      quoteRoute(state, mid, true);
      low = mid;
    } catch (error) {
      if (capped(error)) high = mid - 1n;
      else if (error instanceof ExecutionEngineError && error.code === 'ZERO_EXECUTABLE_OUTPUT')
        low = mid;
      else throw error;
    }
  }
  const q = quoteRoute(state, low, true);
  return { ...q, consumedInput: low };
}

/** Select for the actual amount and direction using only this one atomic candidate snapshot. */
export function quoteRecordedRoute(
  state: MarketState,
  input: bigint,
  buy: boolean,
): ReturnType<typeof quoteRoute> {
  if (state.normalizedState['routePolicy'] === 'FIXED_TOPOLOGY_V1')
    return quoteSelectedRoute(state, input, buy);
  const routes = state.normalizedState['candidateRoutes'] as PoolLink[][] | undefined;
  if (!routes?.length) return quoteSelectedRoute(state, input, buy);
  let best: ReturnType<typeof quoteRoute> | undefined;
  const failures: unknown[] = [];
  for (const hops of routes) {
    try {
      const quote = quoteSelectedRoute(
        { ...state, normalizedState: { ...state.normalizedState, hops } },
        input,
        buy,
      );
      if (!best || quote.output > best.output) best = quote;
    } catch (error) {
      failures.push(error);
    }
  }
  if (best) return best;
  // Infrastructure/malformed state must not be reclassified as genuine zero liquidity.
  const error =
    failures.find(
      (e) =>
        !(e instanceof ExecutionEngineError) ||
        !['ZERO_EXECUTABLE_OUTPUT', 'INSUFFICIENT_EXECUTABLE_LIQUIDITY'].includes(e.code),
    ) ?? failures[0];
  throw (
    error ??
    new ExecutionEngineError('MARKET_STATE_UNAVAILABLE', 'No validated route quote is available.')
  );
}

export interface MarketCandidates {
  pools(mint: string): Promise<readonly string[]>;
  context(address: string): Promise<readonly string[]>;
}
/** Indexer results are discovery hints only; prices, liquidity and DEX labels are never trusted. */
export class PublicMarketCandidates implements MarketCandidates {
  private readonly cache = new Map<string, { until: number; pools: string[] }>();
  private async json(url: string): Promise<unknown> {
    const r = await fetch(url, {
      signal: advisoryReadContext()?.signal ?? AbortSignal.timeout(12000),
    });
    if (!r.ok) fail(`Market discovery HTTP ${r.status}.`);
    return r.json();
  }
  async pools(mint: string) {
    const cached = this.cache.get(mint);
    if (cached && cached.until > Date.now()) return cached.pools;
    const data = await this.json(`https://api.dexscreener.com/token-pairs/v1/solana/${mint}`);
    if (!Array.isArray(data)) fail('Invalid discovery response.');
    const pools = [...new Set(data.map((p) => (p as { pairAddress: string }).pairAddress))]
      .filter((p) => typeof p === 'string')
      .sort()
      .slice(0, 30);
    try {
      const quote = (await this.json(
        `https://lite-api.jup.ag/ultra/v1/order?inputMint=${mint}&outputMint=${WRAPPED_SOL_MINT}&amount=1000000`,
      )) as {
        routePlan?: Array<{
          swapInfo?: { ammKey?: string; inputMint?: string; outputMint?: string };
        }>;
      };
      for (const step of quote.routePlan ?? []) {
        const info = step.swapInfo;
        if (!info?.ammKey) continue;
        pools.push(info.ammKey);
      }
    } catch {
      // Jupiter is discovery-only and may be unavailable; Dexscreener remains the primary hint.
    }
    const uniquePools = [...new Set(pools)].sort().slice(0, 40);
    if (this.cache.size >= 256) this.cache.delete(this.cache.keys().next().value!);
    if (uniquePools.length) this.cache.set(mint, { until: Date.now() + 10000, pools: uniquePools });
    return uniquePools;
  }
  async context(address: string) {
    const data = (await this.json(
      `https://api.dexscreener.com/latest/dex/pairs/solana/${address}`,
    )) as {
      pairs?: Array<{ baseToken: { address: string }; quoteToken: { address: string } }> | null;
    };
    const dex = [
      ...new Set((data.pairs ?? []).flatMap((p) => [p.baseToken.address, p.quoteToken.address])),
    ];
    return dex;
  }
}

export class SolanaRouteSource {
  private readonly topology = new Map<string, { until: number; hops: PoolLink[] }>();
  report(event: string, metadata: JsonObject) {
    try {
      this.log(event, metadata);
    } catch {
      /* Diagnostics cannot change route behavior. */
    }
  }
  constructor(
    readonly rpc: SolanaRpcClient,
    readonly candidates: MarketCandidates = new PublicMarketCandidates(),
    private readonly log: (event: string, metadata: JsonObject) => void = () => undefined,
  ) {}
  async requireSupportedPumpMigration(
    mint: string,
    curve: ReturnType<typeof decodePumpBondingCurve>,
  ) {
    if (
      !curve.complete ||
      [PublicKey.default.toBase58(), WRAPPED_SOL_MINT].includes(curve.quoteMint)
    )
      return;
    const pool = await canonicalPumpSwapPoolAddress(mint, curve.quoteMint);
    const response = await this.rpc.getMultipleAccounts([pool]);
    const account = response.value[0];
    if (!account) fail(`Migrated non-SOL PumpSwap state is unavailable: ${pool}.`);
    if (account.owner !== PUMP_AMM_PROGRAM_ID) fail('Migrated PumpSwap pool owner mismatch.');
    const decoded = decodePumpSwapPool(Buffer.from(account.data[0], 'base64'));
    if (decoded.baseMint !== mint || decoded.quoteMint !== curve.quoteMint)
      fail('Migrated PumpSwap mint linkage mismatch.');
    this.report('UNSUPPORTED_CANONICAL_MIGRATION', {
      mint,
      quoteMint: curve.quoteMint,
      pool,
      slot: response.context.slot,
    });
    // The installed native PumpSwap adapter models SOL quotes only. Never replace an
    // unsupported economic venue with an unrelated secondary pool that happens to decode.
    fail(
      `Canonical non-SOL PumpSwap execution is not supported yet (${pool}, quote ${curve.quoteMint}).`,
    );
  }
  private async launchPools(mint: string): Promise<PoolLink[]> {
    const canonical = getPdaLaunchpadPoolId(
      new PublicKey(RAYDIUM_LAUNCHLAB_PROGRAM),
      new PublicKey(mint),
      new PublicKey(WRAPPED_SOL_MINT),
    ).publicKey.toBase58();
    const direct = await this.rpc.getMultipleAccounts([canonical]);
    let addresses = [canonical];
    if (!direct.value[0] && this.rpc.getProgramAccountAddresses) {
      // Non-SOL launch quotes need mint-filtered chain discovery, never a migrated indexer route.
      try {
        addresses = await this.rpc.getProgramAccountAddresses(
          RAYDIUM_LAUNCHLAB_PROGRAM,
          mint,
          LaunchpadPool.offsetOf('mintA')!,
          LaunchpadPool.span,
        );
      } catch (error) {
        this.report('LAUNCHLAB_DISCOVERY_RPC_FAILED', {
          mint,
          stage: 'getProgramAccounts',
          message: error instanceof Error ? error.message : String(error),
        });
        // Provider filtering support differs. Discovery hints are only candidate addresses:
        // owner, discriminator, mint and canonical PDA below still establish chain authority.
        const hints = (await this.candidates.pools(mint)).slice(0, 16);
        const hinted = await this.rpc.getMultipleAccounts(hints);
        addresses = hints.filter((_, i) => hinted.value[i]?.owner === RAYDIUM_LAUNCHLAB_PROGRAM);
        if (!addresses.length) throw error;
        this.report('LAUNCHLAB_DISCOVERY_VERIFIED_HINTS', { mint, pools: addresses });
      }
    }
    if (!addresses.length) return [];
    const response =
      addresses[0] === canonical ? direct : await this.rpc.getMultipleAccounts(addresses);
    const links: PoolLink[] = [];
    for (const [i, address] of addresses.entries()) {
      const account = response.value[i];
      if (!account) continue;
      if (account.owner !== RAYDIUM_LAUNCHLAB_PROGRAM)
        fail('LAUNCHLAB_STATE_UNAVAILABLE: pool owner mismatch.');
      const link = decodePoolLink(address, captured(account));
      if (link.mintA !== mint) fail('LAUNCHLAB_STATE_UNAVAILABLE: base mint mismatch.');
      if (
        getPdaLaunchpadPoolId(
          new PublicKey(link.program),
          new PublicKey(link.mintA),
          new PublicKey(link.mintB),
        ).publicKey.toBase58() !== address
      )
        fail('LAUNCHLAB_STATE_UNAVAILABLE: discovered pool PDA mismatch.');
      links.push(link);
    }
    return links;
  }
  private async capture(identity: MarketIdentity, paths: PoolLink[][]): Promise<MarketState[]> {
    const addresses = [
      ...new Set([
        CLOCK,
        ...paths.flatMap((hops) =>
          hops.flatMap((h) => [
            h.pool,
            h.mintA,
            h.mintB,
            h.vaultA,
            h.vaultB,
            ...(h.config ? [h.config] : []),
            ...(h.platform ? [h.platform] : []),
            ...(h.extraAccounts ?? []),
          ]),
        ),
      ]),
    ];
    if (addresses.length > 100) fail('Route snapshot exceeds the atomic RPC account limit.');
    const response = await this.rpc.getMultipleAccounts(addresses);
    if (
      !Number.isSafeInteger(response.context.slot) ||
      response.context.slot < 0 ||
      response.value.length !== addresses.length
    )
      fail('Route RPC account cardinality/slot is malformed.');
    const accounts: Record<string, CapturedAccount> = {};
    for (const [i, address] of addresses.entries()) {
      const a = response.value[i];
      if (a) accounts[address] = captured(a);
    }
    const token = mintInfo(
      identity.tokenMint,
      need({ accounts } as RouteSnapshot, identity.tokenMint),
    );
    return paths.map((hops) => ({
      identity,
      observedAt: utcInstant(new Date()),
      chainSlot: BigInt(response.context.slot),
      chainBlockId: null,
      adapterVersion: VERSION,
      normalizationVersion: 'solana-route-accounts-launchlab-v2',
      normalizedState: {
        model: 'SOLANA_COMPOSED_ROUTE',
        ...(advisoryReadContext()
          ? {
              chainTime: advisoryClockTime(
                response.value[addresses.indexOf(CLOCK)],
                response.context.slot,
              ),
            }
          : {}),
        tokenDecimals: token.decimals.toString(),
        mintSupply: token.supply.toString(),
        hops,
        candidateRoutes: paths,
        accounts,
        absentAccounts: addresses.filter((_, i) => response.value[i] === null),
      },
    }));
  }
  private async validateSnapshot(candidate: MarketState): Promise<MarketState> {
    const state: MarketState = {
      ...candidate,
      normalizedState: {
        ...candidate.normalizedState,
        routePolicy: 'FIXED_TOPOLOGY_V1',
        candidateRoutes: [candidate.normalizedState['hops']!],
      },
    };
    const s = snapshot(state);
    need(s, CLOCK);
    for (const hop of s.hops) {
      for (const address of [
        hop.pool,
        hop.mintA,
        hop.mintB,
        hop.vaultA,
        hop.vaultB,
        ...(hop.config ? [hop.config] : []),
        ...(hop.platform ? [hop.platform] : []),
      ])
        need(s, address);
      mintInfo(hop.mintA, need(s, hop.mintA));
      mintInfo(hop.mintB, need(s, hop.mintB));
      // Validate each hop in both directions independently. An early dust/liquidity result
      // in the whole route must never hide malformed downstream fees, vaults or tick arrays.
      const isolated = { ...state, normalizedState: { ...state.normalizedState, hops: [hop] } };
      for (const [inputMint, outputMint] of [
        [hop.mintA, hop.mintB],
        [hop.mintB, hop.mintA],
      ]) {
        try {
          quoteRoute(isolated, 1_000_000n, false, inputMint, outputMint);
        } catch (error) {
          if (
            !(error instanceof ExecutionEngineError) ||
            !['ZERO_EXECUTABLE_OUTPUT', 'INSUFFICIENT_EXECUTABLE_LIQUIDITY'].includes(error.code)
          )
            throw error;
        }
      }
    }
    for (const buy of [true, false]) {
      try {
        quoteSelectedRoute(state, 1_000_000n, buy);
      } catch (error) {
        if (
          !(error instanceof ExecutionEngineError) ||
          !['ZERO_EXECUTABLE_OUTPUT', 'INSUFFICIENT_EXECUTABLE_LIQUIDITY'].includes(error.code)
        )
          throw error;
      }
    }
    this.report('ROUTE_SNAPSHOT_READY', {
      mint: state.identity.tokenMint,
      route: executionRouteRecord(state, false),
      hops: s.hops,
      slot: state.chainSlot?.toString() ?? null,
    });
    return state;
  }
  async chartMetadata(address: string) {
    const context = await this.rpc.getMultipleAccounts([address]);
    const owner = context.value[0]?.owner;
    const mint = owner && [SPL_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID].includes(owner)
      ? address : await this.resolveContext(address);
    const response = await this.rpc.getMultipleAccounts([mint]);
    const account = response.value[0];
    if (!account || ![SPL_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID].includes(account.owner))
      throw new Error('CHART_TOKEN_METADATA_MISSING');
    // Mint decoding for display does not make swap-extension compatibility claims.
    const info = unpackMint(new PublicKey(mint), accountInfo(captured(account)), new PublicKey(account.owner));
    if (!info.isInitialized) throw new Error('CHART_TOKEN_METADATA_MISSING');
    if (!Number.isInteger(info.decimals) || info.decimals < 0 || info.decimals > 18)
      throw new Error('INVALID_TOKEN_DECIMALS');
    if (info.supply <= 0n) throw new Error('AUTHORITATIVE_SUPPLY_UNAVAILABLE');
    return { requestedContext: address, mint, tokenProgram: account.owner,
      tokenDecimals: info.decimals, tokenSupplyBaseUnits: info.supply.toString(),
      chainSlot: response.context.slot.toString() };
  }
  async resolveContext(address: string): Promise<string> {
    const response = await this.rpc.getMultipleAccounts([address]);
    const a = response.value[0];
    if (!a) fail('Terminal context account was not found on Solana.');
    if ([SPL_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID].includes(a.owner)) {
      mintInfo(address, captured(a));
      return address;
    }
    if (
      [RAYDIUM_CPMM_PROGRAM, RAYDIUM_LAUNCHLAB_PROGRAM, METEORA_DAMM_V2_PROGRAM].includes(a.owner)
    ) {
      const link = decodePoolLink(address, captured(a));
      return link.mintA === WRAPPED_SOL_MINT ? link.mintB : link.mintA;
    }
    if (a.owner === 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA')
      return decodePumpSwapPool(Buffer.from(a.data[0], 'base64')).baseMint;
    const hints =
      a.owner === PUMP_PROGRAM_ID
        ? await this.rpc.getOwnedTokenMints(address)
        : await this.candidates.context(address);
    for (const mint of hints) {
      if (mint === WRAPPED_SOL_MINT) continue;
      if (a.owner === PUMP_PROGRAM_ID && (await pumpBondingCurveAddress(mint)) === address)
        return mint;
      if (
        a.owner === 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA' &&
        decodePumpSwapPool(Buffer.from(a.data[0], 'base64')).baseMint === mint
      )
        return mint;
      if (
        [RAYDIUM_CPMM_PROGRAM, RAYDIUM_LAUNCHLAB_PROGRAM, METEORA_DAMM_V2_PROGRAM].includes(a.owner)
      ) {
        const p = decodePoolLink(address, captured(a));
        if (p.mintA === mint || p.mintB === mint) return mint;
      }
    }
    return fail('Terminal market could not be bound to a verified token mint.');
  }
  async loadMarketState(identity: MarketIdentity): Promise<MarketState> {
    if (
      identity.protocolId !== SOLANA_ROUTE_PROTOCOL_ID ||
      identity.marketId !== `solana-route:${identity.tokenMint}`
    )
      fail('Route identity mismatch.');
    const cached = this.topology.get(identity.tokenMint);
    if (cached && cached.until > Date.now()) {
      // Cache addresses only. A failed fresh capture fails this operation; never switch paths.
      try {
        const [state] = await this.capture(identity, [structuredClone(cached.hops)]);
        return await this.validateSnapshot(state!);
      } catch (error) {
        this.topology.delete(identity.tokenMint);
        this.report('ROUTE_CACHE_INVALIDATED', {
          mint: identity.tokenMint,
          reason: error instanceof ExecutionEngineError ? error.code : 'INVALID_MARKET_STATE',
        });
        throw error;
      }
    }
    const diagnostics: string[] = [];
    const curveAddress = await pumpBondingCurveAddress(identity.tokenMint);
    const curveResponse = await this.rpc.getMultipleAccounts([curveAddress]);
    const curveAccount = curveResponse.value[0];
    let pump: PoolLink | undefined;
    if (curveAccount?.owner === PUMP_PROGRAM_ID) {
      const curve = decodePumpBondingCurve(Buffer.from(curveAccount.data[0], 'base64'));
      await this.requireSupportedPumpMigration(identity.tokenMint, curve);
      if (
        !curve.complete &&
        ![PublicKey.default.toBase58(), WRAPPED_SOL_MINT].includes(curve.quoteMint)
      ) {
        const mints = await this.rpc.getMultipleAccounts([identity.tokenMint, curve.quoteMint]);
        if (!mints.value[0] || !mints.value[1]) fail('Pump route mint state is unavailable.');
        pump = pumpLink(
          curveAddress,
          captured(curveAccount),
          identity.tokenMint,
          mints.value[0].owner,
          mints.value[1].owner,
        );
      }
    }
    const launches = pump
      ? []
      : await this.launchPools(identity.tokenMint).catch((error: unknown) => {
          this.report('LAUNCHLAB_STATE_UNAVAILABLE', {
            mint: identity.tokenMint,
            message: error instanceof Error ? error.message : 'Launch-state discovery failed.',
          });
          if (error instanceof ExecutionEngineError)
            throw new ExecutionEngineError(
              error.code,
              `LAUNCHLAB_STATE_UNAVAILABLE: ${error.message}`,
            );
          return fail('LAUNCHLAB_STATE_UNAVAILABLE: launch-state discovery failed.');
        });
    let launchStage: string | null = null;
    const active: PoolLink[] = pump ? [pump] : [];
    for (const link of launches) {
      const response = await this.rpc.getMultipleAccounts([link.pool]);
      const account = response.value[0];
      if (!account) fail('LAUNCHLAB_STATE_UNAVAILABLE: pool disappeared.');
      const p = LaunchpadPool.decode(bytes(captured(account)));
      const stage =
        ['LAUNCHLAB_ACTIVE', 'LAUNCHLAB_MIGRATING', 'LAUNCHLAB_MIGRATED'][p.status] ??
        'LAUNCHLAB_STATE_UNAVAILABLE';
      this.report(stage, { mint: identity.tokenMint, pool: link.pool, status: p.status });
      if (p.status === 0) active.push(link);
      else if (p.status === 1)
        fail('LAUNCHLAB_MIGRATING: funding ended; awaiting on-chain migration.');
      else if (p.status === 2) launchStage = 'LAUNCHLAB_MIGRATED';
      else fail(`LAUNCHLAB_STATE_UNAVAILABLE: unknown status ${p.status}.`);
    }
    const find = async (mint: string, seen: Set<string>, depth: number): Promise<PoolLink[][]> => {
      if (mint === WRAPPED_SOL_MINT) return [[]];
      if (depth === 0) return [];
      const addresses = [...(await this.candidates.pools(mint))];
      const curve = await pumpBondingCurveAddress(mint);
      if (!addresses.includes(curve)) addresses.push(curve);
      if (!addresses.length) return [];
      const response = await this.rpc.getMultipleAccounts(addresses);
      const links: PoolLink[] = [];
      for (const [i, address] of addresses.entries()) {
        const a = response.value[i];
        if (!a) continue;
        try {
          let p: PoolLink;
          if (a.owner === PUMP_PROGRAM_ID) {
            const raw = captured(a);
            const quoteMint = pumpQuoteMint(raw);
            const mints = await this.rpc.getMultipleAccounts([mint, quoteMint]);
            if (!mints.value[0] || !mints.value[1]) fail('Pump route mint state is unavailable.');
            p = pumpLink(address, raw, mint, mints.value[0].owner, mints.value[1].owner);
          } else p = decodePoolLink(address, captured(a));
          if (
            p.program === RAYDIUM_LAUNCHLAB_PROGRAM &&
            LaunchpadPool.decode(bytes(captured(a))).status !== 0
          )
            continue;
          if (p.mintA === mint || p.mintB === mint) links.push(p);
        } catch (error) {
          if (error instanceof ExecutionEngineError && error.code === 'RPC_UNAVAILABLE')
            throw error;
          diagnostics.push(error instanceof Error ? error.message : 'Invalid pool.');
        }
      }
      links.sort(
        (a, b) =>
          Number(!(a.mintA === WRAPPED_SOL_MINT || a.mintB === WRAPPED_SOL_MINT)) -
            Number(!(b.mintA === WRAPPED_SOL_MINT || b.mintB === WRAPPED_SOL_MINT)) ||
          a.pool.localeCompare(b.pool),
      );
      const direct = links.filter(
        (p) => p.mintA === WRAPPED_SOL_MINT || p.mintB === WRAPPED_SOL_MINT,
      );
      const paths: PoolLink[][] = direct.slice(0, 6).map((p) => [p]);
      for (const link of links.filter((p) => !direct.includes(p))) {
        const other = link.mintA === mint ? link.mintB : link.mintA;
        if (seen.has(other)) continue;
        const tails = await find(other, new Set([...seen, other]), depth - 1);
        for (const tail of tails) paths.push([link, ...tail]);
        if (paths.length >= 8) break;
      }
      return paths;
    };
    // One discovery/capture/validation lifecycle for direct, active launch and composed routes.
    const paths: PoolLink[][] = [];
    if (active.length) {
      for (const link of active) {
        const tails =
          link.mintB === WRAPPED_SOL_MINT
            ? [[]]
            : await find(link.mintB, new Set([identity.tokenMint, link.mintB]), 2);
        for (const tail of tails) paths.push([link, ...tail]);
      }
    } else {
      paths.push(...(await find(identity.tokenMint, new Set([identity.tokenMint]), 3)));
    }
    // Stable topology priority; never choose a different path for BUY versus SELL/valuation.
    paths.sort(
      (a, b) =>
        a.length - b.length ||
        a
          .map((h) => h.pool)
          .join('/')
          .localeCompare(b.map((h) => h.pool).join('/')),
    );
    if (!paths.length)
      return fail(
        `${launchStage ? 'MIGRATED_ROUTE_UNAVAILABLE: ' : ''}No authoritative SOL route resolved. ${diagnostics.slice(-8).join(' ')}`,
      );
    const states = await this.capture(identity, paths.slice(0, 4));
    let best: MarketState | undefined;
    let bestScore = -2n;
    for (const candidate of states) {
      const state = candidate;
      try {
        const validated = await this.validateSnapshot(state);
        let score = -1n;
        try {
          // Same fixed representative trade for every feature, independent of caller/direction.
          const buy = quoteSelectedRoute(validated, 1_000_000_000n, true);
          const reverse = quoteSelectedRoute(validated, buy.output, false);
          // Compare like units: SOL recovery per actual SOL spent, not token quantities.
          score = (reverse.output * 1_000_000_000n) / buy.consumedInput;
        } catch (error) {
          if (
            !(error instanceof ExecutionEngineError) ||
            ![
              'ZERO_EXECUTABLE_OUTPUT',
              'INSUFFICIENT_EXECUTABLE_LIQUIDITY',
              'MARKET_STATE_UNAVAILABLE',
            ].includes(error.code)
          )
            throw error;
          this.report('ROUTE_REFERENCE_CAPACITY_UNAVAILABLE', {
            mint: identity.tokenMint,
            hops: validated.normalizedState['hops']!,
            code: error.code,
            message: error.message,
          });
        }
        if (score > bestScore) {
          best = validated;
          bestScore = score;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Invalid route snapshot';
        diagnostics.push(message);
        this.report('ROUTE_REJECTED', {
          mint: identity.tokenMint,
          hops: state.normalizedState['hops'] ?? null,
          slot: state.chainSlot?.toString() ?? null,
          message,
          code: error instanceof ExecutionEngineError ? error.code : 'INVALID_MARKET_STATE',
        });
      }
    }
    if (best) {
      if (this.topology.size >= 256) this.topology.delete(this.topology.keys().next().value!);
      this.topology.set(identity.tokenMint, {
        until: Date.now() + 10000,
        hops: structuredClone(best.normalizedState['hops']) as PoolLink[],
      });
      this.report('ROUTE_SELECTED', {
        mint: identity.tokenMint,
        route: executionRouteRecord(best, false),
        referenceInput: '1000000000',
        referenceRecoveryRatioPpb: bestScore < 0n ? null : bestScore.toString(),
      });
      return best;
    }
    return fail(`No authoritative SOL route resolved. ${diagnostics.slice(-8).join(' ')}`);
  }
}

export class SolanaRouteAdapter implements ProtocolAdapter {
  readonly protocolId: ProtocolId = SOLANA_ROUTE_PROTOCOL_ID;
  readonly adapterVersion = VERSION;
  constructor(readonly source: Pick<SolanaRouteSource, 'loadMarketState'>) {}
  loadMarketState(identity: MarketIdentity) {
    return this.source.loadMarketState(identity);
  }
  private quote(identity: MarketIdentity, state: MarketState, amount: bigint, buy: boolean) {
    if (
      identity.protocolId !== state.identity.protocolId ||
      identity.marketId !== state.identity.marketId ||
      identity.tokenMint !== state.identity.tokenMint
    )
      fail('Quote mint/market does not match evidence.');
    return quoteRecordedRoute(state, amount, buy);
  }
  async simulateBuy(
    request: BuySimulationRequest,
    state: MarketState,
  ): Promise<SimulatedExecution> {
    return this.execute(request, state, request.requestedPaperSol, true);
  }
  async simulateSell(
    request: SellSimulationRequest,
    state: MarketState,
  ): Promise<SimulatedExecution> {
    return this.execute(request, state, request.requestedTokenQuantity, false);
  }
  private execute(
    request: BuySimulationRequest | SellSimulationRequest,
    state: MarketState,
    amount: bigint,
    buy: boolean,
  ) {
    const q = this.quote(request.identity, state, amount, buy);
    const input = asset(buy ? WRAPPED_SOL_MINT : request.identity.tokenMint, q.consumedInput),
      output = asset(buy ? request.identity.tokenMint : WRAPPED_SOL_MINT, q.output);
    return {
      id: request.executionId,
      orderId: request.orderId,
      quote: {
        orderId: request.orderId,
        marketId: request.identity.marketId,
        protocolId: this.protocolId,
        adapterVersion: this.adapterVersion,
        marketStateRecordedAt: state.observedAt,
        marketStateFingerprint: createMarketStateEvidence(state).fingerprint,
        normalizationVersion: state.normalizationVersion,
        requestedInput: asset(buy ? WRAPPED_SOL_MINT : request.identity.tokenMint, amount),
        simulatedOutput: output,
        fees: q.fees,
      },
      actualInput: input,
      actualOutput: output,
      executedAt: request.executedAt,
      executionDetails: { hops: q.details },
    };
  }
  async valuePositionForExit(request: PositionExitValuationRequest, state: MarketState) {
    const q = this.quote(request.identity, state, request.tokenQuantity, false);
    return {
      identity: request.identity,
      tokenQuantity: request.tokenQuantity,
      paperSolValue: paperSolBaseUnits(q.output),
      route: executionRouteRecord(state, false, q.details),
      feeBreakdown: {
        fees: q.fees,
        totalPaperSolFees: paperSolBaseUnits(
          q.fees.reduce(
            (sum, f) => sum + (f.amount.asset === 'PAPER_SOL' ? f.amount.amount : 0n),
            0n,
          ),
        ),
      },
      marketStateFingerprint: createMarketStateEvidence(state).fingerprint,
      adapterVersion: this.adapterVersion,
    };
  }
  async maxExecutableSellQuantity(request: PositionExitValuationRequest, state: MarketState) {
    const s = snapshot(state);
    if (!s.hops.some((h) => [RAYDIUM_LAUNCHLAB_PROGRAM, PUMP_PROGRAM_ID].includes(h.program)))
      throw new ExecutionEngineError(
        'MARKET_STATE_UNAVAILABLE',
        'Exact composed-route exit capacity is unavailable.',
      );
    let low = 0n,
      high = request.tokenQuantity as bigint;
    // LaunchLab total quote fees and token transfer fees preserve monotone feasibility.
    // Zero-output dust is feasible but never counted as an executable exit.
    while (low < high) {
      const mid = (low + high + 1n) / 2n;
      try {
        this.quote(request.identity, state, mid, false);
        low = mid;
      } catch (error) {
        if (!(error instanceof ExecutionEngineError)) throw error;
        if (error.code === 'ZERO_EXECUTABLE_OUTPUT') low = mid;
        else if (error.code === 'INSUFFICIENT_EXECUTABLE_LIQUIDITY') high = mid - 1n;
        else throw error;
      }
    }
    if (low > 0n) {
      try {
        this.quote(request.identity, state, low, false);
        return tokenBaseUnits(low);
      } catch (error) {
        if (!(error instanceof ExecutionEngineError) || error.code !== 'ZERO_EXECUTABLE_OUTPUT')
          throw error;
      }
    }
    return tokenBaseUnits(0n);
  }
}

export function installSolanaMintResolver(router: ExecutionRouter, source: SolanaRouteSource,
  capability?: { resolveNonSolPumpSwap: (mint:string,quote:string)=>Promise<MarketIdentity> },
) {
  router.chartMetadataResolver = (address) => source.chartMetadata(address);
  router.contextResolver = (address) => source.resolveContext(address);
  const generic = (mint: string): MarketIdentity => ({
    protocolId: SOLANA_ROUTE_PROTOCOL_ID,
    marketId: identifier(`solana-route:${mint}`, 'MarketId'),
    tokenMint: identifier(mint, 'TokenMint'),
  });
  // Public mint resolution creates an economic identity only. State is loaded exactly once
  // by loadPositionRoute; old persisted origins enter this same venue-discovery boundary.
  router.mintResolver = async (mint) => {
    const route = await router.canonicalResolver!(generic(mint));
    return [PUMP_FUN_PROTOCOL_ID, PUMP_SWAP_PROTOCOL_ID].includes(
      route.executionIdentity.protocolId,
    )
      ? {
          protocolId: PUMP_FUN_PROTOCOL_ID,
          marketId: identifier(await pumpBondingCurveAddress(mint), 'MarketId'),
          tokenMint: identifier(mint, 'TokenMint'),
        }
      : generic(mint);
  };
  router.canonicalResolver = async (identity) => {
    const mint = identity.tokenMint;
    const curveAddress = await pumpBondingCurveAddress(mint);
    const response = await source.rpc.getMultipleAccounts([curveAddress]);
    const account = response.value[0];
    let executionIdentity = generic(mint);
    if (account) {
      if (account.owner !== PUMP_PROGRAM_ID) fail('Canonical Pump curve owner mismatch.');
      const curve = decodePumpBondingCurve(Buffer.from(account.data[0], 'base64'));
      const nativeQuote = [PublicKey.default.toBase58(), WRAPPED_SOL_MINT].includes(
        curve.quoteMint,
      );
      if (!nativeQuote && curve.complete && capability) {
        executionIdentity = await capability.resolveNonSolPumpSwap(mint,curve.quoteMint);
      } else {
        await source.requireSupportedPumpMigration(mint, curve);
      }
      if (nativeQuote) {
        const active = !curve.complete && curve.realTokenReserves > 0n;
        executionIdentity = {
          protocolId: active ? PUMP_FUN_PROTOCOL_ID : PUMP_SWAP_PROTOCOL_ID,
          marketId: identifier(
            active ? curveAddress : await canonicalPumpSwapPoolAddress(mint),
            'MarketId',
          ),
          tokenMint: mint,
        };
      }
    }
    source.report('ROUTE_DISCOVERED', {
      mint,
      origin: identity.marketId,
      protocol: executionIdentity.protocolId,
      market: executionIdentity.marketId,
      discoverySlot: response.context.slot,
    });
    return {
      originIdentity: identity,
      executionIdentity,
      migrated: executionIdentity.marketId !== identity.marketId,
    };
  };
}
