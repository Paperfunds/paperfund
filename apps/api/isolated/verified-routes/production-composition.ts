/** Restricted source composition. Never imported by main.ts; constructing it grants no permission. */
import { paperSolBaseUnits, identifier, type ProtocolId } from '@paperfund/core';
import {
  ExecutionRouter,
  ExecutionEngineError,
  canonicalExitPreflight,
  type MarketIdentity,
  type MarketState,
  type ProtocolAdapter,
} from '@paperfund/execution';
import type { DatabaseService } from '../../../../packages/db/src/database.js';
import { settleHourlyRound } from '../../../../packages/db/src/financial-service.js';
import { LinkedStateStore } from '../../../../packages/db/isolated/linked-pair/store.js';
import {
  genericActor,
  withGenericActor,
  withGenericAccount,
  type GenericPermission,
} from '../../../../packages/protocols/src/generic-access-context.js';
import { linkedBindings } from '../../../../packages/protocols/isolated/linked-pair/shared-bridge.js';
import { supportedLinkedExit } from '../../../../packages/protocols/isolated/linked-pair/supported-exit.js';
import {
  SPL_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from '../../../../packages/protocols/src/pump-fun.js';
import type { Stage1Snapshot } from '../../../../packages/protocols/src/experimental/non-sol-pump-swap.js';
import { CompetitionService, type PositionValuation } from '../../src/competition.js';
import { createLinkedRouteRuntime } from './runtime.js';
import type { FinalizedFlowConnector } from './finalized-connector.js';
const fail = (m: string): never => {
  throw new ExecutionEngineError('MARKET_STATE_UNAVAILABLE', 'SCOPED_LINKED_' + m);
};
export interface LinkedProductionScope {
  accountId: string;
  userId: string;
  roundId: string;
  mints: readonly string[];
  approvalReference: string;
  mode: 'EXIT_ONLY' | 'ENTRY';
  /** Operator-owned review hold; never falls through to an ordinary snapshot. */
  paused?: boolean;
  connector: FinalizedFlowConnector;
  durableFlow?: boolean;
  /** Separately approved append-only recovery; defaults off. Never grants ENTRY. */
  proofRecovery?: boolean;
}
export interface ScopedProductionOptions {
  database: DatabaseService;
  baselineRouter: ExecutionRouter;
  scopes: readonly LinkedProductionScope[];
  now?: () => number;
  resolvePermission: (
    mint: string,
    quote: string,
    settlement: boolean,
  ) => Promise<GenericPermission>;
  competitionOptions?: {
    rewardConfig?: ConstructorParameters<typeof CompetitionService>[3];
    chartFx?: ConstructorParameters<typeof CompetitionService>[4];
    advisoryLimits?: ConstructorParameters<typeof CompetitionService>[5];
    genericArmed?: boolean;
  };
}
export async function composeScopedProduction(options: ScopedProductionOptions) {
  const base = options.database,
    baseline = options.baselineRouter,
    now = options.now ?? Date.now;
  type Bound = {
    scope: LinkedProductionScope;
    store: LinkedStateStore;
    runtime: Awaited<ReturnType<typeof createLinkedRouteRuntime>>;
    reserved: Set<string>;
  };
  const scopes = new Map<string, Bound>();
  for (const supplied of options.scopes) {
    const scope = Object.freeze({ ...supplied, mints: Object.freeze([...supplied.mints]) });
    if (
      !scope.approvalReference ||
      !['EXIT_ONLY', 'ENTRY'].includes(scope.mode) ||
      scopes.has(scope.accountId) ||
      !scope.mints.length ||
      new Set(scope.mints).size !== scope.mints.length
    )
      fail('CONFIGURATION');
    const owner = (
      await base.pool.query<{ user_id: string; hourly_round_id: string }>(
        'select user_id,hourly_round_id from competition_accounts where id=$1',
        [scope.accountId],
      )
    ).rows[0];
    if (owner?.user_id !== scope.userId || owner.hourly_round_id !== scope.roundId)
      fail('ACCOUNT_OWNER');
    const store = new LinkedStateStore(
        base,
        scope.accountId,
        scope.roundId,
        scope.durableFlow === true,
        scope.proofRecovery === true,
      ),
      head = await store.load();
    const mints = new Set(linkedBindings(head.document.real).map((r) => r.mint));
    if (mints.size !== scope.mints.length || scope.mints.some((m) => !mints.has(m)))
      fail('DISCOVERY_SCOPE');
    await store.recover();
    const runtime = await createLinkedRouteRuntime(store, {
      now,
      interval: async (anchor) => {
        if (!scope.durableFlow) return scope.connector.interval(anchor);
        const age = now() - Date.parse(anchor.observedAt);
        if (!Number.isFinite(age) || age < 0 || age > 10000) fail('FLOW_CATCHING_UP');
        return null; // Only a durably reconciled frontier is served; never catch up in a request.
      },
      cutoffFrontier: (anchor, cutoff) => scope.connector.cutoffFrontier(anchor, cutoff),
      permission: async (identity) => {
        if (scope.paused) fail('OPERATOR_REVIEW_HOLD');
        const binding = linkedBindings((await store.load()).document.real).find(
          (r) => r.mint === identity.tokenMint && identity.marketId.endsWith(r.bridgePool),
        );
        if (!binding) fail('UNADMITTED_BINDING');
        const sealed = !!(await store.cutoff());
        return withGenericAccount(scope.accountId, async () => {
          const permission = await options.resolvePermission(
            binding!.mint,
            binding!.quoteMint,
            sealed,
          );
          if (
            permission.exitBinding &&
            (permission.exitBinding.targetPool !== binding!.targetPool ||
              permission.exitBinding.quoteMint !== binding!.quoteMint)
          )
            fail('EXIT_ORIGIN_CHANGED');
          return {
            ...permission,
            buy: scope.mode === 'ENTRY' && permission.buy,
            ...(permission.exitBinding
              ? { exitBinding: { ...permission.exitBinding, bridgePool: binding!.bridgePool } }
              : {}),
            authorizeLive: async (kind: 'BUY' | 'SELL') => {
              if (kind === 'BUY' && scope.mode !== 'ENTRY') fail('ENTRY_DISABLED');
              if (!permission.authorizeLive) fail('LIVE_AUTHORIZATION_REQUIRED');
              await permission.authorizeLive!(kind);
            },
          };
        });
      },
    });
    const reserved = new Set(
      Object.entries(head.document.real.accounts)
        .filter(([, a]) => {
          const len = Buffer.from(a.base64, 'base64').length;
          return (
            ([SPL_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID].includes(a.owner) && len >= 165) ||
            ([287, 300, 301, 166, 653, 9988].includes(len) &&
              ![SPL_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID].includes(a.owner))
          );
        })
        .map(([address]) => address),
    );
    scopes.set(scope.accountId, { scope, store, runtime, reserved });
  }
  const forAccount = (id: string) => scopes.get(id);
  async function active(): Promise<Bound | undefined> {
    const actor = genericActor();
    if (actor?.accountId) return forAccount(actor.accountId);
    if (!actor?.userId) return undefined;
    const row = (
      await base.pool.query<{ id: string }>(
        'select ca.id from competition_accounts ca join hourly_rounds r on r.id=ca.hourly_round_id where ca.user_id=$1 and r.starts_at<=$2 and r.ends_at_exclusive>$2',
        [actor.userId, new Date(now())],
      )
    ).rows[0];
    return row ? forAccount(row.id) : undefined;
  }
  const owns = (b: Bound | undefined, mint: string) => !!b?.scope.mints.includes(mint);
  function assertIndependent(b: Bound | undefined, state: MarketState) {
    if (!b) return;
    const seen = new Set<string>();
    const visit = (v: unknown): void => {
      if (typeof v === 'string') seen.add(v);
      else if (Array.isArray(v)) v.forEach(visit);
      else if (v && typeof v === 'object')
        for (const [k, x] of Object.entries(v)) {
          seen.add(k);
          visit(x);
        }
    };
    visit(state.normalizedState);
    visit(state.rawSource);
    if ([...b.reserved].some((a) => seen.has(a))) fail('UNTRACKED_SHARED_LIQUIDITY');
    // Every ordinary composed path must expose its retained native snapshot/dependencies.
    if (
      !['PUMP_FUN_BONDING_CURVE', 'PUMP_SWAP_CANONICAL_POOL', 'SOLANA_COMPOSED_ROUTE'].includes(
        String(state.normalizedState['model']),
      )
    )
      fail('ORDINARY_DEPENDENCY_EVIDENCE_REQUIRED');
  }
  const first = [...scopes.values()][0];
  const versionAdapter = first
    ? new Proxy(first.runtime.adapter as ProtocolAdapter, {
        get(target, key) {
          const value = Reflect.get(target, key);
          if (typeof value !== 'function') return value;
          return (...args: unknown[]) => {
            const state = args.at(-1) as MarketState | undefined,
              id = state?.normalizedState?.['linkedAccountId'];
            const bound = typeof id === 'string' ? forAccount(id) : undefined;
            if (id === undefined) return value.apply(target, args); // Pure historical replay: no cursor/commit token can be created.
            if (!bound || state?.normalizedState['linkedRoundId'] !== bound.scope.roundId)
              fail('PINNED_ADAPTER_SCOPE');
            const fn = Reflect.get(bound!.runtime.adapter, key) as (...a: unknown[]) => unknown;
            return fn.apply(bound!.runtime.adapter, args);
          };
        },
      })
    : undefined;
  class Router extends ExecutionRouter {
    override async resolvePositionRoute(identity: MarketIdentity, settlement = false) {
      const b = await active();
      if (owns(b, identity.tokenMint) && !settlement)
        baseline.resolve(b!.runtime.adapter.protocolId);
      return owns(b, identity.tokenMint)
        ? b!.runtime.router.resolvePositionRoute(identity, settlement)
        : baseline.resolvePositionRoute(identity, settlement);
    }
    override async loadPositionRoute(identity: MarketIdentity, settlement = false) {
      const b = await active();
      if (owns(b, identity.tokenMint)) {
        if (!settlement) baseline.resolve(b!.runtime.adapter.protocolId);
        return b!.runtime.router.loadPositionRoute(identity, settlement);
      }
      const loaded = await baseline.loadPositionRoute(identity, settlement);
      assertIndependent(b, loaded.state);
      return loaded;
    }
    override resolve(id: ProtocolId) {
      return baseline.resolve(id);
    }
    override resolveForSettlement(id: ProtocolId) {
      return baseline.resolveForSettlement(id);
    }
    override resolveVersion(id: ProtocolId, version: string) {
      return first &&
        id === first.runtime.adapter.protocolId &&
        version === first.runtime.adapter.adapterVersion
        ? versionAdapter!
        : baseline.resolveVersion(id, version);
    }
    override setEnabled(id: ProtocolId, enabled: boolean) {
      baseline.setEnabled(id, enabled);
    }
    override isEnabled(id: ProtocolId) {
      return baseline.isEnabled(id);
    }
  }
  const router = new Router();
  if (baseline.diagnostic) router.diagnostic = baseline.diagnostic;
  router.mintResolver = async (mint) => {
    const b = await active();
    if (owns(b, mint)) baseline.resolve(b!.runtime.adapter.protocolId);
    return owns(b, mint)
      ? b!.runtime.router.mintResolver!(mint)
      : baseline.mintResolver
        ? baseline.mintResolver(mint)
        : fail('BASELINE_DISCOVERY_REQUIRED');
  };
  router.canonicalResolver = async (identity) =>
    (await router.resolvePositionRoute(identity)).route;
  if (baseline.contextResolver) router.contextResolver = baseline.contextResolver;
  if (baseline.chartMetadataResolver) router.chartMetadataResolver = baseline.chartMetadataResolver;
  const database: DatabaseService = {
    ...base,
    persistedSettlementAccount: (id, identity) =>
      owns(forAccount(id), identity.tokenMint) ||
      (base.persistedSettlementAccount?.(id, identity) ?? !!base.preparePersistedSettlementStep),
    lockMarketExecution: async (c, id) => {
      const b = forAccount(id);
      if (b) await b.runtime.database.lockMarketExecution!(c, id);
      else await base.lockMarketExecution?.(c, id);
    },
    commitMarketExecution: async (c, input) => {
      const b = forAccount(input.accountId),
        linked = input.execution.quote.adapterVersion === first?.runtime.adapter.adapterVersion;
      if (linked) {
        if (!b) fail('FILL_OUTSIDE_SCOPE');
        await b!.runtime.database.commitMarketExecution!(c, input);
      } else {
        if (b) {
          const s = (await storeState(b)).real;
          if (
            linkedBindings(s).some(
              (r) =>
                r.mint ===
                (input.execution.actualInput.asset === 'TOKEN'
                  ? input.execution.actualInput.tokenMint
                  : input.execution.actualOutput.asset === 'TOKEN'
                    ? input.execution.actualOutput.tokenMint
                    : ''),
            )
          )
            fail('LINKED_FILL_BYPASS');
        }
        await base.commitMarketExecution?.(c, input);
      }
    },
    valueMarketPortfolio: async (positions) => {
      const b = await active();
      if (!b && base.valueMarketPortfolio) return base.valueMarketPortfolio(positions);
      const tracked = positions.filter((p) => owns(b, p.identity.tokenMint));
      const native = b ? await b.runtime.database.valueMarketPortfolio!(tracked) : [];
      const results = [...native];
      for (const p of positions.filter((p) => !owns(b, p.identity.tokenMint))) {
        const q = await canonicalExitPreflight(router, p.identity, p.quantity, 0n);
        results.push({
          positionId: p.positionId,
          value: q.maxExecutableOutputLamports,
          evidence: q.evidence,
        });
      }
      return positions.map((p) => results.find((v) => v.positionId === p.positionId)!);
    },
    prepareMarketSettlement: async (round, cutoff) => {
      await base.prepareMarketSettlement?.(round, cutoff);
      for (const b of scopes.values())
        if (b.scope.roundId === round) {
          const open = await base.pool.query(
            "select 1 from positions p join assets a on a.id=p.asset_id where p.competition_account_id=$1 and p.status='OPEN' and a.mint_address=any($2::text[]) limit 1",
            [b.scope.accountId, b.scope.mints],
          );
          if (open.rowCount)
            await withGenericAccount(b.scope.accountId, () =>
              b.runtime.database.prepareMarketSettlement!(round, cutoff),
            );
        }
    },
    preparePersistedSettlementStep: async (input) => {
      const b = forAccount(input.accountId);
      return b
        ? b.runtime.database.preparePersistedSettlementStep!(input)
        : base.preparePersistedSettlementStep
          ? base.preparePersistedSettlementStep(input)
          : fail('UNSCOPED_PERSISTED_PLAN');
    },
    commitPersistedSettlementStep: async (c, input) => {
      const b = forAccount(input.accountId);
      if (b) await b.runtime.database.commitPersistedSettlementStep!(c, input);
      else if (base.commitPersistedSettlementStep)
        await base.commitPersistedSettlementStep(c, input);
      else fail('UNSCOPED_PERSISTED_COMMIT');
    },
    bindMarketSettlementEvidence: async (id, evidence) => {
      const b = forAccount(id);
      if (b && evidence.adapterVersion === b.runtime.adapter.adapterVersion)
        await b.runtime.database.bindMarketSettlementEvidence!(id, evidence);
      else await base.bindMarketSettlementEvidence?.(id, evidence);
    },
  };
  async function storeState(b: Bound) {
    return (await b.store.load()).document;
  }
  class Competition extends CompetitionService {
    override async getPositions(user: string, signal?: AbortSignal) {
      const b = await active();
      if (!b) return super.getPositions(user, signal);
      const result = await super.getPositions(user, signal);
      if (!result) return result;
      const account = await this.getCurrentAccount(user);
      if (account?.id !== b.scope.accountId) fail('PORTFOLIO_ACCOUNT');
      const values = await database.valueMarketPortfolio!(
        account!.positions.map((p) => ({
          positionId: p.id,
          identity: {
            protocolId: identifier(p.venue, 'ProtocolId'),
            marketId: identifier(p.market_id, 'MarketId'),
            tokenMint: identifier(p.mint_address, 'TokenMint'),
          },
          quantity: BigInt(p.remaining_base_units),
        })),
      );
      const positions = await Promise.all(
        result.positions.map(async (p) => {
          const v = values.find((v) => v.positionId === p.id);
          if (!v) fail('PORTFOLIO_INCOMPLETE');
          const s = v!.evidence.normalizedState['stage1Snapshot'] as unknown as
            Stage1Snapshot | undefined;
          if (!s) return p;
          const q = await supportedLinkedExit(s, BigInt(p.remaining_base_units));
          if (q.output !== v!.value) fail('PORTFOLIO_CHANGED');
          const valuation: PositionValuation =
            q.quantity === BigInt(p.remaining_base_units)
              ? {
                  status: 'AVAILABLE',
                  executablePaperSolLamports: v!.value,
                  unrealizedPnlLamports: v!.value - BigInt(p.cost_basis_lamports),
                  currentProtocol: v!.evidence.identity.protocolId,
                  evidenceFingerprint: v!.evidence.fingerprint,
                  observedAt: v!.evidence.observedAt,
                  chainSlot: v!.evidence.chainSlot,
                  valuedAt: this.now(),
                }
              : {
                  status: 'UNAVAILABLE',
                  reason: 'INSUFFICIENT_EXECUTABLE_LIQUIDITY',
                  valuedAt: this.now(),
                };
          return {
            ...p,
            valuation,
            ...(p.sellPreflight
              ? {
                  sellPreflight: {
                    ...p.sellPreflight,
                    maxExecutableQuantityBaseUnits: q.quantity,
                    maxExecutableOutputLamports: q.output,
                  },
                }
              : {}),
          };
        }),
      );
      const total = values.reduce((n, v) => n + v.value, 0n),
        equity = BigInt(account!.paper_sol_balance_lamports) + total,
        available = positions.every((p) => p.valuation.status === 'AVAILABLE');
      return {
        ...result,
        positions,
        valuationStatus: available ? ('AVAILABLE' as const) : ('UNAVAILABLE' as const),
        equityValuationStatus: available ? ('FULL' as const) : ('PARTIAL_LIQUIDITY' as const),
        executablePositionsLamports: total,
        portfolioEquityLamports: equity,
        livePnlLamports: equity - BigInt(account!.starting_paper_sol_lamports),
      };
    }
    override async buyPreflight(user: string, mint: string, signal?: AbortSignal) {
      const result = await super.buyPreflight(user, mint, signal);
      if (!(await active())) return result;
      const p = await this.getPositions(user, signal);
      if (!p || p.portfolioEquityLamports === null) return result;
      const ratio = (p.portfolioEquityLamports * BigInt(result.maxBuyRatioBps)) / 10000n;
      return {
        ...result,
        valuationStatus: p.valuationStatus,
        equityValuationStatus: p.equityValuationStatus,
        executablePositionsLamports: p.executablePositionsLamports,
        portfolioEquityLamports: paperSolBaseUnits(p.portfolioEquityLamports),
        maxBuyByRatioLamports: paperSolBaseUnits(ratio),
        maxBuyLamports: paperSolBaseUnits(
          ratio < result.cashLamports ? ratio : result.cashLamports,
        ),
      };
    }
  }
  const extra = options.competitionOptions;
  const service = new Competition(
    database,
    router,
    () => new Date(now()),
    extra?.rewardConfig,
    extra?.chartFx,
    extra?.advisoryLimits,
    extra?.genericArmed,
  );
  // Existing API supplies actor scope; explicit user methods also work for server callers/tests.
  const userMethods = new Set([
    'getCurrentAccount',
    'getPositions',
    'viewedPosition',
    'buyPreflight',
    'buy',
    'sell',
  ]);
  const competition = new Proxy(service, {
    get(target, key) {
      const v = Reflect.get(target, key);
      if (typeof v !== 'function') return v;
      return (...args: unknown[]) =>
        userMethods.has(String(key)) && !genericActor()?.userId
          ? withGenericActor(
              {
                userId: String(args[0]),
                intent: key === 'buy' ? 'BUY' : key === 'sell' ? 'SELL' : 'READ',
              },
              () => v.apply(target, args),
            )
          : v.apply(target, args);
    },
  });
  return {
    database,
    router,
    competition,
    scopes,
    settle: (roundId: string) =>
      settleHourlyRound(database, router, {
        hourlyRoundId: roundId,
        authoritativeTimestamp: new Date(now()),
      }),
    deploymentEnabled: false as const,
  };
}
