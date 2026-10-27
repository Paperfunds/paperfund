import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GmgnLightweightDrawings, GmgnPrimitive, gmgnDrawingPlan, gmgnMarkerCoordinate,
  gmgnUsdMcMode, locateGmgnChart, type GmgnBinding, type GmgnPrimitive as Primitive } from './gmgn-lightweight.js';
import type { ChartMarkers } from './chart-marker.js';
import { installChartBridge } from './chart-native.js';

const mint = 'A7rRfLf67GMp5DFeY7s4kUaZLZbbz6UFPM5XYSg2pump';
const url = `https://gmgn.ai/sol/token/${mint}`;
const scope = { ownerId: 'owner', mint, accountId: 'account', roundId: 'round', cycleId: 'cycle' };
function input(): ChartMarkers {
  return { url, context: mint, mint, ownerId: 'owner', markers: [{ id: 'current', kind: 'AVERAGE',
    priceSol: '0.1', time: 1791793970, usdEntry: { marketCapUsd: '5280.763666179555222735333503354', details: {} } }],
  history: { ownerId: 'owner', mint, visible: true, drawings: [
    { ...scope, id: 'buy-avg', kind: 'BUY_AVG', levelUsd: '5280.763666179555222735333503354', time: 1791793970, label: 'PF BUY AVG' },
    { ...scope, id: 'sell-avg', kind: 'SELL_AVG', levelUsd: '4835.449695940729125883100226964', time: 1791793970, label: 'PF SELL AVG' },
    { ...scope, id: 'buy', kind: 'BUY', levelUsd: '5280.763666179555222735333503354', time: 1791793970, label: 'PF BUY' },
    { ...scope, id: 'sell', kind: 'SELL', levelUsd: '4835.449695940729125883100226964', time: 1791793975, label: 'PF SELL' },
  ], diagnostics: { fills: 2, cycles: 1, displayedCycles: 1, omittedMarkers: 0, unavailable: [] } } };
}
function fixture() {
  document.body.innerHTML = '<section><header><div class="units"><p class="text-text-300">Price</p><p>/</p><p class="text-text-100">MCap</p></div><div class="currency"><span class="text-text-100">USD</span><span>/</span><span class="text-text-300">SOL</span></div></header><div class="native"><div class="tv-lightweight-charts"><table><tr><td><canvas></canvas></td></tr></table></div></div></section>';
  const root = document.querySelector<HTMLElement>('.tv-lightweight-charts')!;
  const native = root.parentElement!;
  let zoom = 1, pan = 0, priceScale = 1;
  let primitive: Primitive | null = null;
  const candleTimes = new Set([1791792000]);
  const chart = { timeScale: () => ({ timeToCoordinate: (time: number) => candleTimes.has(time) ? 100 * zoom + pan : null }),
    subscribeCrosshairMove: vi.fn() };
  const series = { seriesType: () => 'Candlestick', priceToCoordinate: (price: number) => price / 30 * priceScale,
    data: () => [...candleTimes].map(time => ({ time, close: 4962.188883218074 })),
    attachPrimitive: vi.fn((item: Primitive) => { primitive = item; item.attached({ requestUpdate: vi.fn() }); }),
    detachPrimitive: vi.fn((item: Primitive) => { item.detached(); if (primitive === item) primitive = null; }),
    setMarkers: vi.fn(), setData: vi.fn(), update: vi.fn(), applyOptions: vi.fn() };
  const top: Record<string, unknown> = {};
  top['stateNode'] = { current: top };
  const token = { memoizedProps: { chain: 'sol', address: mint }, return: top };
  const owner: { memoizedProps: { resolution: string; data: unknown[]; markers: unknown[] };
    memoizedState?: unknown; return: unknown; alternate?: unknown } = {
    memoizedProps: { resolution: '1h', data: [{ time: 1791792000, close: 4962.188883218074 }], markers: [] }, return: token };
  const refs = [native, { unrelated: true }, chart, { seriesType: () => 'Histogram' }, series];
  let hook: unknown = null;
  for (const current of refs.reverse()) hook = { memoizedState: { current }, next: hook };
  owner.memoizedState = hook;
  const fiber = { return: owner };
  Object.assign(top, { child: token }); Object.assign(token, { child: owner }); Object.assign(owner, { child: fiber });
  Object.defineProperty(native, '__reactFiber$fixture', { configurable: true, value: fiber });
  const binding: GmgnBinding = { root, chart, series, resolution: '1h', mint };
  return { root, native, chart, series, binding, token, owner, top, candleTimes,
    primitive: () => primitive,
    transform: (z: number, p: number, s: number) => { zoom = z; pan = p; priceScale = s; } };
}

