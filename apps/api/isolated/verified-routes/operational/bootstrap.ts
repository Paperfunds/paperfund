import { genericActor } from '../../../../../packages/protocols/src/generic-access-context.js';
import { ExecutionEngineError } from '@paperfund/execution';
import { qualifySuccessor } from './qualification.js';
import {FootprintFlowConnector} from '../footprint-acquisition.js';
import {digest} from '../../../../../packages/protocols/isolated/linked-pair/external-flow.js';
/** Operational wiring only. EXIT_ONLY is a compiled ceiling, never an environment ENTRY switch. */
import { readFile, mkdir, rename, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { createHash } from 'node:crypto';
import { createDatabase } from '../../../../../packages/db/src/database.js';
import type { DatabaseService } from '../../../../../packages/db/src/database.js';
import {
  GenericCapability,
  genericCapabilityOptions,
} from '../../../../../packages/db/src/generic-capability.js';
import { LinkedStateStore } from '../../../../../packages/db/isolated/linked-pair/store.js';
import { linkedBindings } from '../../../../../packages/protocols/isolated/linked-pair/shared-bridge.js';
import { createProductionExecutionRouter } from '../../../../../packages/protocols/src/production.js';
import { composeScopedProduction } from '../production-composition.js';
import {
  FinalizedBankArchive,
  FinalizedFlowConnector,
  FinalizedRpc,
  type ReadOnlyRpc,
} from '../finalized-connector.js';
import type { Stage1Snapshot } from '../../../../../packages/protocols/src/experimental/non-sol-pump-swap.js';
import type { parseApplicationEnvironment } from '@paperfund/config';
type Config = ReturnType<typeof parseApplicationEnvironment>;
const assert: (v: unknown, reason: string) => asserts v = (v, reason) => {
  if (!v) throw Error('MIXED_BOOTSTRAP_' + reason);
};
export interface ScopeDocument {
  schema: 'PAPERFUND_MIXED_EXIT_ONLY_V1';
  approvalReference: string;
  notBefore: string;
  initializeBefore: string;
  repositoryRoot: string;
  heartbeatFile: string;
  controlDirectory: string;
  scopes: {
    accountId: string;
    userId: string;
    roundId: string;
    mints: string[];
    archiveDirectory: string;
    initialBankFile: string;
    initialBankSHA256: string;
    initialize: boolean;
    pollMs: number;
    captureUntil: string;
    maxRpcCalls: number;
    maxSlots: number;
    maxTransactions: number;
  }[];
}
export function validateScope(d: ScopeDocument, now = Date.now()) {
  assert(
    d?.schema === 'PAPERFUND_MIXED_EXIT_ONLY_V1' && !!d.approvalReference,
    'APPROVAL_REQUIRED',
  );
  assert(Number.isFinite(Date.parse(d.notBefore)) && now >= Date.parse(d.notBefore), 'NOT_BEFORE');
  assert(Number.isFinite(Date.parse(d.initializeBefore)), 'INITIALIZATION_DEADLINE');
  for (const p of [d.repositoryRoot, d.heartbeatFile, d.controlDirectory])
    assert(typeof p === 'string' && isAbsolute(p), 'ABSOLUTE_PATH');
  assert(Array.isArray(d.scopes) && d.scopes.length > 0 && d.scopes.length <= 8, 'SCOPES');
  const ids = new Set<string>();
  for (const s of d.scopes) {
    assert(s.accountId && s.userId && s.roundId && !ids.has(s.accountId), 'IDENTITY');
    ids.add(s.accountId);
    assert(
      Array.isArray(s.mints) && s.mints.length > 0 && new Set(s.mints).size === s.mints.length,
      'MINTS',
    );
    assert(
      isAbsolute(s.archiveDirectory) &&
        isAbsolute(s.initialBankFile) &&
        /^[a-f0-9]{64}$/.test(s.initialBankSHA256),
      'EVIDENCE_PATH',
    );
    assert(
      typeof s.initialize === 'boolean' &&
        Number.isSafeInteger(s.pollMs) &&
        s.pollMs >= 250 &&
        s.pollMs <= 5000,
      'OBSERVATION_SCHEDULE',
    );
    assert(
      Number.isSafeInteger(s.maxSlots) &&
        s.maxSlots >= 1 &&
        s.maxSlots <= 2048 &&
        Number.isSafeInteger(s.maxTransactions) &&
        s.maxTransactions >= 1 &&
        s.maxTransactions <= 200000,
      'INTERVAL_BUDGET',
    );
    assert(
      Number.isSafeInteger(s.maxRpcCalls) &&
        s.maxRpcCalls > 0 &&
        s.maxRpcCalls <= 20000 &&
        Number.isFinite(Date.parse(s.captureUntil)),
      'RPC_BUDGET',
    );
  }
  // Unknown top-level trading switches cannot convert this entry to ENTRY.
  assert(
    !('authorizePaperBuy' in d) && !('mode' in d) && d.scopes.every((s) => !('mode' in s)),
    'ENTRY_SWITCH_REFUSED',
  );
  return d;
}
export async function loadScope(file: string, pin: string) {
  assert(isAbsolute(file) && /^[a-f0-9]{64}$/.test(pin ?? ''), 'PINNED_SCOPE_REQUIRED');
  const raw = await readFile(file);
  assert(createHash('sha256').update(raw).digest('hex') === pin, 'SCOPE_HASH');
  return validateScope(JSON.parse(raw.toString()) as ScopeDocument);
}
export function budgetedRpc(
  rpc: ReadOnlyRpc,
  limit: number,
  until: number,
  now = Date.now,
): ReadOnlyRpc {
  let used = 0;
  return {
    async call<T>(method: string, params: unknown[]): Promise<T> {
      assert(
        ['getMultipleAccounts', 'getSlot', 'getBlocks', 'getBlock', 'getTransaction', 'getTransactionsForAddress'].includes(method),
        'READ_ONLY_RPC',
      );
      assert(now() <= until && ++used <= limit, 'RPC_BUDGET_EXHAUSTED');
      return rpc.call<T>(method, params);
    },
  };
}
/** Receipt-proven candidate exits; ordinary/legacy provenance and all HARD_STOP checks remain authoritative. */
export function scopedExitPermission(
  database: DatabaseService,
  capability: GenericCapability,
  scopes: readonly Pick<
    ScopeDocument['scopes'][number],
    'accountId' | 'userId' | 'roundId' | 'mints'
  >[],
  systemSettlement: boolean,
  now = Date.now,
) {
  return async (mint: string, quote: string, forSettlement: boolean) => {
    const actor = genericActor(),
      scope = scopes.find((s) => s.accountId === actor?.accountId && s.mints.includes(mint));
    if (!scope) return capability.resolve(mint, quote, forSettlement);
    const system = systemSettlement && forSettlement;
    if (!system && actor?.userId !== scope.userId)
      return capability.resolve(mint, quote, forSettlement);
    const deny = (reason: string): never => {
      throw new ExecutionEngineError('POSITION_EXECUTION_ROUTE_UNAVAILABLE', reason);
    };
    async function owned() {
      const row = (
        await database.pool.query(
          `select e.normalized_state->'stage1Snapshot'->>'quoteMint' quote,
    e.normalized_state->'stage1Snapshot'->>'targetPool' target,e.normalized_state->'stage1Snapshot'->>'bridgePool' bridge
    from positions p join competition_accounts a on a.id=p.competition_account_id
    join hourly_rounds h on h.id=a.hourly_round_id join assets t on t.id=p.asset_id
    join lateral(select f.* from fills f join orders o on o.id=f.order_id join markets m on m.id=f.market_id
     where o.competition_account_id=a.id and m.base_asset_id=p.asset_id and f.side='BUY' and f.base_quantity>0 and o.status='COMPLETED'
     order by f.executed_at desc,f.id desc limit 1) f on true
    join market_state_evidence e on e.id=f.market_state_evidence_id and e.protocol_id=f.protocol_id and e.market_id=f.market_id
    join linked_candidate.receipts r on r.fill_id=f.id and r.execution_id=f.execution_id and r.account_id=a.id
    join linked_candidate.branches b on b.account_id=a.id and b.round_id=a.hourly_round_id
    where a.id=$1 and a.user_id=$2 and a.hourly_round_id=$3 and t.mint_address=$4 and p.status='OPEN' and p.remaining_base_units>0
     and a.final_settled_balance_lamports is null and f.protocol_id='GENERIC_PUMP_SWAP'
     and e.adapter_version='linked-native-atomic-v1' and e.normalization_version='linked-native-atomic-state-v1'
     and e.normalized_state->'stage1Snapshot'->>'mint'=$4 and b.revision>=r.revision
     and (($5::boolean and h.state='SETTLING' and h.ends_at_exclusive<=$6)
       or (not $5::boolean and h.state='OPEN' and h.starts_at<=$6 and h.ends_at_exclusive>$6))`,
          [scope!.accountId, scope!.userId, scope!.roundId, mint, system, new Date(now())],
        )
      ).rows[0];
      return row?.quote && row?.target && row?.bridge
        ? {
            quoteMint: row.quote as string,
            targetPool: row.target as string,
            bridgePool: row.bridge as string,
          }
        : null;
    }
    const binding = await owned();
    if (!binding) return capability.resolve(mint, quote, forSettlement);
    if (binding.quoteMint !== quote) deny('GENERIC_EXIT_QUOTE_CHANGED');
    if ((await capability.status(scope.userId)).mode === 'HARD_STOP') deny('GENERIC_HARD_STOP');
    return {
      discover: false,
      buy: false,
      exitBinding: binding,
      authorizeLive: async (kind: 'BUY' | 'SELL') => {
        if (kind === 'BUY') deny('GENERIC_OPERATOR_ENTRY_DISABLED');
        if (!system && genericActor()?.intent !== 'SELL') deny('GENERIC_READ_SCOPE_CANNOT_EXECUTE');
        if ((await capability.status(scope.userId)).mode === 'HARD_STOP') deny('GENERIC_HARD_STOP');
        const current = await owned();
        if (!current || JSON.stringify(current) !== JSON.stringify(binding))
          deny('GENERIC_OWNED_EXIT_EVIDENCE_REQUIRED');
      },
    };
  };
}
export async function prepareOperational(
  config: Config,
  document: ScopeDocument,
  role: 'api' | 'worker',
  testing: {
    database?: DatabaseService;
    now?: () => number;
    rpc?: ReadOnlyRpc;
    baselineRouter?: ReturnType<typeof createProductionExecutionRouter>;
    durableFlow?: boolean;
    /** Experimental complete-body overlap; enable only after measured sustainable qualification. */
    prefetchFlow?: boolean;
    footprintAcquisition?: boolean;
    proofRecovery?: boolean;
    qualificationFile?: string;
  } = {},
) {
  const now = testing.now ?? Date.now;
  if(testing.footprintAcquisition && !testing.durableFlow)throw Error('FOOTPRINT_DURABLE_FLOW_REQUIRED');
  validateScope(document, now());
  assert(
    config.PRIVATE_BETA_NON_PAYING &&
      config.BETA_INVITE_ONLY &&
      !config.PAYOUT_EXECUTION_ENABLED &&
      config.PAYOUT_SIGNER_TYPE === 'DISABLED',
    'FINANCIAL_CONFIGURATION',
  );
  assert(
    !config.CREATOR_FEE_INGESTION_ENABLED && config.CREATOR_FEE_SHADOW_MODE,
    'FEE_OBSERVER_ONLY',
  );
  const base = testing.database ?? createDatabase(config.DATABASE_URL);
  // Never inherit a permissive test/server callback into an operational release.
  const database: DatabaseService = { ...base, authorizePaperBuy: async () => false };
  await qualifySuccessor(database, role, testing.qualificationFile);
  const capability = new GenericCapability(
    database,
    { ...genericCapabilityOptions(config), entries: false, systemSettlement: role === 'worker' },
    now,
  );
  const baselineRouter =
    testing.baselineRouter ??
    createProductionExecutionRouter({
      genericPumpSwapEnabled: config.GENERIC_PUMPSWAP_ENABLED,
      genericPumpSwapBuysEnabled: false,
      genericAccessResolver: (mint, quote, settlement) =>
        capability.resolve(mint, quote, settlement),
      nonSolPumpSwapEnabled: config.NON_SOL_PUMPSWAP_ENABLED,
      nonSolPumpSwapRoutes: config.NON_SOL_PUMPSWAP_ALLOWED_ROUTES,
      rpcUrl: config.SOLANA_RPC_URL,
      rpcTimeoutMs: config.SOLANA_RPC_TIMEOUT_MS,
      commitment: config.SOLANA_COMMITMENT,
    });
  const observed = [] as {
    scope: ScopeDocument['scopes'][number];
    store: LinkedStateStore;
    connector: FinalizedFlowConnector;
    cutoff: Date;
  }[];
  const scopes = [] as Parameters<typeof composeScopedProduction>[0]['scopes'][number][];
  for (const s of document.scopes) {
    const account = (
      await database.pool.query(
        'select a.user_id,a.hourly_round_id,h.state,h.starts_at,h.ends_at_exclusive from competition_accounts a join hourly_rounds h on h.id=a.hourly_round_id where a.id=$1',
        [s.accountId],
      )
    ).rows[0];
    assert(account?.user_id === s.userId && account.hourly_round_id === s.roundId, 'ACCOUNT_OWNER');
    const store = new LinkedStateStore(
        database,
        s.accountId,
        s.roundId,
        testing.durableFlow === true,
        testing.proofRecovery === true,
      ),
      archive = new FinalizedBankArchive(s.archiveDirectory, testing.durableFlow === true),
      connectorRpc = budgetedRpc(
          testing.rpc ?? new FinalizedRpc(config.SOLANA_RPC_URL, config.SOLANA_RPC_TIMEOUT_MS),
          s.maxRpcCalls,
          Date.parse(s.captureUntil),
          now,
        ),
      connector = testing.footprintAcquisition ? new FootprintFlowConnector(connectorRpc,archive,now,{
        maxSlots:s.maxSlots,maxTransactions:s.maxTransactions,concurrency:8,
        loadBranch:async anchor=>{const head=await store.load();if(digest(head.document.real)!==digest(anchor))throw Error('FOOTPRINT_PREDECESSOR_CHANGED_RETRY');return head.document},
      }) : new FinalizedFlowConnector(connectorRpc,archive,now,{maxSlots:s.maxSlots,maxTransactions:s.maxTransactions,blockConcurrency:testing.durableFlow?8:4});
    const exists = (
      await database.pool.query('select 1 from linked_candidate.branches where account_id=$1', [
        s.accountId,
      ])
    ).rowCount;
    if (!exists) {
      assert(
        role === 'worker' && s.initialize && now() <= Date.parse(document.initializeBefore),
        'MISSING_BRANCH_NO_RESET',
      );
      assert(
        account.state === 'OPEN' &&
          +account.starts_at <= now() &&
          +account.ends_at_exclusive > now(),
        'FRESH_OPEN_ROUND_REQUIRED',
      );
      const raw = await readFile(s.initialBankFile);
      assert(
        createHash('sha256').update(raw).digest('hex') === s.initialBankSHA256,
        'INITIAL_BANK_HASH',
      );
      const seed = JSON.parse(raw.toString()) as Stage1Snapshot;
      assert(
        now() >= Date.parse(seed.observedAt) && now() - Date.parse(seed.observedAt) <= 10000,
        'STALE_INITIAL_SEED',
      );
      const bank = await connector.observe(seed);
      assert(
        now() >= Date.parse(bank.observedAt) && now() - Date.parse(bank.observedAt) <= 10000,
        'STALE_INITIAL_BANK',
      );
      assert(
        linkedBindings(bank).length > 0 &&
          new Set(linkedBindings(bank).map((b) => b.mint)).size === s.mints.length &&
          linkedBindings(bank).every((b) => s.mints.includes(b.mint)),
        'INITIAL_ROUTE_SCOPE',
      );
      // observe() verified the current native bank, strict Clock/context and canonical header; no historical reseed.
      await store.initialize(bank);
    }
    await store.recover();
    observed.push({ scope: s, store, connector, cutoff: new Date(account.ends_at_exclusive) });
    scopes.push({
      accountId: s.accountId,
      userId: s.userId,
      roundId: s.roundId,
      mints: s.mints,
      approvalReference: document.approvalReference,
      mode: 'EXIT_ONLY',
      connector,
      durableFlow: testing.durableFlow === true,
      proofRecovery: testing.proofRecovery === true,
    });
  }
  const composed = await composeScopedProduction({
    database,
    baselineRouter,
    scopes,
    now,
    resolvePermission: scopedExitPermission(
      database,
      capability,
      document.scopes,
      role === 'worker',
      now,
    ),
    competitionOptions: {
      rewardConfig: {
        allocationMode: config.REWARD_ALLOCATION_MODE,
        baselineWindow: config.REWARD_BASELINE_WINDOW,
        lambdaBps: BigInt(config.REWARD_LAMBDA_BPS),
        configurationVersion: 'phase-5a-v1',
      },
      advisoryLimits: {
        maxConcurrent: config.ADVISORY_MAX_CONCURRENT,
        backgroundConcurrent: config.ADVISORY_BACKGROUND_CONCURRENT,
      },
      genericArmed: config.GENERIC_PUMPSWAP_ENABLED,
    },
  });
  let stopping = false,
    running: Promise<void> | undefined,
    timer: ReturnType<typeof setTimeout> | undefined;
  let progressing: Promise<void> | undefined,
    prefetching: Promise<void> | undefined,
    progressTimer: ReturnType<typeof setTimeout> | undefined;
  const observation = {
    lastSuccessAt: null as string | null,
    lastError: null as string | null,
    progressError: null as string | null,
    progress: null as null | {
      from: number;
      to: number;
      acquisitionMs: number;
      checkpointMs: number;
      finishedAt: string;
    },
  };
  async function observeOnce() {
    for (const o of observed) {
      try {
        if (now() > Date.parse(o.scope.captureUntil)) continue;
        const anchor = (await o.store.load()).document.real;
        if (now() >= +o.cutoff) await o.connector.captureCutoffBank(anchor, o.cutoff);
        else {
          const after = await o.connector.observe(anchor);
          if(testing.durableFlow && testing.prefetchFlow && !prefetching){
            prefetching=o.connector.prefetch(anchor,after).catch(e=>{
              observation.lastError=e instanceof Error?e.message:'PREFETCH_REJECTED';
            }).finally(()=>{prefetching=undefined});
          }
        }
        observation.lastSuccessAt = new Date(now()).toISOString();
        observation.lastError = null;
      } catch (e) {
        observation.lastError = e instanceof Error ? e.message : 'OBSERVATION_REJECTED';
      }
    }
  }
  async function progressOnce() {
    for (const o of observed) {
      try {
        if (now() > Date.parse(o.scope.captureUntil)) continue;
        const head = await o.store.load(),
          after = await o.connector.archive.nextBank(head.document.real, Math.min(64, o.connector.maxSlots));
        if (!after || Date.parse(after.observedAt) >= +o.cutoff || (await o.store.cutoff()))
          continue;
        const started = performance.now(),
          interval = await o.connector.interval(head.document.real, after),
          acquired = performance.now();
        if (interval) await o.store.advanceFlow(interval);
        observation.progress = {
          from: head.document.real.slot,
          to: after.slot,
          acquisitionMs: acquired - started,
          checkpointMs: performance.now() - acquired,
          finishedAt: new Date(now()).toISOString(),
        };
        observation.progressError = null;
      } catch (e) {
        observation.progressError = e instanceof Error ? e.message : 'FLOW_PROGRESS_REJECTED';
      }
    }
  }
  function startObservation() {
    assert(role === 'worker', 'SINGLE_OBSERVER_WORKER_ONLY');
    const poll = testing.durableFlow ? 500 : Math.min(...observed.map((o) => o.scope.pollMs));
    const tick = () => {
      running = observeOnce().finally(() => {
        if (!stopping) timer = setTimeout(tick, poll);
      });
    };
    tick();
    if (testing.durableFlow) {
      const progress = () => {
        progressing = progressOnce().finally(() => {
          if (!stopping) progressTimer = setTimeout(progress, 100);
        });
      };
      progress();
    }
  }
  async function stopObservation() {
    stopping = true;
    if (timer) clearTimeout(timer);
    if (progressTimer) clearTimeout(progressTimer);
    await running;
    await progressing;
    await prefetching;
  }
  return {
    ...composed,
    capability,
    observation,
    observeOnce,
    progressOnce,
    startObservation,
    stopObservation,
  };
}
/** Local protected-directory drain request. It can only stop this process, never grant trading. */
export function installDrain(
  directory: string,
  role: 'api' | 'worker',
  drain: () => Promise<void>,
) {
  let busy = false;
  const request = join(directory, role + '-drain.request.json');
  const timer = setInterval(() => {
    if (busy) return;
    busy = true;
    void (async () => {
      try {
        const raw = JSON.parse(await readFile(request, 'utf8'));
        assert(
          raw?.schema === 'PAPERFUND_DRAIN_V1' && typeof raw.requestId === 'string',
          'DRAIN_REQUEST',
        );
        clearInterval(timer);
        await drain();
        await mkdir(directory, { recursive: true });
        const target = join(directory, role + '-drained.json'),
          temp = target + '.' + process.pid + '.tmp';
        await writeFile(
          temp,
          JSON.stringify({
            requestId: raw.requestId,
            pid: process.pid,
            drainedAt: new Date().toISOString(),
          }) + '\n',
        );
        await rename(temp, target);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') console.error('DRAIN_REQUEST_REJECTED');
      } finally {
        busy = false;
      }
    })();
  }, 250);
  return () => clearInterval(timer);
}
