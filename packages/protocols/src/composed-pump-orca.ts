import { WhirlpoolsError, SwapErrorCode } from '@orca-so/whirlpools-sdk/dist/errors/errors.js';
import { PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import BN from 'bn.js';
import { Percentage } from '@orca-so/common-sdk';
import { createRequire } from 'node:module';
import type * as PumpSdkModule from '@pump-fun/pump-sdk';
// Use the SDK's published CommonJS entry: its ESM agent-payments dependency cannot import Anchor BN on Node.
const { PUMP_SDK, computeFeesBps, getBuyTokenAmountFromSolAmount, getBuySolAmountFromTokenAmount } =
  createRequire(import.meta.url)('@pump-fun/pump-sdk') as typeof PumpSdkModule;
import {
  ParsableWhirlpool,
  ParsableTickArray,
  ParsableOracle,
  ParsableWhirlpoolsConfig,
  PoolUtil,
  PDAUtil,
  SwapUtils,
  swapQuoteWithParams,
  NO_TOKEN_EXTENSION_CONTEXT,
  TickUtil,
} from '@orca-so/whirlpools-sdk';
import { ExecutionEngineError } from '@paperfund/execution';
import type { CapturedAccount, PoolLink } from './solana-routes.js';
import { PUMP_PROGRAM_ID, PUMP_FEE_PROGRAM_ID } from './pump-fun.js';

export const ORCA_WHIRLPOOL_PROGRAM = 'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc';
const key = (value: string) => new PublicKey(value);
const n = (value: BN) => BigInt(value.toString(10));
const info = (a: CapturedAccount) => ({
  owner: key(a.owner),
  data: Buffer.from(a.base64, 'base64'),
  executable: false,
  lamports: 0,
  rentEpoch: 0,
});
function fail(message: string): never {
  throw new ExecutionEngineError('INVALID_MARKET_STATE', message);
}

export function orcaLink(pool: string, account: CapturedAccount): PoolLink {
  const data = ParsableWhirlpool.parse(key(pool), info(account));
  if (!data || account.owner !== ORCA_WHIRLPOOL_PROGRAM) fail('Invalid Orca pool.');
  const ticks = [true, false].flatMap((direction) =>
    SwapUtils.getTickArrayPublicKeys(
      data.tickCurrentIndex,
      data.tickSpacing,
      direction,
      key(account.owner),
      key(pool),
    ).map((p) => p.toBase58()),
  );
  return {
    pool,
    program: account.owner,
    mintA: data.tokenMintA.toBase58(),
    mintB: data.tokenMintB.toBase58(),
    vaultA: data.tokenVaultA.toBase58(),
    vaultB: data.tokenVaultB.toBase58(),
    config: data.whirlpoolsConfig.toBase58(),
    extraAccounts: [
      ...new Set([...ticks, PDAUtil.getOracle(key(account.owner), key(pool)).publicKey.toBase58()]),
    ],
  };
}

export function pumpQuoteMint(account: CapturedAccount): string {
  if (account.owner !== PUMP_PROGRAM_ID) fail('Invalid Pump owner.');
  return PUMP_SDK.decodeBondingCurve(info(account)).quoteMint.toBase58();
}

export function pumpLink(
  pool: string,
  account: CapturedAccount,
  mint: string,
  baseProgram: string,
  quoteProgram: string,
): PoolLink {
  const curve = PUMP_SDK.decodeBondingCurve(info(account));
  const program = key(PUMP_PROGRAM_ID);
  const expected = PublicKey.findProgramAddressSync(
    [Buffer.from('bonding-curve'), key(mint).toBuffer()],
    program,
  )[0];
  if (
    account.owner !== PUMP_PROGRAM_ID ||
    expected.toBase58() !== pool ||
    curve.quoteMint.equals(PublicKey.default)
  )
    fail('Invalid composed Pump curve identity/quote.');
  return {
    pool,
    program: PUMP_PROGRAM_ID,
    mintA: mint,
    mintB: curve.quoteMint.toBase58(),
    vaultA: getAssociatedTokenAddressSync(key(mint), expected, true, key(baseProgram)).toBase58(),
    vaultB: getAssociatedTokenAddressSync(
      curve.quoteMint,
      expected,
      true,
      key(quoteProgram),
    ).toBase58(),
    config: PublicKey.findProgramAddressSync([Buffer.from('global')], program)[0].toBase58(),
    platform: PublicKey.findProgramAddressSync(
      [Buffer.from('fee_config'), program.toBuffer()],
      key(PUMP_FEE_PROGRAM_ID),
    )[0].toBase58(),
  };
}

/** All tick arrays, oracle, fees, vaults and mints come from the caller's one recorded batch. */
export function quoteSupplementalHop(
  hop: PoolLink,
  accounts: Record<string, CapturedAccount>,
  amount: bigint,
  aToB: boolean,
  time: bigint,
  supply: bigint,
  absentAccounts: readonly string[],
) {
  const need = (address: string) => {
    const a = accounts[address];
    if (!a) fail(`Missing composed account ${address}.`);
    return a;
  };
  const pool = need(hop.pool);
  if (hop.program === PUMP_PROGRAM_ID) {
    const c = PUMP_SDK.decodeBondingCurve(info(pool));
    const expected = pumpLink(
      hop.pool,
      pool,
      hop.mintA,
      need(hop.mintA).owner,
      need(hop.mintB).owner,
    );
    if (Object.keys(expected).some((k) => expected[k] !== hop[k]))
      fail('Pump curve linkage changed.');
    if (
      c.complete ||
      c.virtualTokenReserves.lten(0) ||
      c.virtualQuoteReserves.lten(0) ||
      c.realTokenReserves.isNeg() ||
      c.realQuoteReserves.isNeg()
    )
      fail('Pump curve state is inactive or inconsistent.');
    const globalAccount = need(hop.config!),
      feeAccount = need(hop.platform!);
    if (globalAccount.owner !== PUMP_PROGRAM_ID || feeAccount.owner !== PUMP_FEE_PROGRAM_ID)
      fail('Pump config owner mismatch.');
    const global = PUMP_SDK.decodeGlobal(info(globalAccount)),
      feeConfig = PUMP_SDK.decodeFeeConfig(info(feeAccount));
    const fees = computeFeesBps({
      global,
      feeConfig,
      mintSupply: new BN((c.isMayhemMode ? supply : 1_000_000_000_000_000n).toString()),
      virtualQuoteReserves: c.virtualQuoteReserves,
      virtualTokenReserves: c.virtualTokenReserves,
      quoteMint: c.quoteMint,
      creatorFeeBps: c.creatorFeeBps,
    });
    const protocolBps = n(fees.protocolFeeBps),
      creatorBps = c.creator.equals(PublicKey.default) ? 0n : n(fees.creatorFeeBps);
    if (protocolBps < 0n || creatorBps < 0n || protocolBps + creatorBps >= 10000n)
      fail('Invalid composed Pump fees.');
    const params = {
      global,
      feeConfig,
      mintSupply: new BN((c.isMayhemMode ? supply : 1_000_000_000_000_000n).toString()),
      bondingCurve: c,
      quoteMint: c.quoteMint,
    };
    let gross: bigint,
      output: bigint,
      consumed = amount;
    if (aToB) {
      gross = (amount * n(c.virtualQuoteReserves)) / (n(c.virtualTokenReserves) + amount);
      if (gross > n(c.realQuoteReserves))
        throw new ExecutionEngineError(
          'INSUFFICIENT_EXECUTABLE_LIQUIDITY',
          'Pump quote liquidity exhausted.',
        );
      output = gross;
    } else {
      output = n(getBuyTokenAmountFromSolAmount({ ...params, amount: new BN(amount.toString()) }));
      consumed = n(
        getBuySolAmountFromTokenAmount({ ...params, amount: new BN(output.toString()) }),
      );
      gross = (output * n(c.virtualQuoteReserves)) / (n(c.virtualTokenReserves) - output) + 1n;
      if (output === n(c.realTokenReserves) && consumed < amount)
        throw new ExecutionEngineError(
          'INSUFFICIENT_EXECUTABLE_LIQUIDITY',
          'LAUNCHLAB_BUY_CAP: Pump composed input exceeds remaining sale.',
        );
    }
    const protocol = (gross * protocolBps + 9999n) / 10000n,
      creator = (gross * creatorBps + 9999n) / 10000n;
    if (aToB) output -= protocol + creator;
    return {
      output,
      feeMint: hop.mintB,
      protocol,
      creator,
      lp: 0n,
      detail: {
        virtualBase: c.virtualTokenReserves.toString(),
        virtualQuote: c.virtualQuoteReserves.toString(),
        realBase: c.realTokenReserves.toString(),
        realQuote: c.realQuoteReserves.toString(),
        unusedQuoteInput: aToB ? '0' : (amount - consumed).toString(),
      },
    };
  }
  const { data, ticks, oracle } = readOrcaSnapshot(hop, accounts, aToB, absentAccounts);
  const q = (() => {
    try {
      return swapQuoteWithParams(
        {
          whirlpoolData: data,
          tokenAmount: new BN(amount.toString()),
          otherAmountThreshold: new BN(0),
          sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(aToB),
          aToB,
          amountSpecifiedIsInput: true,
          tickArrays: ticks,
          oracleData: oracle,
          tokenExtensionCtx: NO_TOKEN_EXTENSION_CONTEXT,
          timestampInSeconds: new BN(time.toString()),
        },
        Percentage.fromFraction(0, 1),
      );
    } catch (error) {
      if (
        error instanceof WhirlpoolsError &&
        error.errorCode === SwapErrorCode.TickArraySequenceInvalid
      )
        throw new ExecutionEngineError(
          'MARKET_STATE_UNAVAILABLE',
          'Orca captured tick range cannot establish this quote.',
        );
      throw error;
    }
  })();
  if (n(q.estimatedAmountIn) !== amount)
    throw new ExecutionEngineError(
      'MARKET_STATE_UNAVAILABLE',
      'Orca captured tick range cannot establish the full input quote.',
    );
  // The SDK exposes aggregate swap fees, not the per-crossing protocol split.
  return {
    output: n(q.estimatedAmountOut),
    feeMint: aToB ? hop.mintA : hop.mintB,
    protocol: 0n,
    creator: 0n,
    lp: n(q.estimatedFeeAmount),
    feeCategory: 'AMM_TRADE_FEE',
    detail: {
      tradeFeeRate: data.feeRate,
      protocolShareRate: data.protocolFeeRate,
      totalTradeFee: q.estimatedFeeAmount.toString(),
      sqrtPrice: data.sqrtPrice.toString(),
      endSqrtPrice: q.estimatedEndSqrtPrice.toString(),
      tickCurrentIndex: data.tickCurrentIndex,
      endTick: q.estimatedEndTickIndex,
    },
  };
}

export function readOrcaSnapshot(
  hop: PoolLink,
  accounts: Record<string, CapturedAccount>,
  aToB: boolean,
  absentAccounts: readonly string[],
) {
  const need = (address: string) => {
    const a = accounts[address];
    if (!a) fail('Missing composed account ' + address);
    return a;
  };
  const pool = need(hop.pool);
  const data = ParsableWhirlpool.parse(key(hop.pool), info(pool));
  if (!data || pool.owner !== ORCA_WHIRLPOOL_PROGRAM) fail('Orca pool is invalid.');
  const config = need(data.whirlpoolsConfig.toBase58());
  const feeTierIndex = data.feeTierIndexSeed[0]! + data.feeTierIndexSeed[1]! * 256;
  if (
    config.owner !== hop.program ||
    !ParsableWhirlpoolsConfig.parse(data.whirlpoolsConfig, info(config)) ||
    PDAUtil.getWhirlpool(
      key(hop.program),
      data.whirlpoolsConfig,
      data.tokenMintA,
      data.tokenMintB,
      feeTierIndex,
    ).publicKey.toBase58() !== hop.pool
  )
    fail('Orca config/pool PDA mismatch.');
  const ticks = SwapUtils.getTickArrayPublicKeys(
    data.tickCurrentIndex,
    data.tickSpacing,
    aToB,
    key(hop.program),
    key(hop.pool),
  ).map((address, index) => {
    const startTickIndex = TickUtil.getStartTickIndex(
      data.tickCurrentIndex + (aToB ? 0 : data.tickSpacing),
      data.tickSpacing,
      aToB ? -index : index,
    );
    const raw = accounts[address.toBase58()];
    if (!raw && absentAccounts.includes(address.toBase58()))
      return { address, startTickIndex, data: null };
    if (!raw) fail('Required Orca tick snapshot was not captured.');
    if (raw.owner !== hop.program) fail('Orca tick array owner mismatch.');
    const parsed = ParsableTickArray.parse(address, info(raw));
    if (
      !parsed ||
      parsed.whirlpool.toBase58() !== hop.pool ||
      PDAUtil.getTickArray(
        key(hop.program),
        key(hop.pool),
        parsed.startTickIndex,
      ).publicKey.toBase58() !== address.toBase58()
    )
      fail('Orca tick array linkage invalid.');
    return { address, startTickIndex, data: parsed };
  });
  const oracleAddress = PDAUtil.getOracle(key(hop.program), key(hop.pool)).publicKey;
  const rawOracle = accounts[oracleAddress.toBase58()];
  if (rawOracle && rawOracle.owner !== hop.program) fail('Orca oracle owner mismatch.');
  const oracle = rawOracle ? ParsableOracle.parse(oracleAddress, info(rawOracle)) : null;
  if ((rawOracle && !oracle) || (PoolUtil.isInitializedWithAdaptiveFee(data) && !oracle))
    fail('Required Orca oracle state is unavailable.');
  return { data, ticks, oracle };
}
/** Structural validation in both directions, including genuine zero-capacity exits. */
export function assertOrcaSnapshot(
  hop: PoolLink,
  accounts: Record<string, CapturedAccount>,
  absentAccounts: readonly string[],
) {
  readOrcaSnapshot(hop, accounts, true, absentAccounts);
  readOrcaSnapshot(hop, accounts, false, absentAccounts);
}
