import type { ChartMarkers } from './chart-marker.js';

interface Candle { time: number; close: number }
export interface GmgnTimeScale {
  timeToCoordinate(time: number): number | null;
}
export interface GmgnChartApi { timeScale(): GmgnTimeScale }
interface MediaScope {
  context: CanvasRenderingContext2D;
  mediaSize: { width: number; height: number };
}
interface CanvasTarget { useMediaCoordinateSpace(draw: (scope: MediaScope) => void): void }
export interface GmgnSeriesApi {
  seriesType(): string;
  priceToCoordinate(price: number): number | null;
  data(): readonly Candle[];
  attachPrimitive(primitive: GmgnPrimitive): void;
  detachPrimitive(primitive: GmgnPrimitive): void;
}
export interface GmgnBinding {
  root: HTMLElement;
  chart: GmgnChartApi;
  series: GmgnSeriesApi;
  resolution: string;
  mint: string;
}
export interface GmgnDrawing {
  id: string;
  kind: 'AVERAGE' | 'BUY_AVG' | 'SELL_AVG' | 'BUY' | 'SELL';
  price: number;
  time: number;
  label: string;
}
interface Unavailable { drawingId: string; reason: string }
const own = (value: unknown, key: string): unknown => {
  if (!value || !['object', 'function'].includes(typeof value)) return undefined;
  return Object.getOwnPropertyDescriptor(value, key)?.value;
};
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object');

/** Validate membership from the current root: shared children can have stale parent links. */
function currentAncestry(fiber: unknown): unknown[] {
  const expected: unknown[] = [], seen = new Set<unknown>();
  for (let node = fiber; node; node = own(node, 'return')) {
    if (seen.has(node) || expected.length >= 64) return [];
    seen.add(node); expected.push(node);
  }
  const top = expected.at(-1);
  const active = own(own(top, 'stateNode'), 'current');
  if (!active || (active !== top && active !== own(top, 'alternate'))) return [];
  const path: unknown[] = [active];
  for (const target of expected.slice(0, -1).reverse()) {
    let child = own(path.at(-1), 'child'), found: unknown;
    const siblings = new Set<unknown>();
    while (child && siblings.size < 256 && !siblings.has(child)) {
      siblings.add(child);
      if (child === target || child === own(target, 'alternate')) { found = child; break; }
      child = own(child, 'sibling');
    }
    if (!found) return [];
    path.push(found);
  }
  return path.reverse();
}

/** Bounded chart-owner refs, not global stores, constructors or arbitrary app state. */
export function locateGmgnChart(mint: string): GmgnBinding | null {
  const matches: GmgnBinding[] = [];
  for (const root of document.querySelectorAll<HTMLElement>('.tv-lightweight-charts')) {
    const rect = root.getBoundingClientRect();
    if (!root.isConnected || rect.width <= 0 || rect.height <= 0 ||
      getComputedStyle(root).visibility === 'hidden' || getComputedStyle(root).display === 'none') continue;
    let element: HTMLElement | null = root.parentElement;
    for (let depth = 0; element && depth < 4; depth++, element = element.parentElement) {
      const key = Object.getOwnPropertyNames(element).find(name => /^__reactFiber\$/.test(name));
      if (!key) continue;
      const ancestry = currentAncestry(own(element, key));
      for (let level = 0; level < Math.min(6, ancestry.length); level++) {
        const fiber = ancestry[level];
        const props = own(fiber, 'memoizedProps');
        if (!object(props) || typeof props['resolution'] !== 'string' ||
          !Array.isArray(props['data']) || !Array.isArray(props['markers'])) continue;
        let identity = false;
        for (const token of ancestry.slice(level + 1, level + 7)) {
          const binding = own(token, 'memoizedProps');
          if (own(binding, 'chain') === 'sol' && own(binding, 'address') === mint) identity = true;
          else if (own(binding, 'chain') !== undefined && own(binding, 'address') !== undefined) {
            identity = false; break;
          }
        }
        if (!identity) continue;
        const charts: GmgnChartApi[] = [];
        const series: GmgnSeriesApi[] = [];
        let container = false;
        let hook = own(fiber, 'memoizedState');
        for (let index = 0; hook && index < 48; index++, hook = own(hook, 'next')) {
          const ref = own(own(hook, 'memoizedState'), 'current');
          if (ref instanceof HTMLElement && ref === root.parentElement) container = true;
          if (!object(ref)) continue;
          if (typeof ref['timeScale'] === 'function' && typeof ref['subscribeCrosshairMove'] === 'function')
            charts.push(ref as unknown as GmgnChartApi);
          if (typeof ref['seriesType'] === 'function' && typeof ref['priceToCoordinate'] === 'function' &&
            typeof ref['attachPrimitive'] === 'function' && typeof ref['detachPrimitive'] === 'function' &&
            typeof ref['data'] === 'function' && (ref as unknown as GmgnSeriesApi).seriesType() === 'Candlestick')
            series.push(ref as unknown as GmgnSeriesApi);
        }
        if (container && charts.length === 1 && series.length === 1 &&
          !matches.some(item => item.root === root && item.chart === charts[0] && item.series === series[0]))
          matches.push({ root, chart: charts[0]!, series: series[0]!, resolution: props['resolution'], mint });
      }
    }
  }
  return matches.length === 1 ? matches[0]! : null;
}

