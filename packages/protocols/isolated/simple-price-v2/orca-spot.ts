/** Decode only an already structurally validated snapshot. Never quote swaps or update pool state. */
import { PublicKey } from '@solana/web3.js';
import { ParsableWhirlpool, PoolUtil } from '@orca-so/whirlpools-sdk';
import type { CapturedAccount } from '../../src/solana-routes.js';
export function orcaSpot(pool: string, account: CapturedAccount) {
  const data = ParsableWhirlpool.parse(new PublicKey(pool), {
    owner: new PublicKey(account.owner),
    data: Buffer.from(account.base64, 'base64'),
    executable: false,
    lamports: 0,
    rentEpoch: 0,
  });
  if (!data) throw new Error('CONVERSION_POOL_UNAVAILABLE');
  return {
    mintA: data.tokenMintA.toBase58(),
    mintB: data.tokenMintB.toBase58(),
    bPerA: { n: BigInt(data.sqrtPrice.toString()) ** 2n, d: 1n << 128n },
    feePpm: BigInt(data.feeRate),
    adaptive: PoolUtil.isInitializedWithAdaptiveFee(data),
  };
}