beforeEach(() => {
  vi.stubGlobal('location', new URL(url));
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, top: 0, left: 0,
    right: 340, bottom: 280, width: 340, height: 280, toJSON: () => ({}) });
});
afterEach(() => {
  localStorage.removeItem('paperfund:debug');
  const host = window as Window & { paperfundChartBridgeCleanup?: () => void };
  host.paperfundChartBridgeCleanup?.(); delete host.paperfundChartBridgeCleanup;
  document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
});

describe('GMGN identity and units', () => {
  function previewFixture() {
    const f = fixture(); document.querySelector('.currency')!.remove();
    const header = document.createElement('div'); header.dataset['sentryComponent'] = 'renderPrice';
    header.textContent = '$3.81K'; document.querySelector('section')!.append(header);
    return f;
  }
  it('offers no preview to ordinary users and never enables the operator preview automatically', () => {
    const f = previewFixture(), renderer = new GmgnLightweightDrawings();
    expect(renderer.render(input()).available).toBe(false);
    expect(document.querySelector('[data-paperfund-gmgn-preview]')).toBeNull();
    localStorage.setItem('paperfund:debug', '1');
    expect(renderer.render(input()).available).toBe(false);
    expect(f.series.attachPrimitive).not.toHaveBeenCalled();
    expect(document.querySelector('button')?.textContent).toContain('unverified');
    renderer.invalidate();
  });
  it('requires explicit preview click, labels drawings and stops without changing evidence', () => {
    const f = previewFixture(), renderer = new GmgnLightweightDrawings(), data = input();
    const saved = structuredClone(data); localStorage.setItem('paperfund:debug', '1'); renderer.render(data);
    document.querySelector<HTMLButtonElement>('button')!.click();
    expect(renderer.render(data)).toMatchObject({ available: true, preview: true, currencyVerified: false });
    expect(document.querySelector('button')!.textContent).toContain('UNVERIFIED');
    expect(f.primitive()?.coordinates).toHaveLength(2); expect(data).toEqual(saved);
    document.querySelector<HTMLButtonElement>('button')!.click();
    expect(renderer.render(data).available).toBe(false); expect(f.series.detachPrimitive).toHaveBeenCalled();
    renderer.invalidate(); expect(document.querySelector('[data-paperfund-gmgn-preview]')).toBeNull();
  });
  it('revokes preview on timeframe, owner, navigation or diagnostics changes', () => {
    const f = previewFixture(), renderer = new GmgnLightweightDrawings(); localStorage.setItem('paperfund:debug', '1');
    renderer.render(input()); document.querySelector<HTMLButtonElement>('button')!.click();
    f.owner.memoizedProps.resolution = '1s'; expect(renderer.render(input()).available).toBe(false);
    document.querySelector<HTMLButtonElement>('button')!.click();
    const data = input(); data.ownerId = 'another'; expect(renderer.render(data).available).toBe(false);
    localStorage.removeItem('paperfund:debug'); expect(renderer.render(data).available).toBe(false);
    expect(document.querySelector('button')).toBeNull();
    vi.stubGlobal('location', new URL('https://gmgn.ai/sol/token/another'));
    expect(renderer.render(input()).available).toBe(false); renderer.invalidate();
  });
  it('never previews explicit SOL/Price, missing USD header, or missing fill FX', () => {
    const f = previewFixture(), renderer = new GmgnLightweightDrawings(); localStorage.setItem('paperfund:debug', '1');
    document.querySelector('[data-sentry-component]')!.remove(); renderer.render(input());
    expect(document.querySelector('button')).toBeNull();
    const h = document.createElement('div'); h.dataset['sentryComponent'] = 'renderPrice'; h.textContent = '$3.81K';
    document.querySelector('section')!.append(h); renderer.render(input());
    document.querySelector<HTMLButtonElement>('button')!.click();
    const noFx = input(); noFx.history!.drawings = []; noFx.markers[0]!.usdEntry = { reason: 'HISTORICAL_SOL_USD_UNAVAILABLE', details: {} };
    expect(renderer.render(noFx).available).toBe(false);
    document.querySelector('.units p:first-child')!.className = 'text-text-100';
    document.querySelector('.units p:last-child')!.className = 'text-text-300';
    expect(renderer.render(input()).available).toBe(false); expect(document.querySelector('button')).toBeNull();
    expect(f.series.setData).not.toHaveBeenCalled(); renderer.invalidate();
  });
  it('finds unique chart/Candlestick refs regardless of hook ordinal, never volume', () => {
    const f = fixture(); expect(locateGmgnChart(mint)?.series).toBe(f.series);
    expect(locateGmgnChart('wrong')).toBeNull();
  });
  it('rejects stale React branches, wrong chain and a replaced chart root', () => {
    const f = fixture(); f.top['stateNode'] = { current: {} }; expect(locateGmgnChart(mint)).toBeNull();
    f.top['stateNode'] = { current: f.top }; f.token.memoizedProps.chain = 'eth'; expect(locateGmgnChart(mint)).toBeNull();
    f.token.memoizedProps.chain = 'sol'; f.root.remove(); expect(locateGmgnChart(mint)).toBeNull();
  });
  it('accepts current shared children with stale alternate parent links', () => {
    const f = fixture(); const active = { child: f.token };
    f.top['alternate'] = active; f.top['stateNode'] = { current: active };
    expect(locateGmgnChart(mint)?.series).toBe(f.series);
  });
  it('rejects a detached subtree despite parent links reaching the current root', () => {
    const f = fixture(); f.top['child'] = {};
    expect(locateGmgnChart(mint)).toBeNull();
  });
  it('rejects cyclic parent and sibling pointers without hanging', () => {
    const f = fixture(); f.owner.return = f.owner;
    expect(locateGmgnChart(mint)).toBeNull();
    const next = fixture(); const child: Record<string, unknown> = {}; child['sibling'] = child;
    next.top['child'] = child; expect(locateGmgnChart(mint)).toBeNull();
  });
  it('does not bind USD from a dollar header and approximately matching MCap candle', () => {
    const f = fixture(); document.querySelector('.currency')!.remove();
    const header = document.createElement('div'); header.textContent = '$4.96K';
    document.querySelector('section')!.append(header);
    expect(gmgnUsdMcMode(f.root).supported).toBe(false);
  });
  it('requires selected USD and MCap, hides SOL/Price, and restores USD MC', () => {
    const f = fixture(); expect(gmgnUsdMcMode(f.root).supported).toBe(true);
    document.querySelector('.currency')!.innerHTML = '<span class="text-text-300">USD</span><span>/</span><span class="text-text-100">SOL</span>';
    expect(gmgnUsdMcMode(f.root).reason).toBe('GMGN_USD_MC_ONLY');
    document.querySelector('.currency')!.innerHTML = '<span class="text-text-100">USD</span><span>/</span><span class="text-text-300">SOL</span>';
    document.querySelector('.units')!.innerHTML = '<p class="text-text-100">Price</p><p>/</p><p class="text-text-300">MCap</p>';
    expect(gmgnUsdMcMode(f.root).supported).toBe(false);
    document.querySelector('.units')!.innerHTML = '<p class="text-text-300">Price</p><p>/</p><p class="text-text-100">MCap</p>';
    expect(gmgnUsdMcMode(f.root).supported).toBe(true);
  });
  it('never infers USD from a formatter, price range, missing/hidden controls or conflicting controls', () => {
    const f = fixture(); document.querySelector<HTMLElement>('.currency')!.style.display = 'none';
    expect(gmgnUsdMcMode(f.root).supported).toBe(false);
    document.querySelector('.currency')!.remove(); expect(gmgnUsdMcMode(f.root).supported).toBe(false);
  });
  it('rejects both selected, contradictory ARIA and duplicate conflicting currency groups', () => {
    const f = fixture(); document.querySelector('.currency span:last-child')!.className = 'text-text-100';
    expect(gmgnUsdMcMode(f.root).supported).toBe(false);
    fixture(); document.querySelector('.currency span:first-child')!.setAttribute('aria-selected', 'false');
    expect(gmgnUsdMcMode(document.querySelector<HTMLElement>('.tv-lightweight-charts')!).supported).toBe(false);
  });
  it('does not authorize a chart from an unrelated balance USD/SOL selector', () => {
    const f = fixture(); const unrelated = document.createElement('aside');
    document.querySelector('section')!.append(unrelated); unrelated.append(document.querySelector('.currency')!);
    expect(gmgnUsdMcMode(f.root).supported).toBe(false);
  });
});

