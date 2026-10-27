import {
  CandidateError,
  MODEL_VERSION,
  fingerprint,
  quote,
  valueForExit,
  settlementFailure,
} from './model.js';
import type { Evidence, Fill, Identity, Policy } from './model.js';
import type { IsolatedHighWater } from './high-water.js';

interface Position {
  identity: Identity;
  quantity: bigint;
  basis: bigint;
  peakQuantity: bigint;
}
interface JournalLine {
  code: 'CASH' | 'POSITION_COST' | 'TRADING_PNL' | 'TRADING_FEES';
  delta: bigint;
}
export interface SandboxAccount {
  owner: string;
  id: string;
  round: string;
  modelVersion: string;
  state: 'OPEN' | 'SETTLING' | 'FINALIZED';
  startsAtMs: number;
  endsAtMs: number;
  cash: bigint;
  startingCash: bigint;
  realizedPnl: bigint;
  positions: Position[];
  slots: string[];
  fills: Fill[];
  journals: JournalLine[][];
}
export interface Intent {
  readonly owner: string;
  readonly account: string;
  readonly round: string;
  readonly key: string;
  readonly identity: Identity;
  readonly side: 'BUY' | 'SELL';
  readonly amount: bigint | 'ALL';
  readonly forced?: boolean;
}
export type SnapshotLoader = (
  identities: readonly Identity[],
) => Promise<ReadonlyMap<string, Evidence>>;
interface SettlementAudit {
  attempt: number;
  maxAttempts: number;
  atMs: number;
  state: string;
  failures: readonly string[];
}
function fail(code: string): never {
  throw new CandidateError(code);
}
const positionKey = (i: Identity) => fingerprint(i);

