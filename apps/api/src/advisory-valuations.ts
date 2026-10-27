import {
  ExecutionEngineError,
  type ExecutionRouter,
  type MarketIdentity,
} from '@paperfund/execution';
import { genericActor, withAdvisoryRead, type AdvisoryReadContext } from '@paperfund/protocols';
import { exitPreflight } from './exit-preflight.js';
type Route = Awaited<ReturnType<ExecutionRouter['loadPositionRoute']>>;
type Metrics = AdvisoryReadContext['metrics'];
const emptyMetrics = (): Metrics => ({ rpcRequests: 0, rpcMs: 0, retries: 0, rateLimits: 0 });
/** Process-local advisory captures only. The authoritative router is never replaced or cached. */
export class AdvisoryValuations {
  private recent = new Map<
    string,
    { until: number; route: Route; metrics: Metrics; routeMs: number }
  >();
  private pending = new Map<
    string,
    {
      value: Promise<{ route: Route; metrics: Metrics; routeMs: number }>;
      controller: AbortController;
      refs: number;
    }
  >();
  private slots = new Map<string, number>();
  private cooldownUntil = 0;
  get retryAfterMs() {
    return Math.max(0, this.cooldownUntil - Date.now());
  }
  private active = 0;
  private background = 0;
  constructor(
    private source: ExecutionRouter,
    private now: () => number = Date.now,
    private limits = { maxConcurrent: 4, backgroundConcurrent: 2 },
  ) {}
  get concurrent() {
    return this.active;
  }
  invalidate() {
    this.recent.clear();
  }
  async capture(identity: MarketIdentity, priority: 'viewed' | 'background', signal?: AbortSignal) {
    signal?.throwIfAborted();
    const actor = genericActor();
    const key =
      JSON.stringify(identity) +
      (actor?.isolateCaptures
        ? JSON.stringify([actor.userId ?? 'system', actor.accountId ?? null])
        : '');
    const saved = this.recent.get(key);
    if (saved && saved.until > this.now())
      return {
        ...saved,
        route: { ...saved.route, state: structuredClone(saved.route.state) },
        shared: true,
      };
    this.recent.delete(key);
    if (this.retryAfterMs > 0) throw new Error('ADVISORY_RATE_LIMITED');
    let entry = this.pending.get(key);
    const shared = !!entry;
    if (!entry) {
      if (
        this.active >= this.limits.maxConcurrent ||
        (priority === 'background' &&
          this.background >=
            Math.min(this.limits.backgroundConcurrent, this.limits.maxConcurrent - 1))
      )
        throw new ExecutionEngineError('MARKET_STATE_UNAVAILABLE', 'ADVISORY_BUSY');
      this.active++;
      if (priority === 'background') this.background++;
      const controller = new AbortController();
      const deadline = setTimeout(
        () => controller.abort(new Error('ADVISORY_DEADLINE_EXCEEDED')),
        2200,
      );
      const metrics = emptyMetrics();
      const previousSlot = this.slots.get(key);
      const context: AdvisoryReadContext = {
        signal: controller.signal,
        metrics,
        ...(previousSlot !== undefined ? { minimumSlot: previousSlot } : {}),
      };
      const started = performance.now();
      const value = withAdvisoryRead(context, () => this.source.loadPositionRoute(identity));
      const current = {
        controller,
        refs: 0,
        value: Promise.resolve({} as { route: Route; metrics: Metrics; routeMs: number }),
      };
      current.value = this.wait(value, controller.signal)
        .then((route) => {
          const slot = route.state.chainSlot;
          if (slot === null || slot > BigInt(Number.MAX_SAFE_INTEGER))
            throw new Error('SNAPSHOT_SLOT_UNAVAILABLE');
          if (previousSlot !== undefined && slot < BigInt(previousSlot))
            throw new Error('SNAPSHOT_SLOT_REGRESSION');
          const chainTime = route.state.normalizedState['chainTime'];
          if (
            typeof chainTime === 'string' &&
            (!Number.isFinite(Date.parse(chainTime)) ||
              this.now() - Date.parse(chainTime) > 2500 ||
              Date.parse(chainTime) > this.now() + 1000)
          )
            throw new Error('SNAPSHOT_FRESHNESS_UNAVAILABLE');
          if (this.now() - Date.parse(route.state.observedAt) > 2200)
            throw new Error('SNAPSHOT_EXPIRED');
          if (this.slots.size >= 256) this.slots.delete(this.slots.keys().next().value!);
          this.slots.set(key, Number(slot));
          const result = { route, metrics, routeMs: performance.now() - started };
          if (this.recent.size >= 256) this.recent.delete(this.recent.keys().next().value!);
          this.recent.set(key, { ...result, until: this.now() + 250 });
          return result;
        })
        .finally(() => {
          this.cooldownUntil = Math.max(this.cooldownUntil, metrics.rateLimitedUntil ?? 0);
          clearTimeout(deadline);
          if (this.pending.get(key) === current) this.pending.delete(key);
          this.active--;
          if (priority === 'background') this.background--;
        });
      void current.value.catch(() => {});
      this.pending.set(key, current);
      entry = current;
    }
    entry.refs++;
    try {
      const result = await this.wait(entry.value, signal);
      return {
        ...result,
        route: { ...result.route, state: structuredClone(result.route.state) },
        shared,
      };
    } finally {
      entry.refs--;
      if (entry.refs === 0 && this.pending.get(key) === entry)
        entry.controller.abort(new Error('ADVISORY_NO_CONSUMERS'));
    }
  }
  private wait<T>(value: Promise<T>, signal?: AbortSignal): Promise<T> {
    if (!signal) return value;
    return new Promise((resolve, reject) => {
      const abort = () => {
        signal.removeEventListener('abort', abort);
        reject(signal.reason);
      };
      if (signal.aborted) {
        abort();
        return;
      }
      signal.addEventListener('abort', abort, { once: true });
      void value.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    });
  }
  router(priority: 'viewed' | 'background' = 'background', signal?: AbortSignal): ExecutionRouter {
    return {
      loadPositionRoute: async (identity: MarketIdentity) =>
        (await this.capture(identity, priority, signal)).route,
    } as ExecutionRouter;
  }
  async preflight(
    identity: MarketIdentity,
    quantity: bigint,
    basis: bigint,
    priority: 'viewed' | 'background' = 'background',
    signal?: AbortSignal,
  ) {
    const requested = performance.now();
    const capture = await this.capture(identity, priority, signal);
    const waited = performance.now() - requested;
    const started = performance.now();
    const exit = await withAdvisoryRead(
      { signal: signal ?? AbortSignal.timeout(2200), metrics: emptyMetrics() },
      () =>
        exitPreflight(
          { loadPositionRoute: async () => capture.route } as unknown as ExecutionRouter,
          identity,
          quantity,
          basis,
        ),
    );
    return {
      exit,
      chainTime:
        typeof capture.route.state.normalizedState['chainTime'] === 'string'
          ? capture.route.state.normalizedState['chainTime']
          : null,
      metrics: {
        ...capture.metrics,
        routeMs: waited,
        captureRouteMs: capture.routeMs,
        captureRpcRequests: capture.metrics.rpcRequests,
        captureRpcMs: capture.metrics.rpcMs,
        rpcRequests: capture.shared ? 0 : capture.metrics.rpcRequests,
        rpcMs: capture.shared ? 0 : capture.metrics.rpcMs,
        quoteMs: performance.now() - started,
        shared: capture.shared,
        concurrent: this.active,
      },
    };
  }
}
