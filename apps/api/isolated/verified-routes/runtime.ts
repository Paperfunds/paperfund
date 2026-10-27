/** Source-only integration. No production import, listener, provider, ENTRY grant or schema installer. */
import { paperSolBaseUnits, identifier } from '@paperfund/core';
import { ExecutionRouter, ExecutionEngineError, type MarketIdentity } from '@paperfund/execution';
import type { LinkedStateStore } from '../../../../packages/db/isolated/linked-pair/store.js';
import { linkedCandidateRuntime } from '../../../../packages/db/isolated/linked-pair/store.js';
import {
  linkedBindings,
  linkedRoute,
} from '../../../../packages/protocols/isolated/linked-pair/shared-bridge.js';
import { transitionLinkedSnapshot } from '../../../../packages/protocols/isolated/linked-pair/native-transition.js';
import {
  reconcileLinkedInterval,
  copyProviderInterval,
} from '../../../../packages/protocols/isolated/linked-pair/external-flow.js';
import { genericPumpSwapIdentity } from '../../../../packages/protocols/src/generic-pump-swap.js';
import { supportedLinkedExit } from '../../../../packages/protocols/isolated/linked-pair/supported-exit.js';
import { CompetitionService, type PositionValuation } from '../../src/competition.js';
import type { Stage1Snapshot } from '../../../../packages/protocols/src/experimental/non-sol-pump-swap.js';

