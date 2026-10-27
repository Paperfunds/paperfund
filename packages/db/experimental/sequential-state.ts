/** Stage 2 disposable persistence only: outside src/tsconfig, no exports or production imports. */
import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { MarketState } from '@paperfund/execution';
import {
  createSequentialSimulation,
  transitionSequentialRoute,
  type SequentialSimulation,
  type SimulationScope,
} from '../../protocols/src/experimental/sequential-route.js';

const VERSION = 'SEQUENTIAL_SANDBOX_STATE_V1';
const INTEGER = '$sequentialInteger';
export class DurableSimulationError extends Error {
  constructor(
    readonly code:
      | 'ISOLATION_REQUIRED'
      | 'MISSING_STATE'
      | 'CORRUPT_STATE'
      | 'INCOMPATIBLE_STATE'
      | 'IDEMPOTENCY_CONFLICT'
      | 'INVALID_TRADE',
    message: string,
  ) {
    super(message);
  }
}
const fail = (code: DurableSimulationError['code'], message: string): never => {
  throw new DurableSimulationError(code, message);
};
function canonical(value: unknown): unknown {
  if (typeof value === 'bigint') return { [INTEGER]: value.toString() };
  if (typeof value === 'number' && !Number.isSafeInteger(value))
    fail('CORRUPT_STATE', 'Noninteger or unsafe numeric state.');
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, canonical(v)]),
    );
  if (value === undefined) fail('CORRUPT_STATE', 'Missing serialized value.');
  return value;
}
const encode = (v: unknown) => JSON.stringify(canonical(v));
export const sequentialStateHash = (v: unknown) =>
  createHash('sha256').update(encode(v)).digest('hex');
function decode(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decode);
  if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    if (entries.some(([k]) => k === INTEGER)) {
      const text = (value as Record<string, unknown>)[INTEGER];
      if (entries.length !== 1 || typeof text !== 'string' || !/^-?(0|[1-9]\d*)$/.test(text))
        return fail('CORRUPT_STATE', 'Invalid integer encoding.');
      return BigInt(text);
    }
    return Object.fromEntries(entries.map(([k, v]) => [k, decode(v)]));
  }
  return value;
}
export interface SandboxState {
  readonly version: typeof VERSION;
  readonly simulation: SequentialSimulation;
  readonly cashLamports: bigint;
  readonly realizedPnlLamports: bigint;
  readonly positions: Readonly<Record<string, { quantity: bigint; basisLamports: bigint }>>;
}
export interface SandboxTrade extends SimulationScope {
  readonly requestKey: string;
  readonly executionId: string;
  readonly marketId: string;
  readonly side: 'BUY' | 'SELL';
  /** SELL ALL is resolved to the locked remaining quantity, never a client-side snapshot. */
  readonly amount: bigint | 'ALL';
}
function advance(before: SandboxState, request: SandboxTrade) {
  if (request.side !== 'BUY' && request.side !== 'SELL')
    fail('INVALID_TRADE', 'Invalid trade side.');
  const held = before.positions[request.marketId] ?? { quantity: 0n, basisLamports: 0n };
  const input =
    request.amount === 'ALL' && request.side === 'SELL' ? held.quantity : request.amount;
  if (
    typeof input !== 'bigint' ||
    input <= 0n ||
    (request.side === 'BUY' && input > before.cashLamports) ||
    (request.side === 'SELL' && input > held.quantity)
  )
    return fail('INVALID_TRADE', 'Invalid sandbox balance/quantity.');
  const transition = transitionSequentialRoute(
    before.simulation,
    { accountId: request.accountId, roundId: request.roundId },
    request.marketId,
    input,
    request.side === 'BUY',
  );
  const output = transition.quote.output;
  const removed =
    request.side === 'SELL'
      ? input === held.quantity
        ? held.basisLamports
        : (held.basisLamports * input) / held.quantity
      : 0n;
  const cashDelta = request.side === 'BUY' ? -input : output;
  const pnl = request.side === 'SELL' ? output - removed : 0n;
  const next: SandboxState = {
    ...before,
    simulation: transition.next,
    cashLamports: before.cashLamports + cashDelta,
    realizedPnlLamports: before.realizedPnlLamports + pnl,
    positions: {
      ...before.positions,
      [request.marketId]: {
        quantity: held.quantity + (request.side === 'BUY' ? output : -input),
        basisLamports: held.basisLamports + (request.side === 'BUY' ? input : -removed),
      },
    },
  };
  const capital = (s: SandboxState) =>
    s.cashLamports +
    Object.values(s.positions).reduce((sum, p) => sum + p.basisLamports, 0n) -
    s.realizedPnlLamports;
  if (
    capital(next) !== capital(before) ||
    Object.values(next.positions).some(
      (p) =>
        p.quantity < 0n || p.basisLamports < 0n || (p.quantity === 0n && p.basisLamports !== 0n),
    )
  )
    fail('CORRUPT_STATE', 'Sandbox cash/cost/P&L does not reconcile.');
  const hops = before.simulation.routes[request.marketId]!.normalizedState['hops'] as readonly {
    pool: string;
    program: string;
    vaultA: string;
    vaultB: string;
  }[];
  const poolTransitions = hops.map((h) => ({
    pool: h.pool,
    program: h.program,
    before: Object.fromEntries(
      [h.pool, h.vaultA, h.vaultB].map((address) => [address, before.simulation.accounts[address]]),
    ),
    after: Object.fromEntries(
      [h.pool, h.vaultA, h.vaultB].map((address) => [address, next.simulation.accounts[address]]),
    ),
  }));
  const receipt = {
    version: VERSION,
    executionId: request.executionId,
    requestKey: request.requestKey,
    revision: BigInt(transition.next.sequence),
    beforeHash: sequentialStateHash(before),
    afterHash: sequentialStateHash(next),
    input,
    output,
    cashDelta,
    basisRemoved: removed,
    realizedPnlDelta: pnl,
    evidence: transition.evidence,
    poolTransitions,
  };
  return { next, receipt };
}
export type SandboxReceipt = ReturnType<typeof advance>['receipt'];
interface StateRow {
  revision: string;
  initial_document: unknown;
  initial_hash: string;
  document: unknown;
  state_hash: string;
}
interface TradeRow {
  revision: string;
  request_key: string;
  execution_id: string;
  request: unknown;
  request_hash: string;
  before_hash: string;
  after_hash: string;
  receipt: unknown;
  receipt_hash: string;
}

