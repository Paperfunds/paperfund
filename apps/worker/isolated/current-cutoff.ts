/** Staged composition for the existing worker lifecycle; no listener, signer or activation. */
import type { DatabaseService } from '../../../packages/db/src/database.js';
import { CurrentQuoteSettlement } from '../../../packages/db/src/current-quote-settlement.js';
import { runHourlyLifecycleTick } from '../../../packages/db/src/competition-service.js';
import {
  captureCutoffState,
  type CutoffHeader,
} from '../../../packages/protocols/src/cutoff-capture.js';
import type { ExecutionRouter, MarketIdentity } from '@paperfund/execution';
import type { ReadOnlyRpc } from '../../api/isolated/verified-routes/finalized-connector.js';
import { currentQuoteRouter } from '../../api/isolated/current-quotes/router.js';
import { genericActor } from '../../../packages/protocols/src/generic-access-context.js';
import type { Stage1Snapshot } from '../../../packages/protocols/src/experimental/non-sol-pump-swap.js';
/** Reuses the published API's current-quote adapter and owner-scoped peak schedule. */
export function composePublicCurrentCutoffWorker(
  database: DatabaseService,
  baseline: ExecutionRouter,
  policyId: string,
  rpc: ReadOnlyRpc,
  snapshots: (mint: string) => Promise<Stage1Snapshot[]>,
) {
  const mints = ['__WORKER_CAPTURE_DYNAMIC__'];
  const account = () => {
    const id = genericActor()?.accountId;
    if (!id) throw Error('CUTOFF_ACCOUNT_SCOPE_REQUIRED');
    return id;
  };
  const current = currentQuoteRouter({
    enabled: true,
    baseline,
    mints,
    snapshots,
    permission: async () => ({ discover: true, buy: false }),
    peakQuantity: async (mint) => {
      const r = await database.pool.query(
        `with q as(select sum(case when f.side='BUY' then f.base_quantity else -f.base_quantity end) over(order by f.executed_at,f.id rows unbounded preceding) n from fills f join orders o on o.id=f.order_id join markets m on m.id=f.market_id join assets b on b.id=m.base_asset_id where o.competition_account_id=$1 and b.mint_address=$2)select coalesce(max(n),0)::text n from q`,
        [account(), mint],
      );
      return BigInt(r.rows[0].n);
    },
    priorReference: async (mint) => {
      const r = await database.pool.query(
        `select e.chain_slot,e.normalized_state->>'referenceBuyOutput' output from market_state_evidence e where e.adapter_version='paper-current-executable-v1' and e.normalized_state->'stage1Snapshot'->>'mint'=$1 and exists(select 1 from fills f join orders o on o.id=f.order_id where f.market_state_evidence_id=e.id and o.competition_account_id=$2) order by e.created_at desc limit 1`,
        [mint, account()],
      );
      return r.rows[0] ? { slot: Number(r.rows[0].chain_slot), output: r.rows[0].output } : null;
    },
  });
  return composeCurrentCutoffWorker(database, current.router, policyId, rpc, async (identity) => {
    if (!String(identity.marketId).startsWith('paper-current-quote:'))
      return baseline.loadPositionRoute(identity);
    if (!mints.includes(identity.tokenMint)) mints.push(identity.tokenMint);
    const candidates = await snapshots(identity.tokenMint);
    if (candidates.length) return current.router.loadPositionRoute(identity);
    const migrated = await baseline.mintResolver!(identity.tokenMint),
      loaded = await baseline.loadPositionRoute(migrated);
    return { ...loaded, route: { ...loaded.route, originIdentity: identity, migrated: true } };
  });
}
export function composeCurrentCutoffWorker(
  database: DatabaseService,
  router: ExecutionRouter,
  policyId: string,
  rpc: ReadOnlyRpc,
  load?: (
    identity: MarketIdentity,
    accountId: string,
  ) => ReturnType<ExecutionRouter['loadPositionRoute']>,
) {
  const headers = new Map<number, CutoffHeader>();
  const settlement = new CurrentQuoteSettlement(database, router, policyId, {
    capture: async (identity, account) => {
      const p = (
        await database.pool.query(
          'select to_jsonb(p) policy from current_quote_settlement_policies p where id=$1',
          [policyId],
        )
      ).rows[0]?.policy;
      if (p?.selection_version === 'DURABLE_QUOTE_V2' && p.provider_id !== rpc.providerIdentity)
        throw Error('CUTOFF_PROVIDER_BINDING');
      return captureCutoffState(
        async () =>
          (await (load ? load(identity, account) : router.loadPositionRoute(identity))).state,
        p?.selection_version === 'DURABLE_QUOTE_V2' ? 'confirmed' : 'finalized',
      );
    },
    async finality(slot) {
      const h = await rpc.call<Omit<CutoffHeader, 'slot'>>('getBlock', [
        slot,
        {
          commitment: 'finalized',
          transactionDetails: 'none',
          rewards: false,
          maxSupportedTransactionVersion: 0,
        },
      ]);
      if (!h) throw Error('CUTOFF_ORIGINAL_SLOT_NOT_FINAL');
      return { ...h, slot };
    },
    async frontier(slot) {
      const slots = await rpc.call<number[]>('getBlocks', [
        slot,
        slot + 32,
        { commitment: 'finalized' },
      ]);
      if (!Array.isArray(slots) || slots[0] !== slot) throw Error('CUTOFF_HEADER_UNAVAILABLE');
      for (const s of slots.slice(0, 2))
        if (!headers.has(s)) {
          const h = await rpc.call<Omit<CutoffHeader, 'slot'>>('getBlock', [
            s,
            {
              commitment: 'finalized',
              transactionDetails: 'none',
              rewards: false,
              maxSupportedTransactionVersion: 0,
            },
          ]);
          if (!h) throw Error('CUTOFF_HEADER_UNAVAILABLE');
          headers.set(s, { ...h, slot: s });
        }
      if (headers.size > 256) headers.delete(headers.keys().next().value!);
      const last = headers.get(slot),
        next = headers.get(slots[1]!);
      if (!last || !next) throw Error('CUTOFF_ADJACENT_HEADER_REQUIRED');
      return { last, next };
    },
  });
  const db = settlement.database();
  return {
    database: db,
    router,
    settlement,
    capture: (now: Date) => settlement.captureDue(now),
    lifecycle: (now: Date, grace = 60) => runHourlyLifecycleTick(db, router, now, grace),
  };
}