describe('authoritative drawing plans', () => {
  it('uses saved USD cap as-is for current and four historical drawings without financial mutation', () => {
    const data = input(), saved = structuredClone(data); const plan = gmgnDrawingPlan(data);
    expect(plan.drawings).toHaveLength(5); expect(plan.unavailable).toEqual([]);
    expect(plan.drawings[0]?.price).toBe(Number('5280.763666179555222735333503354'));
    expect(data).toEqual(saved);
  });
  it('does not invent missing FX/supply from SOL basis or current quotes', () => {
    const data = input(); data.markers[0]!.usdEntry = { reason: 'HISTORICAL_SOL_USD_UNAVAILABLE', details: {} };
    expect(gmgnDrawingPlan(data).unavailable[0]?.reason).toBe('HISTORICAL_SOL_USD_UNAVAILABLE');
    data.markers[0]!.usdEntry = { priceUsd: '0.000005', details: {} };
    expect(gmgnDrawingPlan(data).drawings.some(d => d.kind === 'AVERAGE')).toBe(false);
    data.markers[0]!.usdEntry = { reason: 'https://example.invalid/?api_key=SYNTHETIC_PRIVATE_VALUE',
      marketCapUsd: '5280', details: {} };
    expect(JSON.stringify(gmgnDrawingPlan(data))).not.toContain('SYNTHETIC_PRIVATE_VALUE');
    expect(gmgnDrawingPlan(data).drawings.some(d => d.kind === 'AVERAGE')).toBe(false);
  });
  it('removes current AVG after close while retaining eligible cycles and respects history toggle', () => {
    const data = input(); data.markers = []; expect(gmgnDrawingPlan(data).drawings).toHaveLength(4);
    data.history!.visible = false; expect(gmgnDrawingPlan(data).drawings).toHaveLength(0);
  });
  it('reports archived missing historical FX/supply rather than manufacturing an omitted drawing', () => {
    const data = input(); data.history!.drawings = []; data.markers = [];
    data.history!.diagnostics.unavailableDrawings = [{ fillId: 'original-buy', side: 'BUY',
      accountId: 'account', roundId: 'round', executedAt: '2026-10-12T08:32:50.008Z',
      kind: 'BUY', reason: 'HISTORICAL_SOL_USD_UNAVAILABLE' }];
    const plan = gmgnDrawingPlan(data); expect(plan.drawings).toHaveLength(0);
    expect(plan.unavailable[0]?.reason).toBe('HISTORICAL_SOL_USD_UNAVAILABLE');
    data.history!.visible = false; expect(gmgnDrawingPlan(data).unavailable).toHaveLength(0);
  });
  it('rejects wrong owner/token, duplicate IDs and malformed cap/time evidence', () => {
    const data = input(); data.history!.drawings[0]!.mint = 'wrong'; data.history!.drawings[1]!.levelUsd = 'NaN';
    data.history!.drawings[2]!.time = 1.5;
    expect(gmgnDrawingPlan(data).unavailable).toHaveLength(3);
    const duplicate = input(); duplicate.history!.drawings.push({ ...duplicate.history!.drawings[0]! });
    expect(gmgnDrawingPlan(duplicate).drawings.some(d => d.id === 'buy-avg')).toBe(false);
    duplicate.history!.ownerId = 'other'; expect(gmgnDrawingPlan(duplicate).drawings).toHaveLength(1);
  });
});