/** Requires an explicitly named, empty-of-production-tables disposable database on every transaction. */
export class DisposableSequentialStore {
  constructor(private readonly pool: Pool) {}
  private async isolated(c: PoolClient) {
    const r = (
      await c.query<{ name: string; live: string | null; marker: string | null }>(
        "select current_database() name,to_regclass('public.competition_accounts')::text live,to_regclass('public.seq_test_marker')::text marker",
      )
    ).rows[0]!;
    if (!/^paperfund_seq_test_[a-z0-9_]+$/.test(r.name) || r.live !== null || r.marker === null)
      fail('ISOLATION_REQUIRED', 'Sequential persistence requires a disposable test database.');
    const marker = await c.query('select version from public.seq_test_marker');
    if (marker.rows.length !== 1 || marker.rows[0].version !== 'SEQ_DISPOSABLE_V1')
      fail('ISOLATION_REQUIRED', 'Disposable schema marker is missing/incompatible.');
  }
  private async transaction<T>(
    scope: SimulationScope,
    write: boolean,
    run: (c: PoolClient) => Promise<T>,
  ): Promise<T> {
    const c = await this.pool.connect();
    try {
      await c.query(write ? 'begin' : 'begin isolation level repeatable read read only');
      await c.query("set local statement_timeout='15000ms'");
      await this.isolated(c);
      if (write)
        await c.query('select pg_advisory_xact_lock(hashtextextended($1,0))', [
          'experimental-sequential:' + JSON.stringify([scope.accountId, scope.roundId]),
        ]);
      const result = await run(c);
      await c.query('commit');
      return result;
    } catch (error) {
      await c.query('rollback');
      if (error && typeof error === 'object' && 'code' in error && error.code === '23505')
        fail(
          'IDEMPOTENCY_CONFLICT',
          'Concurrent request/execution identity conflict; transaction rolled back.',
        );
      throw error;
    } finally {
      c.release();
    }
  }
  private async checked(c: PoolClient, scope: SimulationScope, lock = false) {
    try {
      const row = (
        await c.query<StateRow>(
          'select * from public.seq_states where account_id=$1 and round_id=$2' +
            (lock ? ' for update' : ''),
          [scope.accountId, scope.roundId],
        )
      ).rows[0];
      if (!row) return fail('MISSING_STATE', 'Sandbox checkpoint is missing; no automatic reset.');
      const initial = decode(row.initial_document) as SandboxState,
        current = decode(row.document) as SandboxState;
      if (initial.version !== VERSION || current.version !== VERSION)
        return fail('INCOMPATIBLE_STATE', 'Unsupported persisted state version.');
      if (
        sequentialStateHash(initial) !== row.initial_hash ||
        sequentialStateHash(current) !== row.state_hash
      )
        return fail('CORRUPT_STATE', 'Checkpoint hash mismatch.');
      if (
        initial.simulation.scope.accountId !== scope.accountId ||
        initial.simulation.scope.roundId !== scope.roundId ||
        initial.cashLamports < 0n ||
        typeof initial.cashLamports !== 'bigint' ||
        initial.realizedPnlLamports !== 0n ||
        Object.keys(initial.positions).length
      )
        return fail('CORRUPT_STATE', 'Invalid initial sandbox/account state.');
      const rebuilt = createSequentialSimulation(
        { accountId: scope.accountId, roundId: scope.roundId },
        Object.values(initial.simulation.routes),
      );
      if (sequentialStateHash(rebuilt) !== sequentialStateHash(initial.simulation))
        return fail('CORRUPT_STATE', 'Initial pool capture does not reconstruct.');
      const events = (
        await c.query<TradeRow>(
          'select * from public.seq_trades where account_id=$1 and round_id=$2 order by revision',
          [scope.accountId, scope.roundId],
        )
      ).rows;
      let replay = initial;
      for (const event of events) {
        const request = decode(event.request) as SandboxTrade;
        if (
          request.accountId !== scope.accountId ||
          request.roundId !== scope.roundId ||
          request.requestKey !== event.request_key ||
          request.executionId !== event.execution_id ||
          sequentialStateHash(request) !== event.request_hash
        )
          return fail('CORRUPT_STATE', 'Trade request identity/hash mismatch.');
        const result = advance(replay, request),
          receipt = decode(event.receipt);
        if (
          BigInt(event.revision) !== BigInt(result.next.simulation.sequence) ||
          event.before_hash !== result.receipt.beforeHash ||
          event.after_hash !== result.receipt.afterHash ||
          sequentialStateHash(receipt) !== event.receipt_hash ||
          sequentialStateHash(result.receipt) !== event.receipt_hash
        )
          return fail('CORRUPT_STATE', 'Transition chain cannot replay deterministically.');
        replay = result.next;
      }
      if (
        BigInt(row.revision) !== BigInt(replay.simulation.sequence) ||
        sequentialStateHash(replay) !== row.state_hash
      )
        return fail('CORRUPT_STATE', 'Checkpoint differs from immutable replay.');
      return { state: current, hash: row.state_hash, events };
    } catch (error) {
      if (error instanceof DurableSimulationError) throw error;
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        typeof error.code === 'string' &&
        /^[0-9A-Z]{5}$/.test(error.code)
      )
        throw error; // Database outages/timeouts are not evidence of corrupted liquidity.
      return fail(
        'CORRUPT_STATE',
        'Persisted state is malformed or incompatible with protocol replay.',
      );
    }
  }
  async initialize(
    scope: SimulationScope,
    states: readonly MarketState[],
    cashLamports = 10000000000n,
  ) {
    if (typeof cashLamports !== 'bigint' || cashLamports < 0n)
      fail('INVALID_TRADE', 'Invalid initial cash.');
    const initial: SandboxState = {
      version: VERSION,
      simulation: createSequentialSimulation(
        { accountId: scope.accountId, roundId: scope.roundId },
        states,
      ),
      cashLamports,
      realizedPnlLamports: 0n,
      positions: {},
    };
    return this.transaction(scope, true, async (c) => {
      const hash = sequentialStateHash(initial);
      await c.query(
        `insert into public.seq_states(account_id,round_id,revision,initial_document,initial_hash,document,state_hash)
        values($1,$2,0,$3::jsonb,$4,$3::jsonb,$4) on conflict do nothing`,
        [scope.accountId, scope.roundId, encode(initial), hash],
      );
      const row = (
        await c.query<{ initial_hash: string }>(
          'select initial_hash from public.seq_states where account_id=$1 and round_id=$2',
          [scope.accountId, scope.roundId],
        )
      ).rows[0]!;
      if (row.initial_hash !== hash)
        fail('IDEMPOTENCY_CONFLICT', 'Initialization cannot replace prior state.');
      return (await this.checked(c, scope, true)).state;
    });
  }
  load(scope: SimulationScope) {
    return this.transaction(scope, false, async (c) => (await this.checked(c, scope)).state);
  }
  async trade(request: SandboxTrade): Promise<SandboxReceipt> {
    if (!request.requestKey || !request.executionId)
      fail('INVALID_TRADE', 'Explicit request/execution identities required.');
    return this.transaction(request, true, async (c) => {
      const checked = await this.checked(c, request, true),
        hash = sequentialStateHash(request);
      const previous = (
        await c.query<{ request_hash: string; receipt: unknown }>(
          'select request_hash,receipt from public.seq_trades where account_id=$1 and round_id=$2 and request_key=$3',
          [request.accountId, request.roundId, request.requestKey],
        )
      ).rows[0];
      if (previous) {
        if (previous.request_hash !== hash)
          fail('IDEMPOTENCY_CONFLICT', 'Request identity reused with changed intent.');
        return decode(previous.receipt) as SandboxReceipt;
      }
      if (
        (
          await c.query('select execution_id from public.seq_trades where execution_id=$1', [
            request.executionId,
          ])
        ).rowCount
      )
        fail('IDEMPOTENCY_CONFLICT', 'Execution identity already committed.');
      const { next, receipt } = advance(checked.state, request);
      await c.query(
        'update public.seq_states set revision=$3,document=$4::jsonb,state_hash=$5 where account_id=$1 and round_id=$2',
        [
          request.accountId,
          request.roundId,
          next.simulation.sequence,
          encode(next),
          receipt.afterHash,
        ],
      );
      await c.query(
        `insert into public.seq_trades(account_id,round_id,revision,request_key,execution_id,request,request_hash,
        before_hash,after_hash,receipt,receipt_hash) values($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10::jsonb,$11)`,
        [
          request.accountId,
          request.roundId,
          next.simulation.sequence,
          request.requestKey,
          request.executionId,
          encode(request),
          hash,
          receipt.beforeHash,
          receipt.afterHash,
          encode(receipt),
          sequentialStateHash(receipt),
        ],
      );
      return receipt;
    });
  }
}