const unitLabels = ['USD', 'SOL', 'Price', 'MC', 'MCap', 'MarketCap', 'Market Cap'];
function visible(element: Element): boolean {
  const r = element.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return false;
  for (let parent: Element | null = element; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
  }
  return true;
}
function active(element: Element): boolean | null {
  const attrs = ['aria-pressed', 'aria-selected', 'aria-checked'].map(key => element.getAttribute(key));
  const states = attrs.filter(value => value === 'true' || value === 'false');
  const data = element.getAttribute('data-state');
  if (['active', 'on'].includes(data ?? '')) states.push('true');
  if (['inactive', 'off'].includes(data ?? '')) states.push('false');
  const selected = element.classList.contains('text-text-100');
  const unselected = element.classList.contains('text-text-300');
  if (selected && unselected) return null;
  if (selected !== unselected) states.push(selected ? 'true' : 'false');
  return states.length && new Set(states).size === 1 ? states[0] === 'true' : null;
}
function selectedGroups(scope: Element, family: 'currency' | 'unit'): { label: string; group: Element }[] {
  const groups = new Set<Element>();
  for (const leaf of scope.querySelectorAll('span,p,button,[role="radio"],[role="tab"]')) {
    if (!unitLabels.includes(leaf.textContent?.trim() ?? '') || !visible(leaf)) continue;
    let parent = leaf.parentElement;
    for (let depth = 0; parent && depth < 3 && scope.contains(parent); depth++, parent = parent.parentElement) {
      const text = parent.textContent?.replace(/\s/g, '') ?? '';
      const match = family === 'currency' ? /^(USD\/?SOL|SOL\/?USD)$/ :
        /^(Price\/?(MC|MCap|MarketCap)|(MC|MCap|MarketCap)\/?Price)$/;
      if (match.test(text)) { groups.add(parent); break; }
    }
  }
  const selected: { label: string; group: Element }[] = [];
  for (const group of groups) {
    const leaves = [...group.querySelectorAll('span,p,button,[role="radio"],[role="tab"]')]
      .filter(element => unitLabels.includes(element.textContent?.trim() ?? '') && visible(element) &&
        ![...element.children].some(child => unitLabels.includes(child.textContent?.trim() ?? '')));
    if (leaves.length !== 2) continue;
    const chosen = leaves.filter(element => active(element) === true);
    const other = leaves.filter(element => active(element) === false);
    if (chosen.length === 1 && other.length === 1) selected.push({ label: chosen[0]!.textContent!.trim(), group });
  }
  return selected;
}
/** Positive selected-control evidence only. No price magnitude, FX or default assumption. */
export function gmgnUsdMcMode(root: HTMLElement): { supported: boolean; reason: string; scope?: HTMLElement } {
  let scope: HTMLElement | null = root.parentElement;
  for (let depth = 0; scope && depth < 6 && !['BODY', 'HTML'].includes(scope.tagName);
    depth++, scope = scope.parentElement) {
    if (scope.querySelectorAll('.tv-lightweight-charts').length !== 1) continue;
    const unitControls = selectedGroups(scope, 'unit'), currencyControls = selectedGroups(scope, 'currency');
    const units = new Set(unitControls.map(control => control.label));
    const currencies = new Set(currencyControls.map(control => control.label));
    if (units.size > 1 || currencies.size > 1) return { supported: false, reason: 'GMGN_UNITS_AMBIGUOUS' };
    if (units.has('Price') || currencies.has('SOL')) return { supported: false, reason: 'GMGN_USD_MC_ONLY', scope };
    if (units.size === 1 && currencies.size === 1 && currencies.has('USD') &&
      [...units].every(unit => ['MC', 'MCap', 'MarketCap', 'Market Cap'].includes(unit))) {
      // Both selections must be in one toolbar, not a balance/trade table elsewhere.
      for (const unit of unitControls) {
        let toolbar = unit.group.parentElement;
        for (let parent = 0; toolbar && parent < 4 && scope.contains(toolbar);
          parent++, toolbar = toolbar.parentElement) {
          if (toolbar.contains(root)) break;
          if (currencyControls.some(currency => toolbar!.contains(currency.group)))
            return { supported: true, reason: 'GMGN_USD_MC_VERIFIED', scope };
        }
      }
    }
  }
  return { supported: false, reason: 'GMGN_UNITS_UNVERIFIED' };
}