describe('native coordinates and lifecycle', () => {
  it('associates actual Goob execution times with an existing hour candle, retaining exact fill times', () => {
    const f = fixture(); const point = gmgnMarkerCoordinate(f.binding, 1791793970);
    expect(point).toEqual({ x: 100, chartTime: 1791792000, association: 'CONTAINING_CANDLE' });
    expect(gmgnMarkerCoordinate(f.binding, 1791792000)?.association).toBe('EXACT_TIME');
    f.candleTimes.clear(); expect(gmgnMarkerCoordinate(f.binding, 1791793970)).toBeNull();
  });
  it('recomputes prices and time from host transforms through zoom, pan and vertical scaling', () => {
    const f = fixture(); const primitive = new GmgnPrimitive(f.binding, gmgnDrawingPlan(input()).drawings, () => true);
    expect(primitive.paneViews()).toBe(primitive.paneViews());
    expect(primitive.paneViews()[0]!.renderer()).toBe(primitive.paneViews()[0]!.renderer());
    primitive.updateAllViews(); expect(primitive.coordinates[0]?.executionTime).toBe(1791793970);
    expect(primitive.coordinates[0]?.x).toBe(100);
    const oldY = primitive.coordinates[0]!.y;
    f.transform(2, 15, 0.5); primitive.updateAllViews();
    expect(primitive.coordinates[0]?.x).toBe(215); expect(primitive.coordinates[0]?.y).toBe(oldY / 2);
  });
  it('does not keep an hour candle association on a one-second timeframe', () => {
    const f = fixture(); f.binding.resolution = '1s';
    expect(gmgnMarkerCoordinate(f.binding, 1791793970)).toBeNull();
    f.candleTimes.add(1791793970); expect(gmgnMarkerCoordinate(f.binding, 1791793970)?.association).toBe('EXACT_TIME');
  });
  it('attaches once, updates current AVG/additional BUY/partial exit, closes and disposes only its primitive', () => {
    const f = fixture(), renderer = new GmgnLightweightDrawings(), data = input();
    expect(renderer.render(data).prepared).toBe(5); expect(renderer.render(data).drawn).toBe(0);
    expect(f.series.attachPrimitive).toHaveBeenCalledTimes(1);
    data.markers[0]!.usdEntry!.marketCapUsd = '5500'; renderer.render(data);
    expect(f.series.attachPrimitive).toHaveBeenCalledTimes(1);
    data.markers = []; expect(renderer.render(data).prepared).toBe(4);
    renderer.invalidate(); renderer.invalidate(); expect(f.series.detachPrimitive).toHaveBeenCalledTimes(1);
    expect(f.series.setMarkers).not.toHaveBeenCalled(); expect(f.series.setData).not.toHaveBeenCalled();
    expect(f.series.update).not.toHaveBeenCalled(); expect(f.series.applyOptions).not.toHaveBeenCalled();
  });
  it('invalidates on mode change before redraw and restores with a single new primitive', async () => {
    const f = fixture(), renderer = new GmgnLightweightDrawings(); renderer.render(input());
    document.querySelector('.currency span:first-child')!.className = 'text-text-300';
    document.querySelector('.currency span:last-child')!.className = 'text-text-100';
    await Promise.resolve(); expect(f.series.detachPrimitive).toHaveBeenCalledTimes(1);
    expect(renderer.render(input()).available).toBe(false);
    document.querySelector('.currency span:first-child')!.className = 'text-text-100';
    document.querySelector('.currency span:last-child')!.className = 'text-text-300';
    renderer.render(input()); expect(f.series.attachPrimitive).toHaveBeenCalledTimes(2); renderer.invalidate();
  });
  it('rejects navigation/account changes and reacquires chart recreation or timeframe replacement', () => {
    const f = fixture(), renderer = new GmgnLightweightDrawings(); renderer.render(input());
    f.owner.memoizedProps.resolution = '1s'; renderer.render(input());
    expect(f.series.detachPrimitive).toHaveBeenCalledTimes(1);
    const changed = input(); changed.ownerId = 'other'; changed.history!.ownerId = 'other';
    renderer.render(changed); expect(f.series.detachPrimitive).toHaveBeenCalledTimes(2);
    vi.stubGlobal('location', new URL('https://gmgn.ai/sol/token/wrong'));
    expect(renderer.render(input()).reason).toBe('GMGN_CHART_IDENTITY_UNVERIFIED');
    expect(f.series.detachPrimitive).toHaveBeenCalledTimes(3);
  });
  it('waits for delayed chart initialization and reports missing execution candles without a fake X', () => {
    const renderer = new GmgnLightweightDrawings(); expect(renderer.render(input()).reason).toBe('GMGN_CHART_INITIALIZING');
    const f = fixture(); f.candleTimes.clear(); const result = renderer.render(input());
    expect(result.prepared).toBe(3); expect(result.unavailableDrawings?.filter(d => d.reason === 'GMGN_EXECUTION_CANDLE_UNAVAILABLE')).toHaveLength(2);
    renderer.invalidate();
  });
  it('does not draw anything when identity/units are invalidated between layout and native painting', () => {
    const f = fixture(); let valid = true;
    const primitive = new GmgnPrimitive(f.binding, gmgnDrawingPlan(input()).drawings, () => valid);
    primitive.updateAllViews(); valid = false;
    const target = { useMediaCoordinateSpace: vi.fn() };
    primitive.paneViews()[0]!.renderer().draw(target); expect(target.useMediaCoordinateSpace).not.toHaveBeenCalled();
  });
  it('cannot resurrect detached drawings through a retained native view callback', () => {
    const f = fixture(), primitive = new GmgnPrimitive(f.binding, gmgnDrawingPlan(input()).drawings, () => true);
    const retained = primitive.paneViews()[0]!.renderer(); primitive.updateAllViews(); primitive.detached();
    primitive.updateAllViews(); const target = { useMediaCoordinateSpace: vi.fn() };
    retained.draw(target); expect(target.useMediaCoordinateSpace).not.toHaveBeenCalled();
    expect(primitive.coordinates).toHaveLength(0); expect(primitive.paintedCount).toBe(0);
  });
  it('handles disposed coordinate APIs with constant reasons and no original exception output', () => {
    const f = fixture(), renderer = new GmgnLightweightDrawings();
    const synthetic = 'SYNTHETIC_GMGN_ERROR_SECRET_0123456789';
    f.series.priceToCoordinate = () => { throw new Error(`https://example.invalid/?api_key=${synthetic}`); };
    const result = renderer.render(input()); expect(result.available).toBe(false);
    expect(result.reason).toBe('GMGN_COORDINATE_API_UNAVAILABLE'); expect(JSON.stringify(result)).not.toContain(synthetic);
    renderer.invalidate();
  });
  it('reinitializes the GMGN bridge with one timer/listener and no orphaned primitive', () => {
    vi.useFakeTimers(); const f = fixture(); vi.spyOn(window, 'postMessage').mockImplementation(() => {});
    const receive = () => window.dispatchEvent(new MessageEvent('message', { source: window,
      origin: 'https://gmgn.ai', data: { channel: 'paperfund:chart:v1', direction: 'UPDATE', value: input() } }));
    installChartBridge(); receive(); expect(f.series.attachPrimitive).toHaveBeenCalledTimes(1);
    installChartBridge(); expect(f.series.detachPrimitive).toHaveBeenCalledTimes(1); receive();
    expect(f.series.attachPrimitive).toHaveBeenCalledTimes(2); expect(vi.getTimerCount()).toBe(1);
  });
  it('never falls back to the old generic SOL drawing API when GMGN mode is unsupported', () => {
    const f = fixture(); const createShape = vi.fn();
    vi.stubGlobal('tvWidget', { activeChart: () => ({ createShape, removeEntity: vi.fn(),
      symbolExt: () => ({ ticker: mint, currency_code: 'SOL', unit_id: 'price' }) }) });
    document.querySelector('.currency span:first-child')!.className = 'text-text-300';
    document.querySelector('.currency span:last-child')!.className = 'text-text-100';
    vi.spyOn(window, 'postMessage').mockImplementation(() => {});
    installChartBridge(); window.dispatchEvent(new MessageEvent('message', { source: window,
      origin: 'https://gmgn.ai', data: { channel: 'paperfund:chart:v1', direction: 'UPDATE', value: input() } }));
    expect(createShape).not.toHaveBeenCalled(); expect(f.series.attachPrimitive).not.toHaveBeenCalled();
  });
  it('restores execution coordinates on native candle arrival without inventing a bar or changing fills', () => {
    const f = fixture(), data = input(), preserved = structuredClone(data);
    f.binding.resolution = '1s'; f.candleTimes.clear();
    const primitive = new GmgnPrimitive(f.binding, gmgnDrawingPlan(data).drawings, () => true);
    primitive.updateAllViews(); expect(primitive.coordinates).toHaveLength(0);
    f.candleTimes.add(1791793970); f.candleTimes.add(1791793975);
    primitive.updateAllViews(); expect(primitive.coordinates).toHaveLength(2);
    expect(primitive.coordinates.every(point => point.association === 'EXACT_TIME')).toBe(true);
    expect(data).toEqual(preserved);
  });
  it('paints native price-aligned lines and PF-labelled time/price markers, follows resize, and clips off-screen values', () => {
    const f = fixture(), primitive = new GmgnPrimitive(f.binding, gmgnDrawingPlan(input()).drawings, () => true);
    primitive.updateAllViews();
    const context = Object.fromEntries(['save', 'restore', 'beginPath', 'rect', 'clip', 'setLineDash',
      'arc', 'fill', 'fillText', 'moveTo', 'lineTo', 'stroke'].map(method => [method, vi.fn()])) as unknown as CanvasRenderingContext2D;
    const target = (width: number, height: number) => ({ useMediaCoordinateSpace: (draw: (scope: {
      context: CanvasRenderingContext2D; mediaSize: { width: number; height: number } }) => void) =>
      draw({ context, mediaSize: { width, height } }) });
    primitive.paneViews()[0]!.renderer().draw(target(340, 280));
    expect(primitive.paintedCount).toBe(5);
    expect(context.arc).toHaveBeenCalledWith(100, Number('5280.763666179555222735333503354') / 30, 7, 0, Math.PI * 2);
    expect(context.fillText).toHaveBeenCalledWith('PF BUY 08:32:50Z', 100, Number('5280.763666179555222735333503354') / 30 + 9);
    expect(context.moveTo).toHaveBeenCalledWith(0, Number('4835.449695940729125883100226964') / 30);
    primitive.paneViews()[0]!.renderer().draw(target(510, 280));
    expect(context.lineTo).toHaveBeenCalledWith(510, Number('4835.449695940729125883100226964') / 30);
    primitive.paneViews()[0]!.renderer().draw(target(50, 280));
    expect(primitive.paintedCount).toBe(3); // Off-screen X is not clamped into a fake marker.
    primitive.paneViews()[0]!.renderer().draw(target(340, 10));
    expect(primitive.paintedCount).toBe(0); // Off-screen price is not clamped into a fake line.
  });
});
