import { readFileSync } from 'node:fs';
import { PublicKey } from '@solana/web3.js';
import {
  LaunchpadPool,
  LaunchpadConfig,
  CpmmPoolInfoLayout,
  getPdaLaunchpadPoolId,
  getPdaLaunchpadVaultId,
} from '@raydium-io/raydium-sdk-v2';
import { recordedRoute } from './routes.js';
import type { MarketState } from '@paperfund/execution';
import { WRAPPED_SOL_MINT } from '../../src/pump-fun.js';
import {
  RAYDIUM_LAUNCHLAB_PROGRAM,
  type CapturedAccount,
  type PoolLink,
} from '../../src/solana-routes.js';
export function recordedLaunchlab(): MarketState {
  const json = JSON.parse(
    readFileSync(new URL('./launchlab-active.json', import.meta.url), 'utf8'),
  );
  return { ...json, chainSlot: BigInt(json.chainSlot) };
}
export function operatorLaunchlab(): MarketState {
  const json = JSON.parse(
    readFileSync(new URL('./launchlab-operator.json', import.meta.url), 'utf8'),
  );
  return { ...json, chainSlot: BigInt(json.chainSlot) };
}
export function normalLaunchlab(): MarketState {
  const json = JSON.parse(
    readFileSync(new URL('./launchlab-normal.json', import.meta.url), 'utf8'),
  );
  return { ...json, chainSlot: BigInt(json.chainSlot) };
}
export function mutateLaunchPool(
  state: MarketState,
  mutate: (pool: ReturnType<typeof LaunchpadPool.decode>) => void,
) {
  const accounts = state.normalizedState['accounts'] as Record<string, CapturedAccount>;
  const hop = (state.normalizedState['hops'] as PoolLink[])[0]!;
  const data = Buffer.from(accounts[hop.pool]!.base64, 'base64');
  const p = LaunchpadPool.decode(data);
  mutate(p);
  LaunchpadPool.encode(p, data);
  accounts[hop.pool] = { ...accounts[hop.pool]!, base64: data.toString('base64') };
}
/** Synthetic SOL launch derived from the recorded state, keeping real Token-2022 mechanics. */
export function directLaunchlab() {
  const state = recordedLaunchlab();
  const accounts = state.normalizedState['accounts'] as Record<string, CapturedAccount>;
  const hop = (state.normalizedState['hops'] as PoolLink[])[0]!;
  const program = new PublicKey(RAYDIUM_LAUNCHLAB_PROGRAM);
  const pool = getPdaLaunchpadPoolId(
    program,
    new PublicKey(hop.mintA),
    new PublicKey(WRAPPED_SOL_MINT),
  ).publicKey;
  const va = getPdaLaunchpadVaultId(program, pool, new PublicKey(hop.mintA)).publicKey;
  const vb = getPdaLaunchpadVaultId(program, pool, new PublicKey(WRAPPED_SOL_MINT)).publicKey;
  const data = Buffer.from(accounts[hop.pool]!.base64, 'base64');
  const p = LaunchpadPool.decode(data);
  p.mintB = new PublicKey(WRAPPED_SOL_MINT);
  p.mintDecimalsB = 9;
  p.vaultA = va;
  p.vaultB = vb;
  LaunchpadPool.encode(p, data);
  accounts[pool.toBase58()] = { ...accounts[hop.pool]!, base64: data.toString('base64') };
  accounts[va.toBase58()] = accounts[hop.vaultA]!;
  const vaultB = Buffer.from(accounts[hop.vaultB]!.base64, 'base64');
  new PublicKey(WRAPPED_SOL_MINT).toBuffer().copy(vaultB, 0);
  accounts[vb.toBase58()] = { ...accounts[hop.vaultB]!, base64: vaultB.toString('base64') };
  const configData = Buffer.from(accounts[hop.config!]!.base64, 'base64');
  const config = LaunchpadConfig.decode(configData);
  config.mintB = new PublicKey(WRAPPED_SOL_MINT);
  LaunchpadConfig.encode(config, configData);
  accounts[hop.config!] = { ...accounts[hop.config!]!, base64: configData.toString('base64') };
  return {
    ...state,
    normalizedState: {
      ...state.normalizedState,
      hops: [
        {
          ...hop,
          pool: pool.toBase58(),
          mintB: WRAPPED_SOL_MINT,
          vaultA: va.toBase58(),
          vaultB: vb.toBase58(),
        },
      ],
    },
  };
}
export function migratedLaunchlab() {
  const launch = recordedLaunchlab(),
    state = recordedRoute(0);
  const accounts = state.normalizedState['accounts'] as Record<string, CapturedAccount>;
  const launchAccounts = launch.normalizedState['accounts'] as Record<string, CapturedAccount>;
  const hops = state.normalizedState['hops'] as PoolLink[];
  const hop = hops[0]!,
    mint = launch.identity.tokenMint;
  const data = Buffer.from(accounts[hop.pool]!.base64, 'base64');
  const p = CpmmPoolInfoLayout.decode(data);
  p.mintA = new PublicKey(mint);
  p.mintProgramA = new PublicKey(launchAccounts[mint]!.owner);
  CpmmPoolInfoLayout.encode(p, data);
  accounts[hop.pool] = { ...accounts[hop.pool]!, base64: data.toString('base64') };
  accounts[mint] = launchAccounts[mint]!;
  const vault = Buffer.from(accounts[hop.vaultA]!.base64, 'base64');
  new PublicKey(mint).toBuffer().copy(vault, 0);
  accounts[hop.vaultA] = { owner: launchAccounts[mint]!.owner, base64: vault.toString('base64') };
  return {
    ...state,
    identity: launch.identity,
    normalizedState: {
      ...state.normalizedState,
      hops: [{ ...hop, mintA: mint }, ...hops.slice(1)],
      tokenDecimals: launch.normalizedState['tokenDecimals']!,
    },
  };
}
