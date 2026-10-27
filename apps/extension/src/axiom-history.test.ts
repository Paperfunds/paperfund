import { describe, expect, it, vi } from 'vitest';
import { AxiomHistoricalDrawings } from './axiom-history.js';
import type { TradeHistoryPlan } from './trade-history-chart.js';
import type { AxiomNativeChart } from './axiom-native.js';
const plan: TradeHistoryPlan = {
  ownerId: 'user',
  mint: 'mint',
  visible: true,
  diagnostics: { fills: 1, cycles: 1, displayedCycles: 1, omittedMarkers: 0, unavailable: [] },
  drawings: [
    {
      id: 'average',
      ownerId: 'user',
      mint: 'mint',
      roundId: 'round',
      accountId: 'account',
      cycleId: 'cycle',
      kind: 'BUY_AVG',
      levelUsd: '10000',
      time: 1,
      label: 'PF BUY AVG',
    },
    {
      id: 'fill',
      ownerId: 'user',
      mint: 'mint',
      roundId: 'round',
      accountId: 'account',
      cycleId: 'cycle',
      kind: 'BUY',
      levelUsd: '10000',
      time: 1,
      label: 'PF BUY',
    },
  ],
};
async function flush() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}
function fixture() {
  const ids = new Set<string>();
  let n = 0;
  const chart: AxiomNativeChart = {
    symbolExt: () => ({ ticker: 'ticker' }),
    createShape: vi.fn(async () => {
      const id = String(++n);
      ids.add(id);
      return id;
    }),
    removeEntity: vi.fn((id) => {
      ids.delete(id);
    }),
    getAllShapes: () => [...ids].map((id) => ({ id })),
  };
  return { ids, chart };
}
describe('isolated native historical reconciliation', () => {
  it('requests native horizontal and circled-letter text drawings, retains IDs on refresh, hides only its own history', async () => {
    const { chart, ids } = fixture();
    ids.add('active-average');
    const renderer = new AxiomHistoricalDrawings();
    renderer.render(plan, chart, 'user', 'mint', 'symbol', () => true);
    await flush();
    expect(chart.createShape).toHaveBeenCalledWith(
      { price: 10000, time: 1 },
      expect.objectContaining({
        shape: 'text',
        text: '\u24b7',
        overrides: expect.objectContaining({ color: '#579e7b' }),
      }),
    );
    renderer.render(JSON.parse(JSON.stringify(plan)), chart, 'user', 'mint', 'symbol', () => true);
    await flush();
    expect(chart.createShape).toHaveBeenCalledTimes(2);
    renderer.render({ ...plan, visible: false }, chart, 'user', 'mint', 'symbol', () => true);
    await flush();
    expect([...ids]).toEqual(['active-average']);
  });
  it('rejects wrong owners/mints and removes pending creations after navigation', async () => {
    const { chart } = fixture();
    const renderer = new AxiomHistoricalDrawings();
    renderer.render(plan, chart, 'other', 'mint', 'symbol', () => true);
    await flush();
    expect(chart.createShape).not.toHaveBeenCalled();
    let finish!: (id: string) => void;
    vi.mocked(chart.createShape).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    renderer.render(plan, chart, 'user', 'mint', 'symbol', () => true);
    renderer.clear('navigation');
    finish('late');
    await flush();
    expect(chart.removeEntity).toHaveBeenCalledWith('late');
  });
  it('restores host-removed drawings and reports rejected marker APIs without affecting other entities', async () => {
    const { chart, ids } = fixture();
    const renderer = new AxiomHistoricalDrawings();
    renderer.render(plan, chart, 'user', 'mint', 'symbol', () => true);
    await flush();
    ids.clear();
    renderer.render(plan, chart, 'user', 'mint', 'symbol', () => true);
    await flush();
    expect(chart.createShape).toHaveBeenCalledTimes(4);
  });
});

it('reconciles newly priced BUY drawings beside the existing SELL without duplicate IDs', async () => {
  const { chart } = fixture();
  const renderer = new AxiomHistoricalDrawings();
  const sell = { ...plan.drawings[1]!, id: 'sell', kind: 'SELL' as const };
  renderer.render({ ...plan, drawings: [sell] }, chart, 'user', 'mint', 'symbol', () => true);
  await flush();
  expect(chart.createShape).toHaveBeenCalledWith(
    { price: 10000, time: 1 },
    expect.objectContaining({ shape: 'text', text: '\u24c8' }),
  );
  const ready = { ...plan, drawings: [sell, ...plan.drawings] };
  renderer.render(ready, chart, 'user', 'mint', 'symbol', () => true);
  await flush();
  renderer.render(ready, chart, 'user', 'mint', 'symbol', () => true);
  await flush();
  expect(chart.createShape).toHaveBeenCalledTimes(3);
});
it('identifies the native rejected drawing separately from model eligibility failures', async () => {
  localStorage.setItem('paperfund:debug', '1');
  const { chart } = fixture();
  vi.mocked(chart.createShape).mockRejectedValue(Error('host rejection'));
  new AxiomHistoricalDrawings().render(plan, chart, 'user', 'mint', 'symbol', () => true);
  await flush();
  expect(
    (window as Window & { paperfundHistoricalDiagnostics?: unknown })
      .paperfundHistoricalDiagnostics,
  ).toMatchObject({
    unavailableDrawings: expect.arrayContaining([
      expect.objectContaining({
        drawingId: 'fill',
        kind: 'BUY',
        reason: 'HISTORICAL_MARKER_API_REJECTED',
      }),
    ]),
  });
  localStorage.removeItem('paperfund:debug');
});
