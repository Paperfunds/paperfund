import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GmgnChartLegend } from './gmgn-chart.js';
import type { ChartMarkers } from './chart-marker.js';
let legend: GmgnChartLegend;
const url = 'https://gmgn.ai/sol/token/mint';
const input: ChartMarkers = { url, mint: 'mint', context: 'mint', ownerId: 'owner',
  markers: [{ id: 'average', kind: 'AVERAGE', time: 0, priceSol: '0.00001', usdEntry: { priceUsd: '0.001', details: {} } }],
  history: { ownerId: 'owner', mint: 'mint', visible: true, diagnostics: { fills: 2, cycles: 1, displayedCycles: 1, omittedMarkers: 0, unavailable: [] },
    drawings: ['BUY_AVG', 'SELL_AVG', 'BUY', 'SELL'].map((kind, i) => ({ id: String(i), kind: kind as 'BUY',
      ownerId: 'owner', accountId: 'account', roundId: 'round', mint: 'mint', cycleId: 'cycle', time: 100 + i,
      levelUsd: '1000', label: 'PF ' + kind })) } };
function frame() {
  const f = document.createElement('iframe'); f.id = 'tradingview_gmgn'; f.src = 'blob:https://gmgn.ai/chart';
  f.getBoundingClientRect = () => ({ top: 100, right: 800, width: 700, height: 400 }) as DOMRect;
  document.body.append(f); return f;
}
beforeEach(() => { vi.stubGlobal('location', { href: url }); legend = new GmgnChartLegend(); });
afterEach(() => { legend.invalidate(); document.body.replaceChildren(); vi.unstubAllGlobals(); });
describe('GMGN isolated-chart reference legend', () => {
  it('waits for initialization then shows current and historical references without claiming plot alignment', () => {
    expect(legend.render(input).reason).toBe('GMGN_CHART_INITIALIZING'); frame();
    expect(legend.render(input)).toMatchObject({ available: false, drawn: 0, legendItems: 5, legendAvailable: true });
    const layer = document.querySelector('[data-paperfund-gmgn-legend]') as HTMLElement;
    expect(layer.textContent).toContain('not chart coordinates'); expect(layer.textContent).toContain('PF AVG $0.001');
    expect(layer.style.pointerEvents).toBe('none');
  });
  it('deduplicates refresh and follows frame replacement without modifying host chart data', () => {
    const f = frame(); legend.render(input); legend.render(input);
    expect(document.querySelectorAll('[data-paperfund-gmgn-legend]')).toHaveLength(1);
    f.remove(); expect(legend.render(input).reason).toBe('GMGN_CHART_INITIALIZING'); frame(); legend.render(input);
    expect(document.querySelectorAll('[data-paperfund-gmgn-legend]')).toHaveLength(1);
  });
  it('removes current AVG after close while retaining saved historical references', () => {
    frame(); legend.render(input); legend.render({ ...input, markers: [] });
    expect(document.body.textContent).not.toContain('PF AVG $'); expect(document.body.textContent).toContain('PF BUY_AVG');
  });
  it('clears on navigation and rejects foreign history and hidden frames', () => {
    const f = frame(); legend.render(input);
    expect(legend.render({ ...input, mint: 'foreign' }).reason).toBe('GMGN_CHART_IDENTITY_UNVERIFIED');
    expect(document.querySelector('[data-paperfund-gmgn-legend]')).toBeNull();
    expect(legend.render({ ...input, markers: [], history: { ...input.history!, ownerId: 'foreign' } }).legendItems).toBe(0);
    f.style.display = 'none'; expect(legend.render(input).reason).toBe('GMGN_CHART_INITIALIZING');
  });
});
