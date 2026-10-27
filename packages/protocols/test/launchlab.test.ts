import { describe, expect, it } from 'vitest';
import BN from 'bn.js';
import { LaunchpadPool, LaunchpadConfig, PlatformConfig, Curve } from '@raydium-io/raydium-sdk-v2';
import { ExecutionRouter, createMarketStateEvidence, type MarketState } from '@paperfund/execution';
import { tokenBaseUnits } from '@paperfund/core';
import {
  SolanaRouteSource,
  SolanaRouteAdapter,
  quoteRecordedRoute,
  type CapturedAccount,
  type PoolLink,
} from '../src/solana-routes.js';
import type { SolanaRpcClient } from '../src/pump-fun.js';
import {
  recordedLaunchlab,
  directLaunchlab,
  mutateLaunchPool,
  migratedLaunchlab,
  operatorLaunchlab,
  normalLaunchlab,
} from './fixtures/launchlab.js';
import { exitPreflight } from '../../../apps/api/src/exit-preflight.js';

function rpcFor(state: MarketState) {
  const accounts = state.normalizedState['accounts'] as Record<string, CapturedAccount>;
  const launch = (state.normalizedState['hops'] as PoolLink[])[0]!;
  return {
    async getProgramAccountAddresses() {
      return [launch.pool];
    },
    async getMultipleAccounts(addresses: readonly string[]) {
      return {
        context: { slot: Number(state.chainSlot) },
        value: addresses.map((a) =>
          accounts[a]
            ? { owner: accounts[a]!.owner, data: [accounts[a]!.base64, 'base64'] as const }
            : null,
        ),
      };
    },
  } as SolanaRpcClient;
}
describe('active LaunchLab execution', () => {
  it('compares chain-recorded normal LaunchLab and Stonk configurations without changing general execution', () => {
    for (const [state, expectedFlag, expectedPlatform] of [
      [normalLaunchlab(), 0, 'Raydium'],
      [recordedLaunchlab(), 1, 'StonkFun'],
      [operatorLaunchlab(), 3, 'StonkFun'],
    ] as const) {
      const accounts = state.normalizedState['accounts'] as Record<string, CapturedAccount>;
      const hop = (state.normalizedState['hops'] as PoolLink[])[0]!;
      const pool = LaunchpadPool.decode(Buffer.from(accounts[hop.pool]!.base64, 'base64'));
      const config = LaunchpadConfig.decode(Buffer.from(accounts[hop.config!]!.base64, 'base64'));
      const platform = PlatformConfig.decode(
        Buffer.from(accounts[hop.platform!]!.base64, 'base64'),
      );
      expect(pool.status).toBe(0);
      expect(pool.mintProgramFlag).toBe(expectedFlag);
      expect(config.curveType).toBe(0);
      expect(Buffer.from(platform.name).toString('utf8').replace(/\0/g, '')).toBe(expectedPlatform);
      expect(accounts[hop.pool]!.owner).toBe(hop.program);
      const buy = quoteRecordedRoute(state, 1000000n, true);
      expect(buy.output).toBeGreaterThan(0n);
      expect(quoteRecordedRoute(state, buy.output, false).output).toBeGreaterThan(0n);
      expect(quoteRecordedRoute(state, buy.output / 2n, false).output).toBeGreaterThan(0n);
    }
  });
  it('executes the exact operator pool with Token-2022 quote and rejects incorrect flag bits', async () => {
    const state = operatorLaunchlab();
    const accounts = state.normalizedState['accounts'] as Record<string, CapturedAccount>;
    const hop = (state.normalizedState['hops'] as PoolLink[])[0]!;
    const pool = LaunchpadPool.decode(Buffer.from(accounts[hop.pool]!.base64, 'base64'));
    expect(hop.pool).toBe('FSyHxdJ6x8qBbggzHAZmUehoKwHMXJNAr656cZkpPs92');
    expect(pool.status).toBe(0);
    expect(pool.mintProgramFlag).toBe(3);
    const source = new SolanaRouteSource(rpcFor(state), {
      async pools() {
        return [(state.normalizedState['hops'] as PoolLink[])[1]!.pool];
      },
      async context() {
        return [];
      },
    });
    expect(await source.resolveContext(hop.pool)).toBe(state.identity.tokenMint);
    const loaded = await source.loadMarketState(state.identity);
    const buy = quoteRecordedRoute(loaded, 1_000_000n, true);
    expect(buy.output).toBeGreaterThan(0n);
    expect(quoteRecordedRoute(loaded, buy.output, false).output).toBeGreaterThan(0n);
    for (const flag of [0, 1, 2, 4]) {
      const invalid = structuredClone(state);
      mutateLaunchPool(invalid, (p) => {
        p.mintProgramFlag = flag;
      });
      expect(() => quoteRecordedRoute(invalid, 1_000_000n, true)).toThrow(
        'mint program/decimals mismatch',
      );
    }
  });
  it('verifies non-SOL launch hints when the RPC provider rejects filtered discovery', async () => {
    const state = recordedLaunchlab();
    const hops = state.normalizedState['hops'] as PoolLink[];
    const rpc = rpcFor(state);
    rpc.getProgramAccountAddresses = async () => {
      throw Error('Provider does not support filtered getProgramAccounts');
    };
    const events: string[] = [];
    const source = new SolanaRouteSource(
      rpc,
      {
        async pools(mint) {
          return mint === state.identity.tokenMint
            ? [hops[1]!.pool, hops[0]!.pool]
            : [hops[1]!.pool];
        },
        async context() {
          return [];
        },
      },
      (event) => events.push(event),
    );
    const loaded = await source.loadMarketState(state.identity);
    expect((loaded.normalizedState['hops'] as PoolLink[])[0]!.pool).toBe(hops[0]!.pool);
    expect(quoteRecordedRoute(loaded, 1000000n, true).output).toBeGreaterThan(0n);
    expect(events).toContain('LAUNCHLAB_DISCOVERY_VERIFIED_HINTS');
  });
  it('replays historical LaunchLab evidence with its recorded legacy mechanics', () => {
    const state = recordedLaunchlab();
    const hops = state.normalizedState['hops'] as PoolLink[];
    const legacyHop = { ...hops[0]! };
    delete legacyHop.platform;
    const legacy = {
      ...state,
      normalizedState: { ...state.normalizedState, hops: [legacyHop, ...hops.slice(1)] },
    };
    const corrected = quoteRecordedRoute(state, 1000000n, true);
    const old = quoteRecordedRoute(legacy, 1000000n, true);
    expect(old.output).toBeGreaterThan(corrected.output);
    expect(quoteRecordedRoute(legacy, 1000000n, true)).toEqual(old);
  });
  it('prefers a canonical SOL launch when all indexer discovery is failing', async () => {
    const state = directLaunchlab();
    const source = new SolanaRouteSource(rpcFor(state), {
      async pools() {
        throw Error('Migrated route lookup unavailable');
      },
      async context() {
        return [];
      },
    });
    expect((await source.loadMarketState(state.identity)).identity).toEqual(state.identity);
  });
  it('bounds composed BUY spend by the remaining launch sale without charging unused SOL', () => {
    const state = recordedLaunchlab();
    mutateLaunchPool(state, (p) => {
      p.totalSellA = p.realA.add(new BN(1000000000));
    });
    const q = quoteRecordedRoute(state, 1000000n, true);
    expect(q.consumedInput).toBeGreaterThan(0n);
    expect(q.consumedInput).toBeLessThan(1000000n);
    expect(q.output).toBeLessThanOrEqual(1000000000n);
    expect(quoteRecordedRoute(state, q.consumedInput, true).output).toBe(q.output);
  });
  it('resolves the recorded non-SOL Stonk launch before any migrated-token discovery', async () => {
    const state = recordedLaunchlab();
    const quoteHop = (state.normalizedState['hops'] as PoolLink[])[1]!;
    const source = new SolanaRouteSource(rpcFor(state), {
      async pools(mint) {
        expect(mint).not.toBe(state.identity.tokenMint);
        return [quoteHop.pool];
      },
      async context() {
        throw Error('Indexer unavailable');
      },
    });
    const loaded = await source.loadMarketState(state.identity);
    expect((loaded.normalizedState['hops'] as PoolLink[])[0]!.pool).toBe(
      (state.normalizedState['hops'] as PoolLink[])[0]!.pool,
    );
    expect(
      await source.resolveContext((state.normalizedState['hops'] as PoolLink[])[0]!.pool),
    ).toBe(state.identity.tokenMint);
    expect(quoteRecordedRoute(loaded, 1_000_000n, true).output).toBeGreaterThan(0n);
  });
  it.each([0, 1, 2])(
    'matches SDK BUY, SELL, fees and partial SELL for curve %s',
    async (curveType) => {
      const state = directLaunchlab(),
        accounts = state.normalizedState['accounts'] as Record<string, CapturedAccount>;
      const hop = (state.normalizedState['hops'] as PoolLink[])[0]!;
      const configData = Buffer.from(accounts[hop.config!]!.base64, 'base64');
      const config = LaunchpadConfig.decode(configData);
      config.curveType = curveType;
      LaunchpadConfig.encode(config, configData);
      accounts[hop.config!] = { ...accounts[hop.config!]!, base64: configData.toString('base64') };
      const platformData = Buffer.from(accounts[hop.platform!]!.base64, 'base64');
      const platformFees = PlatformConfig.decode(platformData);
      platformFees.creatorFeeRate = new BN(1000);
      PlatformConfig.encode(platformFees, platformData);
      accounts[hop.platform!] = {
        ...accounts[hop.platform!]!,
        base64: platformData.toString('base64'),
      };
      if (curveType === 2)
        mutateLaunchPool(state, (p) => {
          p.virtualA = new BN(1000000);
          p.realA = new BN('1000000000000');
          const denominator = new BN(2).mul(new BN(2).pow(new BN(64)));
          p.realB = p.virtualA
            .mul(p.realA.pow(new BN(2)))
            .add(denominator)
            .subn(1)
            .div(denominator);
        });
      const pool = LaunchpadPool.decode(Buffer.from(accounts[hop.pool]!.base64, 'base64'));
      const platform = PlatformConfig.decode(
        Buffer.from(accounts[hop.platform!]!.base64, 'base64'),
      );
      const args = {
        poolInfo: pool,
        curveType,
        protocolFeeRate: config.tradeFeeRate,
        platformFeeRate: platform.feeRate,
        creatorFeeRate: platform.creatorFeeRate,
        shareFeeRate: new BN(0),
        transferFeeConfigA: undefined,
        slot: 0,
      };
      const buy = quoteRecordedRoute(state, 1_000_000n, true);
      const expectedBuy = Curve.buyExactIn({ ...args, amountB: new BN(1_000_000) });
      const transferBuy = buy.fees
        .filter((f) => f.category === 'TOKEN_TRANSFER_FEE')
        .reduce((s, f) => s + f.amount.amount, 0n);
      expect(buy.output + transferBuy).toBe(BigInt(expectedBuy.amountA.amount.toString()));
      const quantity = buy.output / 2n;
      const sold = quoteRecordedRoute(state, quantity, false);
      const inputFee = sold.fees
        .filter((f) => f.category === 'TOKEN_TRANSFER_FEE')
        .reduce((s, f) => s + f.amount.amount, 0n);
      const expectedSell = Curve.sellExactIn({
        ...args,
        amountA: new BN((quantity - inputFee).toString()),
      });
      expect(sold.output).toBe(BigInt(expectedSell.amountB.toString()));
      expect(
        sold.fees
          .filter((f) => f.category !== 'TOKEN_TRANSFER_FEE')
          .every((f) => f.amount.asset === 'PAPER_SOL'),
      ).toBe(true);
      expect(sold.fees.some((f) => f.category === 'PLATFORM_FEE')).toBe(true);
      expect(sold.fees.some((f) => f.category === 'CREATOR_FEE')).toBe(true);
      expect(quoteRecordedRoute(state, quantity, false)).toEqual(sold);
    },
  );
  it('exposes exact full, partial and maximum executable exit with truthful real-reserve bounds', async () => {
    const state = recordedLaunchlab();
    const adapter = new SolanaRouteAdapter({
      async loadMarketState() {
        return state;
      },
    });
    const router = new ExecutionRouter([adapter]);
    const quantity = 0xffffffffffffffffn;
    const result = await exitPreflight(router, state.identity, quantity, 1_000_000n);
    expect(result.status).toBe('LIQUIDITY_LIMITED');
    const max = result.maxExecutableQuantityBaseUnits;
    expect(max).toBeGreaterThan(0n);
    expect(quoteRecordedRoute(state, max, false).output).toBe(result.maxExecutableOutputLamports);
    expect(() => quoteRecordedRoute(state, max + 1n, false)).toThrow('LAUNCHLAB_QUOTE_FAILED');
    expect(
      await adapter.maxExecutableSellQuantity(
        { identity: state.identity, tokenQuantity: tokenBaseUnits(1n) },
        state,
      ),
    ).toBe(0n);
  });
  it('reports migration/invalid state explicitly and preserves migrated composed routes', async () => {
    const active = directLaunchlab();
    for (const [status, stage] of [
      [1, 'LAUNCHLAB_MIGRATING'],
      [3, 'LAUNCHLAB_STATE_UNAVAILABLE'],
    ] as const) {
      const state = structuredClone(active);
      mutateLaunchPool(state, (p) => {
        p.status = status;
      });
      const source = new SolanaRouteSource(rpcFor(state), {
        async pools() {
          throw Error('Must not discover');
        },
        async context() {
          return [];
        },
      });
      await expect(source.loadMarketState(state.identity)).rejects.toThrow(stage);
    }
    const migrated = migratedLaunchlab();
    const state = structuredClone(active);
    mutateLaunchPool(state, (p) => {
      p.status = 2;
    });
    const accounts = state.normalizedState['accounts'] as Record<string, CapturedAccount>;
    Object.assign(accounts, migrated.normalizedState['accounts']);
    const hops = migrated.normalizedState['hops'] as PoolLink[];
    const source = new SolanaRouteSource(rpcFor(state), {
      async pools(mint) {
        return hops.filter((h) => h.mintA === mint || h.mintB === mint).map((h) => h.pool);
      },
      async context() {
        return [];
      },
    });
    const resolved = await source.loadMarketState(state.identity);
    expect(
      (resolved.normalizedState['hops'] as PoolLink[]).every(
        (h) => h.program !== (state.normalizedState['hops'] as PoolLink[])[0]!.program,
      ),
    ).toBe(true);
    expect(quoteRecordedRoute(resolved, 1_000_000n, true).output).toBeGreaterThan(0n);
    const missing = new SolanaRouteSource(rpcFor(state), {
      async pools() {
        return [];
      },
      async context() {
        return [];
      },
    });
    await expect(missing.loadMarketState(state.identity)).rejects.toThrow(
      'MIGRATED_ROUTE_UNAVAILABLE',
    );
  });
  it('uses the real remaining-sale cap and records actual spent input without changing the snapshot', () => {
    const state = directLaunchlab();
    mutateLaunchPool(state, (p) => {
      p.totalSellA = p.realA.add(new BN(100000));
    });
    const before = createMarketStateEvidence(state).fingerprint;
    const q = quoteRecordedRoute(state, 1_000_000n, true);
    expect(q.consumedInput).toBeLessThan(1_000_000n);
    expect(q.output).toBeLessThanOrEqual(100000n);
    expect(createMarketStateEvidence(state).fingerprint).toBe(before);
  });
});
