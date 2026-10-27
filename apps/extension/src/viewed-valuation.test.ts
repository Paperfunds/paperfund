import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  ViewedValuationLoop,
  displayedValuation,
  type ValuationSample,
} from './viewed-valuation.js';
import type { ViewedPositionValuation } from '@paperfund/shared/browser';
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(Math, 'random').mockReturnValue(0);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
function response(slot = '10', revision = 'r', financialVersion = '1'): ViewedPositionValuation {
  const time = new Date().toISOString();
  return {
    userId: 'u',
    accountId: 'a',
    roundId: 'r',
    mint: 'm',
    status: 'AVAILABLE',
    reason: null,
    revision,
    financialVersion,
    positionUpdatedAt: time,
    snapshotAt: time,
    chainTime: time,
    chainSlot: slot,
    completedAt: time,
    position: {
      id: 'p',
      mint: 'm',
      originMarketId: 'pool',
      originProtocol: 'PUMP_SWAP',
      tokenDecimals: 6,
      tokenQuantityBaseUnits: '1000',
      costBasisPaperSolLamports: '10',
      realizedPnlLamports: '1',
      valuation: {
        status: 'AVAILABLE',
        executablePaperSolLamports: '20',
        unrealizedPnlLamports: '10',
        currentProtocol: 'PUMP_SWAP',
        evidenceFingerprint: 'f',
        observedAt: time,
        chainSlot: slot,
        valuedAt: time,
      },
    },
  };
}
function fixture(
  read: (signal: AbortSignal) => Promise<ViewedPositionValuation> = vi.fn(async () => response()),
) {
  const reader = vi.fn(read);
  const apply = vi.fn(),
    diagnostic = vi.fn();
  const loop = new ViewedValuationLoop(
    { userId: 'u', accountId: 'a', roundId: 'r', mint: 'm', endsAt: Date.now() + 10000 },
    reader,
    apply,
    diagnostic,
  );
  return { loop, read: reader, apply, diagnostic };
}
it('captures once per second with one active read and no queued polling ticks', async () => {
  let finish!: (r: ViewedPositionValuation) => void;
  const read = vi.fn(() => new Promise<ViewedPositionValuation>((r) => (finish = r)));
  const f = fixture(read);
  f.loop.start();
  await vi.advanceTimersByTimeAsync(3000);
  expect(read).toHaveBeenCalledTimes(1);
  finish(response());
  await vi.advanceTimersByTimeAsync(1000);
  expect(read).toHaveBeenCalledTimes(2);
  f.loop.stop();
});
it('applies healthy fresh responses approximately every second', async () => {
  const f = fixture();
  f.loop.start();
  await vi.advanceTimersByTimeAsync(2100);
  expect(f.read).toHaveBeenCalledTimes(3);
  expect(f.apply).toHaveBeenCalledTimes(3);
  f.loop.stop();
});
it.each(['mint', 'accountId', 'roundId'])(
  'rejects foreign %s without attaching its valuation',
  async (key) => {
    const f = fixture(vi.fn(async () => ({ ...response(), [key]: 'foreign' })));
    f.loop.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.apply.mock.calls[0]?.[0].response.status).toBe('UNAVAILABLE');
    f.loop.stop();
  },
);
it('rejects regressing slots while preserving ordering across financial revisions', async () => {
  const read = vi
    .fn()
    .mockResolvedValueOnce(response('20'))
    .mockResolvedValueOnce(response('19', 'new'));
  const f = fixture(read);
  f.loop.start();
  await vi.advanceTimersByTimeAsync(1000);
  expect(f.diagnostic).toHaveBeenCalledWith(
    expect.objectContaining({ reason: 'SNAPSHOT_SLOT_REGRESSION' }),
  );
  f.loop.stop();
});
it('cancels obsolete mint/BUY/SELL requests and ignores late results', async () => {
  let finish!: (r: ViewedPositionValuation) => void;
  const f = fixture(vi.fn(() => new Promise<ViewedPositionValuation>((r) => (finish = r))));
  f.loop.start();
  const signal = f.read.mock.calls[0]![0];
  f.loop.stop();
  finish(response());
  await vi.advanceTimersByTimeAsync(0);
  expect(signal.aborted).toBe(true);
  expect(f.apply).not.toHaveBeenCalled();
});
it('stops requests when no position is held and restarts promptly on a new scope', async () => {
  const f = fixture(
    vi.fn(async () => ({ ...response(), status: 'NOT_HELD' as const, position: null })),
  );
  f.loop.start();
  await vi.advanceTimersByTimeAsync(5000);
  expect(f.read).toHaveBeenCalledTimes(1);
  f.loop.start();
  await vi.advanceTimersByTimeAsync(0);
  expect(f.read).toHaveBeenCalledTimes(2);
  f.loop.stop();
});
it('invalidates the position at UTC round rollover even with a pending request', async () => {
  const f = fixture(vi.fn(() => new Promise<ViewedPositionValuation>(() => {})));
  f.loop.start();
  await vi.advanceTimersByTimeAsync(10000);
  expect(f.apply).toHaveBeenCalledWith(
    expect.objectContaining({
      response: expect.objectContaining({ status: 'ROUND_CLOSED', position: null }),
    }),
  );
});
it('labels last-known data stale, expires it and never attaches it to a new quantity/revision', () => {
  const good: ValuationSample = {
    response: response(),
    receivedAt: 0,
    ageAtReceipt: 0,
    lastSuccessAt: 0,
    error: null,
  };
  expect(displayedValuation(good, good, 3000)).toMatchObject({ stale: true, ageMs: 3000 });
  expect(displayedValuation(good, good, 16000).position?.valuation.status).toBe('UNAVAILABLE');
  const changed = {
    ...good,
    response: { ...response('20', 'changed'), status: 'UNAVAILABLE' as const },
  };
  expect(displayedValuation(changed, good, 3000).position?.valuation.status).toBe('UNAVAILABLE');
});
it('honors advertised retry delay instead of accumulating requests', async () => {
  const f = fixture(
    vi.fn(async () => ({
      ...response(),
      status: 'UNAVAILABLE' as const,
      retryAfterMs: 5000,
      reason: 'ADVISORY_RATE_LIMITED',
    })),
  );
  f.loop.start();
  await vi.advanceTimersByTimeAsync(4999);
  expect(f.read).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(f.read).toHaveBeenCalledTimes(2);
  f.loop.stop();
});

it('orders financial changes by immutable fill version rather than trade arrival timestamps', async () => {
  const first = response('20', 'r', '1'),
    next = response('21', 'new', '2');
  next.positionUpdatedAt = new Date(Date.now() - 2000).toISOString();
  const f = fixture(vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(next));
  f.loop.start();
  await vi.advanceTimersByTimeAsync(1000);
  expect(f.apply.mock.calls.filter(([s]) => s.response.status === 'AVAILABLE')).toHaveLength(2);
  f.loop.stop();
});
