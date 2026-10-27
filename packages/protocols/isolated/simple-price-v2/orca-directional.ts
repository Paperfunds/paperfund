/** Opt-in SDK reference only; no returned pool state and no financial execution registration. */
import BN from 'bn.js';
import { PublicKey } from '@solana/web3.js';
import { Percentage } from '@orca-so/common-sdk';
import {
  ParsableWhirlpool,
  ParsableTickArray,
  ParsableOracle,
  PDAUtil,
  SwapUtils,
  TickUtil,
  swapQuoteWithParams,
  NO_TOKEN_EXTENSION_CONTEXT,
} from '@orca-so/whirlpools-sdk';
import { assertOrcaSnapshot } from '../../src/composed-pump-orca.js';
import type { PoolLink, CapturedAccount } from '../../src/solana-routes.js';
export function orcaDirectionalReference(
  hop: PoolLink,
  accounts: Record<string, CapturedAccount>,
  absent: readonly string[],
  input: bigint,
  aToB: boolean,
  time: bigint,
) {
  assertOrcaSnapshot(hop, accounts, absent);
  const key = (s: string) => new PublicKey(s);
  const info = (a: CapturedAccount) => ({
    owner: key(a.owner),
    data: Buffer.from(a.base64, 'base64'),
    executable: false,
    lamports: 0,
    rentEpoch: 0,
  });
  const data = ParsableWhirlpool.parse(key(hop.pool), info(accounts[hop.pool]!));
  if (!data) throw new Error('ORCA_REFERENCE_POOL_UNAVAILABLE');
  const ticks = SwapUtils.getTickArrayPublicKeys(
    data.tickCurrentIndex,
    data.tickSpacing,
    aToB,
    key(hop.program),
    key(hop.pool),
  ).map((address, index) => {
    const raw = accounts[address.toBase58()];
    return {
      address,
      startTickIndex: TickUtil.getStartTickIndex(
        data.tickCurrentIndex + (aToB ? 0 : data.tickSpacing),
        data.tickSpacing,
        aToB ? -index : index,
      ),
      data: raw ? ParsableTickArray.parse(address, info(raw)) : null,
    };
  });
  const oracleAddress = PDAUtil.getOracle(key(hop.program), key(hop.pool)).publicKey,
    raw = accounts[oracleAddress.toBase58()];
  const q = swapQuoteWithParams(
    {
      whirlpoolData: data,
      tokenAmount: new BN(input.toString()),
      otherAmountThreshold: new BN(0),
      sqrtPriceLimit: SwapUtils.getDefaultSqrtPriceLimit(aToB),
      aToB,
      amountSpecifiedIsInput: true,
      tickArrays: ticks,
      oracleData: raw ? ParsableOracle.parse(oracleAddress, info(raw)) : null,
      tokenExtensionCtx: NO_TOKEN_EXTENSION_CONTEXT,
      timestampInSeconds: new BN(time.toString()),
    },
    Percentage.fromFraction(0, 1),
  );
  if (BigInt(q.estimatedAmountIn.toString()) !== input)
    throw new Error('ORCA_REFERENCE_INCOMPLETE_INPUT');
  return {
    input,
    output: BigInt(q.estimatedAmountOut.toString()),
    fee: BigInt(q.estimatedFeeAmount.toString()),
    rateMin: BigInt(q.estimatedFeeRateMin),
    rateMax: BigInt(q.estimatedFeeRateMax),
  };
}
