import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { identifier, paperSolBaseUnits, tokenBaseUnits, utcInstant } from '@paperfund/core';
import { ExecutionRouter, type MarketState } from '@paperfund/execution';
import { type SolanaRpcClient, PUMP_FUN_PROTOCOL_ID } from '../src/pump-fun.js';
import {
  SolanaRouteAdapter,
  SolanaRouteSource,
  installSolanaMintResolver,
  quoteRecordedRoute,
  type CapturedAccount,
  type PoolLink,
} from '../src/solana-routes.js';

function snapshot(): MarketState {
  const raw = JSON.parse(
    readFileSync(new URL('./fixtures/operator-pump-orca.json', import.meta.url), 'utf8'),
  );
  return { ...raw, chainSlot: BigInt(raw.chainSlot) } as MarketState;
}

describe('operator non-SOL Pump / Orca route', () => {
  it('replays a 1 SOL BUY and reverse valuation with identical route engine, fees and snapshot', async () => {
    const state = snapshot();
    const router = new ExecutionRouter([
      new SolanaRouteAdapter({
        async loadMarketState() {
          return state;
        },
      }),
    ]);
    const { adapter } = await router.loadPositionRoute(state.identity);
    const buy = await adapter.simulateBuy(
      {
        identity: state.identity,
        orderId: identifier('operator-buy', 'OrderId'),
        executionId: identifier('operator-fill', 'ExecutionId'),
        executedAt: utcInstant('2026-10-01T20:00:00Z'),
        requestedPaperSol: paperSolBaseUnits(1_000_000_000n),
      },
      state,
    );
    const value = await adapter.valuePositionForExit(
      { identity: state.identity, tokenQuantity: tokenBaseUnits(buy.actualOutput.amount) },
      state,
    );
    expect(value.paperSolValue).toBeGreaterThan(900_000_000n);
    expect(value.paperSolValue).toBeLessThan(1_000_000_000n);
    expect(value.paperSolValue).toBe(
      quoteRecordedRoute(state, buy.actualOutput.amount, false).output,
    );
    expect(value.marketStateFingerprint).toBe(buy.quote.marketStateFingerprint);
    expect(buy.executionDetails?.['canonicalRoute']).toMatchObject({
      chainSlot: state.chainSlot!.toString(),
      routeHash: expect.any(String),
    });
    expect(buy.quote.fees.map((f) => f.category)).toContain('PROTOCOL_FEE');
    expect(buy.quote.fees.map((f) => f.category)).toContain('AMM_TRADE_FEE');
  });
  it('loads the active non-SOL Pump route through the same canonical service for old and new origins', async () => {
    const state = snapshot();
    const accounts = state.normalizedState['accounts'] as Record<string, CapturedAccount>;
    const hops = state.normalizedState['hops'] as PoolLink[];
    let slot = Number(state.chainSlot);
    const rpc = {
      async getMultipleAccounts(addresses: readonly string[]) {
        return {
          context: { slot: ++slot },
          value: addresses.map((a) =>
            accounts[a]
              ? { owner: accounts[a]!.owner, data: [accounts[a]!.base64, 'base64'] as const }
              : null,
          ),
        };
      },
    } as SolanaRpcClient;
    const source = new SolanaRouteSource(rpc, {
      async pools() {
        return (state.normalizedState['candidateRoutes'] as PoolLink[][]).map(
          (path) => path[1]!.pool,
        );
      },
      async context() {
        return [];
      },
    });
    const router = new ExecutionRouter([new SolanaRouteAdapter(source)]);
    installSolanaMintResolver(router, source);
    const identity = await router.mintResolver!(state.identity.tokenMint);
    expect(identity).toEqual(state.identity);
    const first = await router.loadPositionRoute(identity);
    const old = {
      protocolId: PUMP_FUN_PROTOCOL_ID,
      marketId: identifier(hops[0]!.pool, 'MarketId'),
      tokenMint: identity.tokenMint,
    };
    const second = await router.loadPositionRoute(old);
    expect(second.route.originIdentity).toEqual(old);
    expect(second.route.executionIdentity).toEqual(first.route.executionIdentity);
    expect(second.state.chainSlot).toBeGreaterThan(first.state.chainSlot!);
    const buy = quoteRecordedRoute(first.state, 1_000_000_000n, true);
    expect(quoteRecordedRoute(second.state, buy.output, false).output).toBeGreaterThan(
      900_000_000n,
    );
    delete accounts[hops[0]!.platform!];
    await expect(router.loadPositionRoute(old)).rejects.toThrow('Missing recorded account');
  });
  it('fails closed on missing fee config, vault or uncaptured tick state', () => {
    const initial = snapshot();
    const hops = initial.normalizedState['hops'] as unknown as PoolLink[];
    for (const address of [hops[0]!.platform!, hops[0]!.vaultB]) {
      const state = snapshot();
      delete (state.normalizedState['accounts'] as Record<string, CapturedAccount>)[address];
      expect(() => quoteRecordedRoute(state, 1_000_000_000n, true)).toThrow();
    }
    const state = snapshot();
    // A null account actually recorded by RPC is different from an omitted account.
    (state.normalizedState as Record<string, unknown>)['candidateRoutes'] = [hops];
    const tick = hops[1]!.extraAccounts![0]!;
    delete (state.normalizedState['accounts'] as Record<string, CapturedAccount>)[tick];
    (state.normalizedState as Record<string, unknown>)['absentAccounts'] = [];
    expect(() => quoteRecordedRoute(state, 1_000_000_000n, true)).toThrow();
  });
  it('evaluates alternate candidates using the actual amount and never turns invalid paths into zero', () => {
    const state = snapshot();
    const hops = state.normalizedState['hops'];
    const routes = state.normalizedState['candidateRoutes'] as unknown[];
    (state.normalizedState as Record<string, unknown>)['candidateRoutes'] = [
      [{ ...(hops as Array<Record<string, string>>)[0], pool: 'missing-pool' }],
      ...routes,
    ];
    expect(quoteRecordedRoute(state, 1_000_000_000n, true).output).toBeGreaterThan(0n);
    (state.normalizedState as Record<string, unknown>)['candidateRoutes'] = [
      [{ ...(hops as Array<Record<string, string>>)[0], pool: 'missing-pool' }],
    ];
    expect(() => quoteRecordedRoute(state, 1_000_000_000n, true)).toThrow();
  });
});
