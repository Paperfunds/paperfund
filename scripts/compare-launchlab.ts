import 'dotenv/config';
import BN from 'bn.js';
import { readFileSync, writeFileSync } from 'node:fs';
import { PublicKey } from '@solana/web3.js';
import {
  unpackMint,
  unpackAccount,
  getExtensionTypes,
  getTransferFeeConfig,
} from '@solana/spl-token';
import { LaunchpadPool, LaunchpadConfig, PlatformConfig } from '@raydium-io/raydium-sdk-v2';
import { createProductionExecutionRouter } from '../packages/protocols/src/production.js';
import {
  RAYDIUM_LAUNCHLAB_PROGRAM,
  quoteRecordedRoute,
  type CapturedAccount,
  type PoolLink,
} from '../packages/protocols/src/solana-routes.js';
import type { MarketState } from '@paperfund/execution';

function normalize(value: unknown): unknown {
  if (typeof value === 'bigint' || BN.isBN(value)) return value.toString(10);
  if (value instanceof PublicKey) return value.toBase58();
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalize(item)]));
  return value;
}
const stringify = (v: unknown) => JSON.stringify(normalize(v), null, 2);
const router = createProductionExecutionRouter({
  rpcUrl: process.env['SOLANA_RPC_URL'] ?? 'https://api.mainnet-beta.solana.com',
  rpcTimeoutMs: 15000,
  commitment: 'confirmed',
});
const samples = [];
for (const context of process.argv.slice(2)) {
  try {
    let state: MarketState;
    if (context.endsWith('.json')) {
      const recorded = JSON.parse(readFileSync(context, 'utf8'));
      state = { ...recorded, chainSlot: BigInt(recorded.chainSlot) };
    } else {
      const mint = await router.contextResolver!(context);
      const identity = await router.mintResolver!(mint);
      const resolved = await router.resolvePositionRoute(identity);
      state = await resolved.adapter.loadMarketState(resolved.route.executionIdentity);
    }
    const hops = state.normalizedState['hops'] as PoolLink[];
    const hop = hops.find((h) => h.program === RAYDIUM_LAUNCHLAB_PROGRAM);
    if (!hop) {
      samples.push({
        context,
        classification: 'MIGRATED_OR_NON_LAUNCHLAB',
        slot: state.chainSlot,
        hops,
      });
      continue;
    }
    const accounts = state.normalizedState['accounts'] as Record<string, CapturedAccount>;
    const raw = (address: string) => {
      const account = accounts[address];
      if (!account) throw Error(`Missing snapshot account ${address}`);
      return {
        data: Buffer.from(account.base64, 'base64'),
        owner: new PublicKey(account.owner),
        lamports: 0,
        executable: false,
        rentEpoch: 0,
      };
    };
    const pool = LaunchpadPool.decode(raw(hop.pool).data);
    const config = LaunchpadConfig.decode(raw(hop.config!).data);
    const platform = PlatformConfig.decode(raw(hop.platform!).data);
    const mint = (address: string) => {
      const account = raw(address),
        decoded = unpackMint(new PublicKey(address), account, account.owner);
      return {
        address,
        owner: account.owner.toBase58(),
        decimals: decoded.decimals,
        supply: decoded.supply,
        mintAuthority: decoded.mintAuthority,
        freezeAuthority: decoded.freezeAuthority,
        extensions: getExtensionTypes(decoded.tlvData),
        transferFees: getTransferFeeConfig(decoded),
      };
    };
    const vault = (address: string) => {
      const account = raw(address),
        decoded = unpackAccount(new PublicKey(address), account, account.owner);
      return {
        address,
        program: account.owner.toBase58(),
        mint: decoded.mint,
        authority: decoded.owner,
        amount: decoded.amount,
        initialized: decoded.isInitialized,
        frozen: decoded.isFrozen,
      };
    };
    const buy = quoteRecordedRoute(state, 1_000_000n, true);
    const soldBefore = BigInt(pool.realA.toString(10));
    const sellQuantity = buy.output < soldBefore / 4n ? buy.output : soldBefore / 4n;
    const sell =
      sellQuantity > 0n
        ? quoteRecordedRoute(state, sellQuantity, false)
        : { unavailable: 'No previously sold curve quantity in this snapshot' };
    const partial = sellQuantity > 1n ? quoteRecordedRoute(state, sellQuantity / 2n, false) : null;
    samples.push({
      context,
      observedAt: state.observedAt,
      slot: state.chainSlot,
      classification: 'LAUNCHLAB_ACTIVE',
      owner: raw(hop.pool).owner.toBase58(),
      poolAddress: hop.pool,
      pool,
      configAddress: hop.config,
      config,
      platformAddress: hop.platform,
      platform: {
        ...platform,
        name: Buffer.from(platform.name).toString('utf8').replace(/\0/g, ''),
        web: Buffer.from(platform.web).toString('utf8').replace(/\0/g, ''),
      },
      base: mint(hop.mintA),
      quote: mint(hop.mintB),
      vaults: [vault(hop.vaultA), vault(hop.vaultB)],
      hops,
      quoteInputs: {
        buyLamports: '1000000',
        sellQuantity,
        snapshot: 'same immutable state; not sequential execution',
      },
      buy,
      sell,
      partial,
    });
  } catch (error) {
    samples.push({ context, error: error instanceof Error ? error.message : String(error) });
  }
}
writeFileSync('docs/launchlab-comparison.json', stringify(samples) + '\n');
console.log(
  stringify(
    samples.map((sample) =>
      'pool' in sample
        ? {
            context: sample.context,
            classification: sample.classification,
            slot: sample.slot,
            pool: sample.poolAddress,
            quote: sample.quote.address,
            flag: sample.pool.mintProgramFlag,
            curve: sample.config.curveType,
            platform: sample.platform.name,
            buy: sample.buy.output,
            sell: 'output' in sample.sell ? sample.sell.output : null,
          }
        : sample,
    ),
  ),
);