function level(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d+(\.\d+)?$/.test(value)) return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}
export function gmgnDrawingPlan(data: ChartMarkers) {
  const drawings: GmgnDrawing[] = [], unavailable: Unavailable[] = [];
  const average = data.markers.find(marker => marker.kind === 'AVERAGE');
  if (average) {
    const price = average.usdEntry?.reason === undefined ? level(average.usdEntry?.marketCapUsd) : null;
    if (price === null) unavailable.push({ drawingId: average.id,
      reason: average.usdEntry?.reason && /^[A-Z][A-Z0-9_]{0,95}$/.test(average.usdEntry.reason)
        ? average.usdEntry.reason : 'VERIFIED_USD_MARKET_CAP_UNAVAILABLE' });
    else drawings.push({ id: average.id, kind: 'AVERAGE', price, time: average.time, label: 'PF AVG' });
  }
  const history = data.history;
  if (history?.visible && history.ownerId === data.ownerId && history.mint === data.mint) {
    for (const omitted of (history.diagnostics.unavailableDrawings ?? []).slice(0, 156))
      unavailable.push({ drawingId: `unavailable:${omitted.fillId}:${omitted.kind}`,
        reason: /^[A-Z][A-Z0-9_]{0,95}$/.test(omitted.reason) ? omitted.reason : 'DRAWING_EVIDENCE_UNAVAILABLE' });
    for (const drawing of history.drawings) {
      const price = level(drawing.levelUsd);
      if (drawing.ownerId !== data.ownerId || drawing.mint !== data.mint || !drawing.accountId || !drawing.roundId ||
        price === null || !Number.isSafeInteger(drawing.time) || drawing.time <= 0) {
        unavailable.push({ drawingId: drawing.id, reason: 'INVALID_OR_UNSCOPED_DRAWING_EVIDENCE' }); continue;
      }
      drawings.push({ id: drawing.id, kind: drawing.kind, price, time: drawing.time,
        label: drawing.kind === 'BUY_AVG' ? 'PF BUY AVG' : drawing.kind === 'SELL_AVG' ? 'PF SELL AVG' :
          drawing.kind === 'BUY' ? 'PF BUY' : 'PF SELL' });
    }
  }
  const ids = new Set<string>(), duplicates = new Set<string>();
  for (const drawing of drawings) { if (ids.has(drawing.id)) duplicates.add(drawing.id); ids.add(drawing.id); }
  for (const id of duplicates) unavailable.push({ drawingId: id, reason: 'DUPLICATE_DRAWING_ID' });
  return { drawings: drawings.filter(drawing => !duplicates.has(drawing.id)), unavailable };
}