/** Disposable in-memory acceptance harness, not a database service or production transaction substitute. */
export class DisposableSandbox {
  private readonly accounts = new Map<string, SandboxAccount>();
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly replays = new Map<string, { hash: string; fill: Fill }>();
  private readonly settlementQueues = new Map<string, Promise<unknown>>();
  private readonly settlementAudits = new Map<string, SettlementAudit[]>();
  private readonly policy: Policy;
  constructor(
    policy: Policy,
    private readonly load: SnapshotLoader,
    private readonly now: () => number,
    private readonly highWater: IsolatedHighWater,
  ) {
    this.policy = structuredClone(policy);
  }
  add(account: SandboxAccount): void {
    if (
      this.accounts.has(account.id) ||
      account.cash < 0n ||
      account.startingCash < 0n ||
      account.positions.length ||
      account.slots.length ||
      account.fills.length ||
      account.journals.length ||
      account.cash !== account.startingCash ||
      account.realizedPnl !== 0n ||
      account.startsAtMs >= account.endsAtMs
    )
      fail('INVALID_SANDBOX_ACCOUNT');
    this.accounts.set(account.id, structuredClone(account));
  }
  read(id: string): SandboxAccount {
    return structuredClone(this.accounts.get(id) ?? fail('ACCOUNT_NOT_FOUND'));
  }
  readSettlementAudit(id: string): readonly SettlementAudit[] {
    return structuredClone(this.settlementAudits.get(id) ?? []);
  }
  private async serialized<T>(
    id: string,
    action: () => Promise<T>,
    queues = this.queues,
  ): Promise<T> {
    const previous = queues.get(id) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(action);
    queues.set(id, next);
    try {
      return await next;
    } finally {
      if (queues.get(id) === next) queues.delete(id);
    }
  }
  async execute(intent: Intent): Promise<Fill> {
    const request = structuredClone(intent);
    return this.serialized(request.account, async () => {
      const a = this.read(request.account);
      if (a.owner !== request.owner || a.round !== request.round) fail('ACCOUNT_SCOPE_MISMATCH');
      if (a.modelVersion !== MODEL_VERSION) fail('MODEL_VERSION_MISMATCH');
      if (
        !request.key ||
        (request.amount !== 'ALL' && (typeof request.amount !== 'bigint' || request.amount <= 0n))
      )
        fail('INVALID_INTENT');
      const replayKey = fingerprint({ account: a.id, round: a.round, key: request.key });
      const hash = fingerprint(request),
        replay = this.replays.get(replayKey);
      if (replay) {
        if (replay.hash !== hash) fail('IDEMPOTENCY_CONFLICT');
        return structuredClone(replay.fill);
      }
      const assertAdmission = (now: number) => {
        if (request.forced) {
          if (a.state !== 'SETTLING' || request.side !== 'SELL' || now < a.endsAtMs)
            fail('INVALID_SETTLEMENT_STATE');
        } else if (a.state !== 'OPEN' || now < a.startsAtMs || now >= a.endsAtMs)
          fail('ROUND_NOT_OPEN');
      };
      assertAdmission(this.now());
      const position = a.positions.find(
        (p) => positionKey(p.identity) === positionKey(request.identity),
      );
      if (
        a.positions.some(
          (p) =>
            p.identity.mint === request.identity.mint &&
            positionKey(p.identity) !== positionKey(request.identity),
        )
      )
        fail('POSITION_IDENTITY_CONFLICT');
      const amount =
        request.amount === 'ALL'
          ? (position?.quantity ?? fail('POSITION_NOT_FOUND'))
          : request.amount;
      if (request.side === 'BUY' && request.amount === 'ALL') fail('INVALID_AMOUNT');
      if (request.side === 'SELL' && (!position || amount > position.quantity))
        fail('INSUFFICIENT_TOKEN_BALANCE');
      const identities =
        request.side === 'BUY'
          ? [...a.positions.map((p) => p.identity), request.identity]
          : [request.identity];
      const evidence = await this.load(identities);
      const get = (i: Identity) => evidence.get(positionKey(i)) ?? fail('PRICE_UNAVAILABLE');
      await this.highWater.acceptBatch(identities.map(get), this.now());
      const now = this.now();
      assertAdmission(now);
      const times = identities.flatMap((i) =>
        [...get(i).observations, ...(get(i).conversion?.observations ?? [])].map(
          (o) => o.observedAtMs,
        ),
      );
      if (Math.max(...times) - Math.min(...times) > this.policy.maxSkewMs)
        fail('INCOHERENT_PORTFOLIO');
      if (request.side === 'BUY') {
        const equity =
          a.cash +
          a.positions.reduce(
            (s, p) =>
              s +
              valueForExit(
                p.quantity,
                get(p.identity),
                p.identity,
                now,
                this.policy,
                [...a.fills]
                  .reverse()
                  .find((f) => positionKey(f.identity) === positionKey(p.identity))?.evidence,
                p.peakQuantity,
              ),
            0n,
          );
        if (amount > a.cash) fail('INSUFFICIENT_CASH');
        if (amount > (equity * 2000n) / 10_000n) fail('MAX_BUY_RATIO_EXCEEDED');
        if (!a.slots.includes(request.identity.mint) && a.slots.length >= 5)
          fail('TOKEN_SLOT_LIMIT_REACHED');
      }
      const fill = quote(
        request.side,
        amount,
        get(request.identity),
        request.identity,
        now,
        this.policy,
        [...a.fills]
          .reverse()
          .find((f) => positionKey(f.identity) === positionKey(request.identity))?.evidence,
        request.side === 'SELL' ? position?.peakQuantity : undefined,
      );
      let journal: JournalLine[];
      if (request.side === 'BUY') {
        const nextQuantity = (position?.quantity ?? 0n) + fill.output;
        const nextPeak =
          position && position.peakQuantity > nextQuantity ? position.peakQuantity : nextQuantity;
        // Do not admit an acquisition whose resulting peak cannot be valued inside supported SELL ranges.
        valueForExit(
          nextQuantity,
          get(request.identity),
          request.identity,
          now,
          this.policy,
          fill.evidence,
          nextPeak,
        );
        a.cash -= fill.input;
        if (position) {
          position.quantity += fill.output;
          position.basis += fill.input;
          position.peakQuantity = nextPeak;
        } else
          a.positions.push({
            identity: structuredClone(request.identity),
            quantity: fill.output,
            basis: fill.input,
            peakQuantity: nextPeak,
          });
        if (!a.slots.includes(request.identity.mint)) a.slots.push(request.identity.mint);
        journal = [
          { code: 'CASH', delta: -fill.input },
          { code: 'POSITION_COST', delta: fill.input },
        ];
      } else {
        if (!position) fail('POSITION_NOT_FOUND');
        const removed =
          amount === position.quantity
            ? position.basis
            : (position.basis * amount) / position.quantity;
        const fee = fill.fees.reduce((s, f) => s + f.amount, 0n);
        a.cash += fill.output;
        a.realizedPnl += fill.output - removed;
        position.quantity -= amount;
        position.basis -= removed;
        if (position.quantity === 0n) a.positions = a.positions.filter((p) => p !== position);
        journal = [
          { code: 'CASH', delta: fill.output },
          { code: 'TRADING_FEES', delta: fee },
          { code: 'POSITION_COST', delta: -removed },
          { code: 'TRADING_PNL', delta: removed - fill.gross },
        ];
      }
      if (
        journal.reduce((s, line) => s + line.delta, 0n) !== 0n ||
        a.cash < 0n ||
        a.cash + a.positions.reduce((s, p) => s + p.basis, 0n) !== a.startingCash + a.realizedPnl
      )
        fail('UNBALANCED_ACCOUNTING');
      a.journals.push(journal);
      a.fills.push(fill);
      this.accounts.set(a.id, a);
      this.replays.set(replayKey, { hash, fill: structuredClone(fill) });
      return structuredClone(fill);
    });
  }
  async equity(id: string): Promise<bigint> {
    return this.serialized(id, async () => {
      const a = this.read(id);
      if (a.modelVersion !== MODEL_VERSION) fail('MODEL_VERSION_MISMATCH');
      const evidence = await this.load(a.positions.map((p) => p.identity)),
        now = this.now();
      await this.highWater.acceptBatch(
        a.positions.map((p) => evidence.get(positionKey(p.identity)) ?? fail('PRICE_UNAVAILABLE')),
        now,
      );
      const times = a.positions.flatMap((p) => {
        const e = evidence.get(positionKey(p.identity));
        return e
          ? [...e.observations, ...(e.conversion?.observations ?? [])].map((o) => o.observedAtMs)
          : [];
      });
      if (times.length && Math.max(...times) - Math.min(...times) > this.policy.maxSkewMs)
        fail('INCOHERENT_PORTFOLIO');
      return (
        a.cash +
        a.positions.reduce(
          (s, p) =>
            s +
            valueForExit(
              p.quantity,
              evidence.get(positionKey(p.identity)) ?? fail('PRICE_UNAVAILABLE'),
              p.identity,
              now,
              this.policy,
              [...a.fills]
                .reverse()
                .find((f) => positionKey(f.identity) === positionKey(p.identity))?.evidence,
              p.peakQuantity,
            ),
          0n,
        )
      );
    });
  }
  async close(id: string): Promise<void> {
    await this.serialized(id, async () => {
      const a = this.read(id);
      if (a.modelVersion !== MODEL_VERSION) fail('MODEL_VERSION_MISMATCH');
      if (this.now() < a.endsAtMs) fail('BEFORE_CUTOFF');
      if (a.state === 'OPEN') {
        a.state = 'SETTLING';
        this.accounts.set(id, a);
      }
    });
  }
  async settle(
    id: string,
    attempt: number,
    maxAttempts: number,
  ): Promise<{ state: string; failures: readonly string[] }> {
    return this.serialized(
      id,
      () => this.settlePass(id, attempt, maxAttempts),
      this.settlementQueues,
    );
  }
  private async settlePass(
    id: string,
    attempt: number,
    maxAttempts: number,
  ): Promise<{ state: string; failures: readonly string[] }> {
    // validate bounded retry arguments before allowing a financial operation
    settlementFailure(attempt, maxAttempts, 'VALIDATE');
    const audit = this.settlementAudits.get(id) ?? [];
    const prior = audit.at(-1);
    if (prior && prior.maxAttempts !== maxAttempts) fail('SETTLEMENT_POLICY_CHANGED');
    if (
      prior &&
      (prior.state === 'REVIEW_REQUIRED' || prior.state === 'FINALIZED' || attempt <= prior.attempt)
    ) {
      return { state: prior.state, failures: structuredClone(prior.failures) };
    }
    if (attempt !== (prior?.attempt ?? 0) + 1) fail('INVALID_SETTLEMENT_ATTEMPT');
    await this.close(id);
    const a = this.read(id),
      failures: string[] = [];
    for (const p of a.positions) {
      try {
        await this.execute({
          owner: a.owner,
          account: id,
          round: a.round,
          key: `settlement:${positionKey(p.identity)}:${p.quantity}`,
          identity: p.identity,
          side: 'SELL',
          amount: 'ALL',
          forced: true,
        });
      } catch (error) {
        failures.push(error instanceof CandidateError ? error.code : 'PRICE_SOURCE_FAILURE');
      }
    }
    const result = await this.serialized(id, async () => {
      const current = this.read(id);
      if (!current.positions.length) {
        current.state = 'FINALIZED';
        this.accounts.set(id, current);
        return { state: 'FINALIZED', failures };
      }
      return {
        state: settlementFailure(attempt, maxAttempts, failures.join(',') || 'OPEN_POSITION').state,
        failures,
      };
    });
    audit.push({ attempt, maxAttempts, atMs: this.now(), ...result });
    this.settlementAudits.set(id, audit);
    return result;
  }
}
