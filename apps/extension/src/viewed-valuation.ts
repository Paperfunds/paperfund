import type { ViewedPositionValuation, Position } from '@paperfund/shared/browser';
export const VIEWED_INTERVAL_MS = 1000;
export const FRESH_MS = 2500;
export const LAST_KNOWN_MS = 15000;
export interface ValuationSample {
  response: ViewedPositionValuation;
  receivedAt: number;
  ageAtReceipt: number;
  lastSuccessAt: number;
  error: string | null;
}
export interface ValuationScope {
  userId: string;
  accountId: string | null;
  roundId: string;
  mint: string;
  endsAt: number;
}
/** One active read, no queued ticks. Network deadlines belong to advisory transport only. */
export class ViewedValuationLoop {
  private roundTimer: ReturnType<typeof setTimeout> | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private controller: AbortController | undefined;
  private stopped = false;
  private failures = 0;
  private lastApplied = -1;
  constructor(
    private scope: ValuationScope,
    private read: (signal: AbortSignal) => Promise<ViewedPositionValuation>,
    private apply: (sample: ValuationSample) => void,
    private diagnostic: (details: Record<string, unknown>) => void,
    private accepted: {
      slot: bigint | null;
      updatedAt: number;
      financialVersion?: bigint;
      lastApplied?: number;
    } = {
      slot: null,
      updatedAt: 0,
    },
  ) {}
  updateDeadline(endsAt: number) {
    this.scope.endsAt = endsAt;
    clearTimeout(this.roundTimer);
    if (!this.stopped)
      this.roundTimer = setTimeout(() => this.closeRound(), Math.max(0, endsAt - Date.now()));
  }
  start() {
    clearTimeout(this.roundTimer);
    clearTimeout(this.timer);
    clearTimeout(this.roundTimer);
    this.stopped = false;
    this.roundTimer = setTimeout(
      () => this.closeRound(),
      Math.max(0, this.scope.endsAt - Date.now()),
    );
    void this.tick();
  }
  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.controller?.abort();
    this.diagnostic({ event: 'CANCELED', concurrent: 0 });
  }
  private closeRound() {
    if (this.stopped) return;
    this.apply({
      response: {
        userId: this.scope.userId,
        accountId: this.scope.accountId,
        roundId: this.scope.roundId,
        mint: this.scope.mint,
        status: 'ROUND_CLOSED',
        reason: 'ROUND_ROLLOVER',
        revision: null,
        financialVersion: null,
        positionUpdatedAt: null,
        position: null,
        snapshotAt: null,
        chainTime: null,
        chainSlot: null,
        completedAt: new Date().toISOString(),
      },
      receivedAt: performance.now(),
      ageAtReceipt: Infinity,
      lastSuccessAt: this.lastApplied,
      error: 'ROUND_ROLLOVER',
    });
    this.stop();
  }
  private async tick() {
    if (this.stopped || this.controller) return;
    if (Date.now() >= this.scope.endsAt) {
      this.closeRound();
      return;
    }
    const controller = new AbortController();
    this.controller = controller;
    const started = performance.now();
    let retryAfter = 0;
    try {
      const response = await this.read(controller.signal);
      if (this.stopped || controller.signal.aborted) return;
      if (Date.now() >= this.scope.endsAt) {
        this.closeRound();
        return;
      }
      if (
        Date.now() >= this.scope.endsAt ||
        response.userId !== this.scope.userId ||
        (this.scope.accountId !== null && response.accountId !== this.scope.accountId) ||
        response.roundId !== this.scope.roundId ||
        response.mint !== this.scope.mint
      )
        throw new Error('VALUATION_SCOPE_REJECTED');
      const updated = Date.parse(response.positionUpdatedAt ?? '');
      const version = /^\d+$/.test(response.financialVersion ?? '')
        ? BigInt(response.financialVersion!)
        : null;
      if (
        version !== null &&
        this.accepted.financialVersion !== undefined &&
        version < this.accepted.financialVersion
      )
        throw new Error('POSITION_REVISION_REGRESSION');
      if (version !== null) this.accepted.financialVersion = version;
      let age = Infinity;
      if (response.status === 'AVAILABLE') {
        if (
          !Number.isFinite(updated) ||
          version === null ||
          !response.position ||
          response.position.mint !== this.scope.mint ||
          response.position.valuation.status !== 'AVAILABLE' ||
          !response.revision ||
          !/^\d+$/.test(response.chainSlot ?? '')
        )
          throw new Error('SNAPSHOT_FRESHNESS_UNAVAILABLE');
        const slot = BigInt(response.chainSlot!);
        if (this.accepted.slot !== null && slot < this.accepted.slot)
          throw new Error('SNAPSHOT_SLOT_REGRESSION');
        const delta = Date.parse(response.completedAt) - Date.parse(response.chainTime ?? '');
        if (
          delta < 0 ||
          response.position.valuation.chainSlot !== response.chainSlot ||
          response.position.valuation.observedAt !== response.snapshotAt
        )
          throw new Error('SNAPSHOT_FRESHNESS_UNAVAILABLE');
        age = Math.max(0, delta) + performance.now() - started;
        if (!Number.isFinite(age) || age > FRESH_MS) throw new Error('SNAPSHOT_EXPIRED');
        this.accepted.slot = slot;
        this.accepted.updatedAt = updated;
        this.failures = 0;
        const applied = performance.now();
        this.diagnostic({
          event: 'APPLIED',
          requestedIntervalMs: VIEWED_INTERVAL_MS,
          actualIntervalMs:
            (this.accepted.lastApplied ?? this.lastApplied) >= 0
              ? applied - (this.accepted.lastApplied ?? this.lastApplied)
              : null,
          endToEndMs: applied - started,
          slot: response.chainSlot,
          ageMs: age,
          backend: response.metrics,
          requestId: response.requestId,
          concurrent: 1,
        });
        this.lastApplied = applied;
        this.accepted.lastApplied = applied;
      } else {
        this.failures++;
        retryAfter = response.retryAfterMs ?? 0;
      }
      this.apply({
        response,
        receivedAt: performance.now(),
        ageAtReceipt: age,
        lastSuccessAt: this.lastApplied,
        error: response.reason,
      });
      if (response.status === 'NOT_HELD' || response.status === 'ROUND_CLOSED') {
        this.stop();
        return;
      }
    } catch (error) {
      if (controller.signal.aborted || this.stopped) return;
      this.failures++;
      retryAfter = Number((error as { retryAfterMs?: number })?.retryAfterMs) || 0;
      this.diagnostic({
        event: 'REJECTED_OR_FAILED',
        reason: error instanceof Error ? error.message : 'VALUATION_UNAVAILABLE',
        endToEndMs: performance.now() - started,
        concurrent: 0,
      });
      this.apply({
        response: {
          userId: this.scope.userId,
          accountId: this.scope.accountId,
          roundId: this.scope.roundId,
          mint: this.scope.mint,
          status: 'UNAVAILABLE',
          reason: error instanceof Error ? error.message : 'VALUATION_UNAVAILABLE',
          revision: null,
          financialVersion: null,
          positionUpdatedAt: null,
          position: null,
          snapshotAt: null,
          chainTime: null,
          chainSlot: null,
          completedAt: new Date().toISOString(),
        },
        receivedAt: performance.now(),
        ageAtReceipt: Infinity,
        lastSuccessAt: this.lastApplied,
        error: 'VALUATION_REFRESH_FAILED',
      });
    } finally {
      if (this.controller === controller) this.controller = undefined;
      if (!this.stopped) {
        const delay = this.failures
          ? Math.max(retryAfter, Math.min(15000, 1000 * 2 ** Math.min(this.failures - 1, 4))) *
            (1 + Math.random() * 0.2)
          : Math.max(0, VIEWED_INTERVAL_MS - (performance.now() - started));
        this.timer = setTimeout(() => void this.tick(), Math.min(60000, delay));
      }
    }
  }
}
export function displayedValuation(
  current: ValuationSample | null,
  lastGood: ValuationSample | null,
  now = performance.now(),
): { position: Position | null; ageMs: number | null; stale: boolean } {
  if (!current || ['NOT_HELD', 'ROUND_CLOSED'].includes(current.response.status))
    return { position: null, ageMs: null, stale: false };
  const compatible =
    lastGood &&
    (!current.response.revision || current.response.revision === lastGood.response.revision) &&
    current.response.reason !== 'POSITION_REVISION_CHANGED';
  const chosen = current.response.status === 'AVAILABLE' ? current : compatible ? lastGood : null;
  const age = chosen ? chosen.ageAtReceipt + Math.max(0, now - chosen.receivedAt) : Infinity;
  if (!chosen || age > LAST_KNOWN_MS)
    return {
      position: current.response.position
        ? {
            ...current.response.position,
            valuation: {
              status: 'UNAVAILABLE',
              reason: 'SNAPSHOT_EXPIRED',
              valuedAt: current.response.completedAt,
            },
          }
        : null,
      ageMs: Number.isFinite(age) ? age : null,
      stale: true,
    };
  return {
    position: chosen.response.position,
    ageMs: age,
    stale: !!current.error || age > FRESH_MS,
  };
}