export async function verifiedRouteRuntime(
  store: LinkedStateStore,
  options: Parameters<typeof linkedCandidateRuntime>[2],
) {
  const name = (await store.db.pool.query('select current_database() name')).rows[0]?.name;
  if (!/^paperfund_linked_test_[a-z0-9_]+$/.test(String(name)))
    throw Error('VERIFIED_DISPOSABLE_DATABASE_REQUIRED');
  return createLinkedRouteRuntime(store, options);
}
/** Shared source composition; no bootstrap, schema installation or permissions are implied. */
export async function createLinkedRouteRuntime(
  store: LinkedStateStore,
  options: Parameters<typeof linkedCandidateRuntime>[2],
) {
  const select = async (mint: string, root: Stage1Snapshot): Promise<MarketIdentity> => {
    await store.assertAvailable();
    const candidates = linkedBindings(root)
      .filter((r) => r.mint === mint)
      .sort((a, b) => a.bridgePool.localeCompare(b.bridgePool));
    let best: { identity: MarketIdentity; output: bigint } | undefined;
    const failures: string[] = [];
    const valid: MarketIdentity[] = [];
    for (const binding of candidates) {
      const snapshot = linkedRoute(root, mint, binding.bridgePool);
      const identity = genericPumpSwapIdentity(binding.mint, binding.quoteMint, binding.bridgePool);
      try {
        const q = await transitionLinkedSnapshot(snapshot, 10000000n, true, {
          nowMs: Date.parse(snapshot.observedAt),
          maxAgeMs: 10000,
        });
        const reverse = await transitionLinkedSnapshot(q.next, q.quote.output, false, {
          nowMs: Date.parse(snapshot.observedAt),
          maxAgeMs: 10000,
        });
        if (reverse.quote.output > 0n) {
          valid.push(identity);
          if (!best || reverse.quote.output > best.output)
            best = { identity, output: reverse.quote.output };
        }
      } catch (error) {
        failures.push(error instanceof Error ? error.message : 'UNSUPPORTED');
      }
    }
    if (!best)
      throw new ExecutionEngineError(
        'POSITION_EXECUTION_ROUTE_UNAVAILABLE',
        'VERIFIED_EXECUTABLE_ROUTE_REQUIRED:' + failures.join(','),
      );
    if (options.selectRoute) {
      const preferred = await options.selectRoute(mint, root);
      if (
        !valid.some(
          (v) =>
            v.marketId === preferred.marketId &&
            v.protocolId === preferred.protocolId &&
            v.tokenMint === preferred.tokenMint,
        )
      )
        throw new ExecutionEngineError(
          'POSITION_EXECUTION_ROUTE_UNAVAILABLE',
          'VERIFIED_SELECTION_NOT_EXECUTABLE',
        );
      return preferred;
    }
    return best.identity;
  };
  const runtime = linkedCandidateRuntime(store.db, store, { ...options, selectRoute: select });
  const router = new ExecutionRouter([runtime.adapter]);
  // Discovery selects only admitted native routes from an already reconciled carried branch.
  const resolve = async (mint: string) => {
    await store.assertAvailable();
    const head = await store.load();
    const seal = await store.cutoff();
    let branch = seal ? await store.sealedBranch(head, seal) : head.document;
    if (!seal) {
      const supplied = await options.interval(head.document.real);
      const interval = supplied ? copyProviderInterval(supplied) : null;
      if (interval) {
        try {
          branch = (await reconcileLinkedInterval(head.document, interval, options.now(), 10000))
            .branch;
        } catch (error) {
          await store.quarantine(interval, error);
          throw error;
        }
      }
    }
    if (
      !seal &&
      (options.now() < Date.parse(branch.real.observedAt) ||
        options.now() - Date.parse(branch.real.observedAt) > 10000)
    )
      throw new ExecutionEngineError('MARKET_STATE_UNAVAILABLE', 'LINKED_FRESHNESS_UNAVAILABLE');
    return select(mint, branch.simulated);
  };
  router.mintResolver = resolve;
  router.canonicalResolver = async (originIdentity) => ({
    originIdentity,
    executionIdentity: await resolve(originIdentity.tokenMint),
    migrated: false,
  });
  class Competition extends CompetitionService {
    override async getPositions(userId: string, signal?: AbortSignal) {
      const result = await super.getPositions(userId, signal);
      if (!result) return result;
      const account = await this.getCurrentAccount(userId);
      if (!account || account.id !== store.accountId) throw Error('VERIFIED_ACCOUNT_SCOPE');
      const values = await runtime.database.valueMarketPortfolio!(
        account.positions.map((p) => ({
          positionId: p.id,
          identity: {
            protocolId: identifier(p.venue, 'ProtocolId'),
            marketId: identifier(p.market_id, 'MarketId'),
            tokenMint: identifier(p.mint_address, 'TokenMint'),
          },
          quantity: BigInt(p.remaining_base_units),
        })),
      );
      const positions: typeof result.positions = await Promise.all(
        result.positions.map(async (position) => {
          const value = values.find((v) => v.positionId === position.id);
          if (!value) throw Error('VERIFIED_PORTFOLIO_POSITION_MISMATCH');
          const snapshot = value.evidence.normalizedState[
            'stage1Snapshot'
          ] as unknown as Stage1Snapshot;
          const quote = await supportedLinkedExit(snapshot, BigInt(position.remaining_base_units));
          if (quote.output !== value.value) throw Error('VERIFIED_PORTFOLIO_VALUE_CHANGED');
          const valuation: PositionValuation =
            quote.quantity === BigInt(position.remaining_base_units)
              ? {
                  status: 'AVAILABLE',
                  executablePaperSolLamports: value.value,
                  unrealizedPnlLamports: value.value - BigInt(position.cost_basis_lamports),
                  currentProtocol: value.evidence.identity.protocolId,
                  evidenceFingerprint: value.evidence.fingerprint,
                  observedAt: value.evidence.observedAt,
                  chainSlot: value.evidence.chainSlot,
                  valuedAt: this.now(),
                }
              : {
                  status: 'UNAVAILABLE',
                  reason: 'INSUFFICIENT_EXECUTABLE_LIQUIDITY',
                  valuedAt: this.now(),
                };
          return {
            ...position,
            valuation,
            ...(position.sellPreflight
              ? {
                  sellPreflight: {
                    ...position.sellPreflight,
                    maxExecutableQuantityBaseUnits: quote.quantity,
                    maxExecutableOutputLamports: value.value,
                  },
                }
              : {}),
          };
        }),
      );
      const available = positions.every((p) => p.valuation.status === 'AVAILABLE');
      const total = values.reduce((n, p) => n + p.value, 0n),
        cash = BigInt(account.paper_sol_balance_lamports);
      return {
        ...result,
        positions,
        valuationStatus: available ? ('AVAILABLE' as const) : ('UNAVAILABLE' as const),
        equityValuationStatus: available ? ('FULL' as const) : ('PARTIAL_LIQUIDITY' as const),
        executablePositionsLamports: total,
        portfolioEquityLamports: cash + total,
        livePnlLamports: cash + total - BigInt(account.starting_paper_sol_lamports),
      };
    }
    override async buyPreflight(userId: string, mint: string, signal?: AbortSignal) {
      const result = await super.buyPreflight(userId, mint, signal);
      const portfolio = await this.getPositions(userId, signal);
      if (!portfolio || portfolio.portfolioEquityLamports === null) return result;
      const ratio = (portfolio.portfolioEquityLamports * BigInt(result.maxBuyRatioBps)) / 10000n;
      return {
        ...result,
        valuationStatus: portfolio.valuationStatus,
        equityValuationStatus: portfolio.equityValuationStatus,
        executablePositionsLamports: portfolio.executablePositionsLamports,
        portfolioEquityLamports: paperSolBaseUnits(portfolio.portfolioEquityLamports),
        maxBuyByRatioLamports: paperSolBaseUnits(ratio),
        maxBuyLamports: paperSolBaseUnits(
          ratio < result.cashLamports ? ratio : result.cashLamports,
        ),
      };
    }
  }
  const competition = new Competition(
    runtime.database,
    router,
    () => new Date(options.now()),
    undefined,
    { lookup: async () => ({ status: 'UNAVAILABLE', reason: 'ISOLATED_DISPLAY_FX_DISABLED' }) },
  );
  return { ...runtime, router, competition, deploymentEnabled: false as const };
}