export function gmgnResolutionSeconds(resolution: string): number | null {
  const supported: Record<string, number> = { '1s': 1, '15s': 15, '30s': 30, '1m': 60,
    '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '12h': 43200, '1D': 86400, '1d': 86400 };
  return supported[resolution] ?? null;
}
/** Existing candle association only; exact fill time is retained, never interpolated. */
export function gmgnMarkerCoordinate(binding: GmgnBinding, time: number,
  existingCandles?: ReadonlySet<number>, scale = binding.chart.timeScale()) {
  const exact = scale.timeToCoordinate(time);
  if (exact !== null && Number.isFinite(exact)) return { x: exact, chartTime: time, association: 'EXACT_TIME' };
  const seconds = gmgnResolutionSeconds(binding.resolution);
  if (!seconds) return null;
  const chartTime = Math.floor(time / seconds) * seconds;
  const candles = existingCandles ?? new Set(binding.series.data()
    .filter(candle => Number.isFinite(candle.close)).map(candle => candle.time));
  if (!candles.has(chartTime)) return null;
  const x = scale.timeToCoordinate(chartTime);
  return x !== null && Number.isFinite(x) ? { x, chartTime, association: 'CONTAINING_CANDLE' } : null;
}

/** One owned native series primitive. Host draw lifecycle owns scaling and clipping. */
export class GmgnPrimitive {
  private requestUpdate: (() => void) | null = null;
  private points: { drawing: GmgnDrawing; y: number; x?: number }[] = [];
  readonly coordinates: { drawingId: string; executionTime: number; chartTime: number; x: number; y: number; association: string }[] = [];
  readonly unavailable: Unavailable[] = [];
  private painted = new Set<string>();
  private disposed = false;
  private readonly renderer = { draw: (target: CanvasTarget) => this.draw(target) };
  private readonly views = [{ zOrder: () => 'top' as const, renderer: () => this.renderer }];
  get paintedCount() { return this.painted.size; }
  constructor(private binding: GmgnBinding, private drawings: GmgnDrawing[], private valid: () => boolean) {}
  attached({ requestUpdate }: { requestUpdate: () => void }) { this.disposed = false; this.requestUpdate = requestUpdate; requestUpdate(); }
  detached() {
    this.disposed = true; this.requestUpdate = null; this.drawings = [];
    this.points = []; this.coordinates.length = 0; this.painted.clear();
  }
  replace(drawings: GmgnDrawing[]) {
    if (JSON.stringify(this.drawings) === JSON.stringify(drawings)) return;
    this.drawings = drawings; this.painted.clear(); this.requestUpdate?.();
  }
  updateAllViews() {
    this.points = []; this.coordinates.length = 0; this.unavailable.length = 0;
    if (this.disposed || !this.valid()) return;
    try {
      const candles = new Set(this.binding.series.data().filter(candle => Number.isFinite(candle.close)).map(candle => candle.time));
      const scale = this.binding.chart.timeScale();
      for (const drawing of this.drawings) {
        const y = this.binding.series.priceToCoordinate(drawing.price);
        if (y === null || !Number.isFinite(y)) {
          this.unavailable.push({ drawingId: drawing.id, reason: 'GMGN_PRICE_COORDINATE_UNAVAILABLE' }); continue;
        }
        if (drawing.kind === 'BUY' || drawing.kind === 'SELL') {
          const coordinate = gmgnMarkerCoordinate(this.binding, drawing.time, candles, scale);
          if (!coordinate) { this.unavailable.push({ drawingId: drawing.id, reason: 'GMGN_EXECUTION_CANDLE_UNAVAILABLE' }); continue; }
          this.points.push({ drawing, x: coordinate.x, y });
          this.coordinates.push({ drawingId: drawing.id, executionTime: drawing.time,
            chartTime: coordinate.chartTime, x: coordinate.x, y, association: coordinate.association });
        } else this.points.push({ drawing, y });
      }
    } catch {
      this.points = []; this.coordinates.length = 0; this.painted.clear(); this.unavailable.length = 0;
      for (const drawing of this.drawings)
        this.unavailable.push({ drawingId: drawing.id, reason: 'GMGN_COORDINATE_API_UNAVAILABLE' });
    }
  }
  paneViews() { return this.views; }
  private draw(target: CanvasTarget) {
    this.painted.clear();
    if (this.disposed || !this.valid()) return;
    target.useMediaCoordinateSpace(({ context, mediaSize }) => {
      context.save();
      try {
        context.beginPath(); context.rect(0, 0, mediaSize.width, mediaSize.height); context.clip();
        context.font = '10px sans-serif'; context.lineWidth = 1;
        for (const { drawing, y, x } of this.points) {
          if (y < 0 || y > mediaSize.height) continue;
          const color = drawing.kind.startsWith('SELL') ? '#f17885' : '#74e6aa';
          context.strokeStyle = color; context.fillStyle = color;
          if (x !== undefined) {
            if (x < 0 || x > mediaSize.width) continue;
            context.setLineDash([]); context.beginPath(); context.arc(x, y, 7, 0, Math.PI * 2); context.fill();
            context.fillStyle = '#101915'; context.textAlign = 'center'; context.textBaseline = 'middle';
            context.fillText(drawing.kind === 'BUY' ? 'B' : 'S', x, y);
            context.fillStyle = color;
            context.textBaseline = drawing.kind === 'BUY' ? 'top' : 'bottom';
            const executionTime = new Date(drawing.time * 1000).toISOString().slice(11, 19);
            context.fillText(`${drawing.label} ${executionTime}Z`, x, y + (drawing.kind === 'BUY' ? 9 : -9));
          } else {
            context.setLineDash(drawing.kind === 'AVERAGE' ? [] : [4, 3]);
            context.beginPath(); context.moveTo(0, y); context.lineTo(mediaSize.width, y); context.stroke();
            context.textAlign = 'left'; context.textBaseline = 'bottom';
            context.fillText(drawing.label, 5, y - 2);
          }
          this.painted.add(drawing.id);
        }
      } finally { context.restore(); }
    });
  }
}

export class GmgnLightweightDrawings {
  private binding: GmgnBinding | null = null;
  private primitive: GmgnPrimitive | null = null;
  private scope = '';
  private observer: MutationObserver | null = null;
  private latest: ChartMarkers | null = null;
  private preview: { binding: GmgnBinding; owner: string; url: string; enabled: boolean;
    control: HTMLElement; button: HTMLButtonElement } | null = null;
  invalidate(clearPreview = true) {
    if (clearPreview) { this.preview?.control.remove(); this.preview = null; }
    this.observer?.disconnect(); this.observer = null;
    if (this.binding && this.primitive) {
      try { this.binding.series.detachPrimitive(this.primitive); } catch { /* Host already disposed. */ }
    }
    this.primitive = null; this.binding = null; this.scope = '';
  }
  private previewEligible(binding: GmgnBinding): boolean {
    try {
      if (localStorage.getItem('paperfund:debug') !== '1') return false;
      let scope: HTMLElement | null = binding.root.parentElement;
      for (let depth = 0; scope && depth < 6 && !['BODY', 'HTML'].includes(scope.tagName);
        depth++, scope = scope.parentElement) {
        if (scope.querySelectorAll('.tv-lightweight-charts').length !== 1) continue;
        const units = selectedGroups(scope, 'unit'), currencies = selectedGroups(scope, 'currency');
        if (!units.length || units.some(item => item.label === 'Price') ||
          currencies.some(item => item.label !== 'USD')) continue;
        const headers = [...document.querySelectorAll('[data-sentry-component="renderPrice"]')]
          .filter(element => visible(element) && /^\$\s*\d[\d.,]*\s*[KMBT]?$/i.test(element.textContent?.trim() ?? ''));
        // These are preview prerequisites, not proof that the series is USD.
        return headers.length === 1 && binding.series.data().some(candle =>
          Number.isFinite(candle.close) && candle.close > 0);
      }
    } catch { /* No preview when diagnostics or public chart reads are unavailable. */ }
    return false;
  }
  private preparePreview(binding: GmgnBinding, data: ChartMarkers) {
    if (this.preview && (this.preview.binding.chart !== binding.chart ||
      this.preview.binding.series !== binding.series || this.preview.binding.root !== binding.root ||
      this.preview.binding.resolution !== binding.resolution || this.preview.owner !== data.ownerId ||
      this.preview.url !== data.url || !this.previewEligible(binding))) this.invalidate();
    if (this.preview || !this.previewEligible(binding)) return;
    const control = document.createElement('div'), button = document.createElement('button');
    control.dataset['paperfundGmgnPreview'] = 'control';
    control.style.cssText = 'position:absolute;top:28px;left:8px;z-index:50;max-width:260px;background:#172124;color:#ffcf75;padding:5px;font:11px sans-serif;pointer-events:auto';
    button.type = 'button';
    button.textContent = 'Preview USD MCap (unverified)';
    button.title = 'Operator preview only. Confirm the GMGN chart is USD MCap. Currency binding is unverified.';
    control.append(button); binding.root.parentElement!.append(control);
    const preview = { binding, owner: data.ownerId!, url: data.url, enabled: false, control, button };
    this.preview = preview;
    button.addEventListener('click', () => {
      if (this.preview !== preview || !this.previewEligible(binding) || location.href !== preview.url) return;
      preview.enabled = !preview.enabled;
      button.textContent = preview.enabled ? 'UNVERIFIED USD MCap PREVIEW — Stop' : 'Preview USD MCap (unverified)';
      if (!preview.enabled) this.invalidate(false);
      if (this.latest) this.render(this.latest);
    });
  }
  render(data: ChartMarkers) {
    this.latest = data;
    try { return this.reconcile(data); }
    catch { this.invalidate(); return { available: false, reason: 'GMGN_CHART_API_UNAVAILABLE', drawn: 0 }; }
  }
  private reconcile(data: ChartMarkers) {
    const mint = /^\/sol\/token\/([^/]+)\/?$/.exec(location.pathname)?.[1];
    if (location.hostname !== 'gmgn.ai' || data.url !== location.href || data.context !== mint ||
      data.mint !== mint || !data.ownerId) {
      this.invalidate(); return { available: false, reason: 'GMGN_CHART_IDENTITY_UNVERIFIED', drawn: 0 };
    }
    const binding = locateGmgnChart(data.mint);
    if (!binding) { this.invalidate(); return { available: false, reason: 'GMGN_CHART_INITIALIZING', drawn: 0 }; }
    const mode = gmgnUsdMcMode(binding.root);
    if (!mode.supported && mode.reason === 'GMGN_UNITS_UNVERIFIED') this.preparePreview(binding, data);
    else if (this.preview) { this.preview.control.remove(); this.preview = null; }
    const preview = !mode.supported && this.preview?.enabled === true && this.previewEligible(binding);
    if (!mode.supported && !preview) { this.invalidate(false); return { available: false, reason: mode.reason, drawn: 0 }; }
    const scope = JSON.stringify([data.ownerId, data.context, data.url, binding.resolution, preview]);
    const valid = () => {
      try {
        const currentMode = gmgnUsdMcMode(binding.root);
        const unitsValid = preview ? this.preview?.enabled === true &&
          currentMode.reason === 'GMGN_UNITS_UNVERIFIED' && this.previewEligible(binding) : currentMode.supported;
        if (this.scope !== scope || data.url !== location.href || !binding.root.isConnected || !unitsValid) return false;
        const current = locateGmgnChart(data.mint);
        return Boolean(current && current.chart === binding.chart && current.series === binding.series &&
          current.root === binding.root && current.resolution === binding.resolution);
      } catch { return false; }
    };
    if (this.binding?.chart !== binding.chart || this.binding?.series !== binding.series || this.scope !== scope) {
      this.invalidate(false); this.binding = binding; this.scope = scope;
      this.primitive = new GmgnPrimitive(binding, [], valid);
      binding.series.attachPrimitive(this.primitive);
      if (mode.scope) {
        this.observer = new MutationObserver(() => {
          if (!valid()) this.invalidate();
        });
        this.observer.observe(mode.scope, { childList: true, attributes: true, subtree: true,
          attributeFilter: ['class', 'style', 'aria-selected', 'aria-pressed', 'aria-checked', 'data-state'] });
      }
    }
    const plan = gmgnDrawingPlan(data);
    this.primitive!.replace(preview ? plan.drawings.map(drawing => ({ ...drawing, label: `PREVIEW · ${drawing.label}` })) : plan.drawings);
    this.primitive!.updateAllViews();
    const unavailableDrawings = [...plan.unavailable, ...this.primitive!.unavailable];
    const prepared = plan.drawings.length - this.primitive!.unavailable.length;
    return { available: prepared > 0,
      reason: prepared ? preview ? 'GMGN_UNVERIFIED_PREVIEW_ATTACHED' : 'GMGN_USD_MC_PRIMITIVE_ATTACHED' :
        unavailableDrawings[0]?.reason || 'GMGN_DRAWING_EVIDENCE_UNAVAILABLE',
      drawn: this.primitive!.paintedCount,
      prepared,
      preview, currencyVerified: !preview,
      currency: 'USD', unit: 'market-cap', timeframe: binding.resolution,
      coordinates: [...this.primitive!.coordinates], unavailableDrawings, visualAcceptance: 'PENDING' };
  }
}
