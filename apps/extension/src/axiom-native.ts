import { AxiomHistoricalDrawings } from './axiom-history.js';
import type { TradeHistoryPlan } from './trade-history-chart.js';
import { readAxiomSymbol, verifyAxiomSymbol, symbolSnapshotKey } from './axiom-symbol.js';
import { operatorDiagnostic } from './diagnostics.js';
import { ChartDiagnosis, chartContextInventory } from './chart-diagnostics.js';
import type { PaperfundMarker } from './chart-history.js';

interface AxiomSymbol {
  ticker?: string;
  [key: string]: unknown;
}
export interface AxiomNativeChart {
  symbolExt(): AxiomSymbol | null;
  symbol?(): string;
  onSymbolChanged?(): {
    subscribe(context: null, handler: () => void): void;
    unsubscribe(context: null, handler: () => void): void;
  };
  createShape(
    point: { price: number; time?: number },
    options: Record<string, unknown>,
  ): Promise<string | null>;
  removeEntity(id: string): void;
  getAllShapes?(): { id: string }[];
}
export interface AxiomChartData {
  url: string;
  context: string;
  mint: string | null;
  markers: PaperfundMarker[];
  ownerId?: string;
  history?: TradeHistoryPlan;
  marketBinding?: { requestedContext: string; mint: string; marketId?: string };
}
export interface AxiomLineStatus {
  available: boolean;
  reason: string;
  drawn: number;
  level?: number;
  currency?: 'SOL' | 'USD';
  drawingId?: string;
  unit?: 'price' | 'market-cap';
}

/** Current Axiom's own versioned ticker, observed in its public symbol serializer.
 * Pair address, token mint and quote currency are explicit; the ticker has no unit field.
 */
export function axiomNativeIdentity(ticker: string | undefined, data: AxiomChartData) {
  return verifyAxiomSymbol(
    {
      identifier: ticker ?? null,
      rawSymbol: null,
      metadata: {},
      availableFields: [],
      readErrors: [],
    },
    data,
  ).identity;
}

/** Axiom renders its unit/currency header as two inline colored spans (no ARIA state).
 * Match the unit's active color to the *explicit ticker currency's* active color.
 * No luminance heuristic, preferences, price magnitudes or axis coordinates are used.
 */
export function axiomNativeUnit(doc: Document, currency: 'SOL' | 'USD') {
  const groups = [...doc.querySelectorAll('span')]
    .map((span) => span.parentElement)
    .filter((parent): parent is HTMLElement => parent !== null);
  const currencyGroups = groups.filter(
    (parent) => parent.textContent?.replace(/\s/g, '') === 'USD/SOL',
  );
  const unitGroups = groups.filter(
    (parent) => parent.textContent?.replace(/\s/g, '') === 'MarketCap/Price',
  );
  const colors = new Set(
    currencyGroups.flatMap((parent) => {
      const spans = [...parent.children].filter(
        (child) => child.tagName === 'SPAN',
      ) as HTMLElement[];
      const active = spans.find((span) => span.textContent === currency)?.style.color;
      const inactive = spans.find((span) => span.textContent !== currency)?.style.color;
      return active && inactive && active !== inactive ? [active] : [];
    }),
  );
  if (colors.size !== 1) return null;
  const units = new Set(
    unitGroups.flatMap((parent) => {
      const spans = [...parent.children].filter(
        (child) => child.tagName === 'SPAN',
      ) as HTMLElement[];
      if (spans.length !== 2 || !spans.every((span) => span.style.color)) return [];
      const active = spans.filter((span) => colors.has(span.style.color));
      if (active.length !== 1) return [];
      return active[0]!.textContent === 'MarketCap'
        ? ['market-cap' as const]
        : active[0]!.textContent === 'Price'
          ? ['price' as const]
          : [];
    }),
  );
  return units.size === 1 ? [...units][0]! : null;
}

export function axiomAverageLevel(
  marker: PaperfundMarker,
  unit: 'price' | 'market-cap',
  currency: 'SOL' | 'USD',
) {
  if (currency === 'USD' && marker.usdEntry) {
    if (marker.usdEntry.reason) return { reason: marker.usdEntry.reason };
    const level = Number(
      unit === 'market-cap' ? marker.usdEntry.marketCapUsd : marker.usdEntry.priceUsd,
    );
    return Number.isFinite(level) && level > 0 ? { level } : { reason: 'INVALID_CHART_LEVEL' };
  }
  const sol = Number(unit === 'market-cap' ? marker.marketCapSol : marker.priceSol);
  if (!Number.isFinite(sol) || sol <= 0)
    return {
      reason:
        unit === 'market-cap'
          ? 'AUTHORITATIVE_SUPPLY_UNAVAILABLE'
          : 'AUTHORITATIVE_AVERAGE_UNAVAILABLE',
    };
  const fx = currency === 'USD' ? Number(marker.solUsd) : 1;
  if (!Number.isFinite(fx) || fx <= 0) return { reason: 'HISTORICAL_SOL_USD_UNAVAILABLE' };
  const level = sol * fx;
  return Number.isFinite(level) && level > 0 ? { level } : { reason: 'INVALID_CHART_LEVEL' };
}

/** A single native AVG drawing. TradingView owns all scale/zoom/pan/resize transforms.
 * Access mirrors the widget's actual _innerAPI(): iframe.contentWindow.tradingViewApi.
 * Nothing is injected into host constructors or its datafeed; no pixel positioning.
 */
export class AxiomNativeAverage {
  private histories = new AxiomHistoricalDrawings();
  private historyScope = '';
  private entity: { chart: AxiomNativeChart; id: string; fingerprint: string } | null = null;
  private revision = 0;
  private creating = false;
  private observed: { chart: AxiomNativeChart; ticker: string; unit: string } | null = null;
  private pendingTicker: string | null = null;
  private documents = new WeakSet<Document>();
  private symbolSubscriptions = new Map<
    AxiomNativeChart,
    { frame: HTMLIFrameElement; dispose: () => void }
  >();
  get hasSymbolEvents() {
    return this.symbolSubscriptions.size > 0;
  }
  constructor(private onSymbolChange: () => void = () => {}) {}
  private watchSymbol(chart: AxiomNativeChart, frame: HTMLIFrameElement) {
    if (this.symbolSubscriptions.has(chart) || typeof chart.onSymbolChanged !== 'function') return;
    for (const [previous, watch] of this.symbolSubscriptions)
      if (watch.frame === frame) {
        try {
          watch.dispose();
        } catch {
          /* Host replaced its chart wrapper. */
        }
        this.symbolSubscriptions.delete(previous);
      }
    try {
      const subscription = chart.onSymbolChanged();
      const handler = () => {
        this.revision++;
        this.remove('HOST_SYMBOL_RESOLVED');
        this.histories.clear('HOST_SYMBOL_RESOLVED');
        this.pendingTicker = null;
        this.observed = null;
        this.onSymbolChange();
      };
      subscription.subscribe(null, handler);
      this.symbolSubscriptions.set(chart, {
        frame,
        dispose: () => subscription.unsubscribe(null, handler),
      });
    } catch {
      /* Optional event support; periodic checks remain the fallback. */
    }
  }

  invalidate(reason = 'CONTROLLER_INVALIDATED') {
    this.revision++;
    if (reason !== 'POSITION_MARKERS_CHANGED') this.histories.clear(reason);
    this.historyScope = '';
    this.remove(reason);
    this.observed = null;
    this.pendingTicker = null;
    for (const { dispose } of this.symbolSubscriptions.values()) {
      try {
        dispose();
      } catch {
        /* Chart disposed by host. */
      }
    }
    this.symbolSubscriptions.clear();
  }
  private remove(reason = 'DRAWING_REPLACED_OR_UNAVAILABLE') {
    const entity = this.entity;
    this.entity = null;
    try {
      if (entity) {
        entity.chart.removeEntity(entity.id);
        operatorDiagnostic('CHART_DRAWING_REMOVED', { drawingId: entity.id, reason }, 'MAIN');
      }
    } catch {
      /* Host disposed. */
    }
  }
  async render(data: AxiomChartData): Promise<AxiomLineStatus> {
    for (const [chart, watched] of this.symbolSubscriptions)
      if (!watched.frame.isConnected) {
        try {
          watched.dispose();
        } catch {
          /* Disposed host. */
        }
        this.symbolSubscriptions.delete(chart);
      }
    const diagnosis = new ChartDiagnosis(data.context, data.mint);
    const revision = ++this.revision;
    let historyValidated = false;
    const unavailable = (reason: string): AxiomLineStatus => {
      this.remove(reason);
      if (!historyValidated) this.histories.unavailable(data.history, reason);
      diagnosis.finish(reason);
      return { available: false, reason, drawn: 0 };
    };
    if (data.url !== location.href || location.pathname.split('/')[2] !== data.context) {
      diagnosis.record('CHART_CONTEXT_DETECTED', 'FAIL', 'AXIOM_CONTEXT_CHANGED');
      return unavailable('AXIOM_CONTEXT_CHANGED');
    }
    diagnosis.record('CHART_CONTEXT_DETECTED', 'PASS', 'TOP_MAIN_CURRENT_CONTEXT', {
      frame: 'top',
    });
    const averages = data.markers.filter((marker) => marker.kind === 'AVERAGE');
    let reason = 'AXIOM_NATIVE_API_UNAVAILABLE';
    const candidates: {
      chart: AxiomNativeChart;
      ticker: string;
      symbolKey: string;
      currency: 'SOL' | 'USD';
      unit: 'price' | 'market-cap';
    }[] = [];
    const frames = document.querySelectorAll<HTMLIFrameElement>(
      'iframe[id^="tradingview_"], iframe[title="Financial Chart"]',
    );
    diagnosis.record(
      'CHART_IFRAME_FOUND',
      frames.length ? 'PASS' : 'UNAVAILABLE',
      frames.length
        ? 'DIRECT_CHART_FRAMES_FOUND'
        : document.getElementById('chart-root')
          ? 'GLOBAL_CHART_ROOT_PRESENT_IFRAME_NOT_MOUNTED'
          : 'AXIOM_CHART_ROOT_AND_IFRAME_NOT_MOUNTED',
      {
        count: frames.length,
        chartRootPresent: Boolean(document.getElementById('chart-root')),
        globalWrappers: [
          ...document.querySelectorAll<HTMLElement>('[id^="global-trading-view-wrapper-"]'),
        ].map((host) => ({
          id: host.id,
          connected: host.isConnected,
          visibility: getComputedStyle(host).visibility,
          width: host.getBoundingClientRect().width,
          height: host.getBoundingClientRect().height,
          iframeCount: host.querySelectorAll('iframe').length,
        })),
        // Inventory does not authorize drawing in newly discovered contexts.
        frameInventory: (() => {
          try {
            return localStorage.getItem('paperfund:debug') === '1'
              ? chartContextInventory(document)
              : [];
          } catch {
            return [];
          }
        })(),
        topTradingViewApi: typeof (window as Window & { tradingViewApi?: unknown }).tradingViewApi,
      },
    );
    const attempts: Record<string, unknown>[] = [];
    let accessible = false;
    let active = false;
    let matched = false;
    const symbolAttempts: ReturnType<typeof verifyAxiomSymbol>[] = [];
    for (const frame of document.querySelectorAll<HTMLIFrameElement>(
      'iframe[id^="tradingview_"], iframe[title="Financial Chart"]',
    )) {
      try {
        const rect = frame.getBoundingClientRect();
        const attempt: Record<string, unknown> = {
          frame: frame.id || frame.title,
          width: rect.width,
          height: rect.height,
          connected: frame.isConnected,
        };
        attempts.push(attempt);
        if (rect.width < 280 || rect.height < 180 || !frame.isConnected) {
          attempt.reason = 'FRAME_HIDDEN_OR_UNDERSIZED';
          continue;
        }
        const wrapper = frame.closest<HTMLElement>('[id^="global-trading-view-wrapper-"]');
        if (wrapper && getComputedStyle(wrapper).visibility === 'hidden') {
          attempt.reason = 'AXIOM_GLOBAL_CHART_PARKED_HIDDEN';
          continue;
        }
        const doc = frame.contentDocument;
        const host = frame.contentWindow as
          (Window & { tradingViewApi?: { activeChart(): AxiomNativeChart } }) | null;
        // Explicitly accessing document distinguishes blocked origins from absent APIs.
        if (!doc || !host) {
          attempt.reason = 'FRAME_DOCUMENT_INACCESSIBLE';
          continue;
        }
        const widget = host.tradingViewApi;
        if (!widget || typeof widget.activeChart !== 'function') {
          attempt.reason = 'TRADINGVIEW_API_UNAVAILABLE_IN_FRAME_MAIN';
          continue;
        }
        accessible = true;
        const chart = widget.activeChart();
        if (!chart) {
          attempt.reason = 'ACTIVE_CHART_NOT_INITIALIZED';
          continue;
        }
        active = true;
        attempt.methods = {
          symbolExt: typeof chart.symbolExt,
          symbol: typeof chart.symbol,
          onSymbolChanged: typeof chart.onSymbolChanged,
          createShape: typeof chart.createShape,
          removeEntity: typeof chart.removeEntity,
        };
        if (
          !doc ||
          !chart ||
          typeof chart.symbolExt !== 'function' ||
          typeof chart.createShape !== 'function' ||
          typeof chart.removeEntity !== 'function'
        ) {
          attempt.reason = 'REQUIRED_CHART_METHOD_MISSING';
          continue;
        }
        if (!this.documents.has(doc)) {
          this.documents.add(doc);
          doc.addEventListener(
            'click',
            (event) => {
              const target = event.target as Element | null;
              // Read-only listener runs before Axiom's handler updates header/series.
              for (
                let node = target;
                node && node !== doc.documentElement;
                node = node.parentElement
              ) {
                const text = node.textContent?.replace(/\s/g, '');
                if (text !== 'USD/SOL' && text !== 'MarketCap/Price') continue;
                this.pendingTicker = readAxiomSymbol(chart).identifier;
                this.revision++;
                this.remove('HOST_MODE_CONTROL_CLICK');
                this.histories.clear('HOST_MODE_CONTROL_CLICK');
                break;
              }
            },
            true,
          );
        }
        this.watchSymbol(chart, frame);
        const snapshot = readAxiomSymbol(chart);
        const verification = verifyAxiomSymbol(snapshot, data);
        symbolAttempts.push(verification);
        const identity = verification.identity;
        attempt.symbol = verification.details;
        if (!identity) {
          reason = verification.reason;
          attempt.reason = reason;
          continue;
        }
        matched = true;
        const headerUnit = axiomNativeUnit(doc, identity.currency);
        const metadataUnit =
          snapshot.metadata.unit_id === 'market-cap' || snapshot.metadata.unit_id === 'price'
            ? snapshot.metadata.unit_id
            : null;
        // Explicit API unit metadata is usable only if it does not conflict with the resolved header.
        const unit =
          metadataUnit && headerUnit && metadataUnit !== headerUnit
            ? null
            : (metadataUnit ?? headerUnit);
        attempt.currency = identity.currency;
        attempt.unit = unit;
        if (!unit) {
          reason = 'AXIOM_NATIVE_UNIT_UNVERIFIED';
          attempt.reason = reason;
          continue;
        }
        attempt.reason = 'MATCHING_CHART';
        candidates.push({ chart, ...identity, unit });
      } catch (error) {
        attempts.push({
          frame: frame.id || frame.title,
          reason: 'FRAME_OR_API_ACCESS_THREW',
          errorName:
            error && typeof error === 'object' && 'name' in error && typeof error.name === 'string'
              ? error.name.slice(0, 80)
              : 'UNKNOWN_ERROR',
        });
        reason = 'AXIOM_NATIVE_FRAME_UNAVAILABLE';
      }
    }
    diagnosis.record(
      'CHART_API_ACCESSIBLE',
      accessible ? 'PASS' : 'UNAVAILABLE',
      accessible ? 'FRAME_MAIN_API_ACCESSIBLE' : 'NO_ACCESSIBLE_API',
      { attempts },
    );
    diagnosis.record(
      'ACTIVE_CHART_AVAILABLE',
      active ? 'PASS' : 'UNAVAILABLE',
      active ? 'ACTIVE_CHART_RETURNED' : 'ACTIVE_CHART_UNAVAILABLE',
    );
    diagnosis.record(
      'CURRENT_MINT_MATCHED',
      matched
        ? 'PASS'
        : symbolAttempts.some((attempt) => attempt.status === 'FAIL')
          ? 'FAIL'
          : 'UNAVAILABLE',
      matched
        ? 'EXACT_CHART_IDENTITY_VERIFIED'
        : data.mint === null
          ? 'EXPECTED_MINT_PENDING_BACKEND_RESOLUTION'
          : (symbolAttempts[0]?.reason ?? 'SYMBOL_NOT_MATCHED'),
      {
        ...(symbolAttempts.length === 1 ? symbolAttempts[0]!.details : { expectedMint: data.mint }),
        symbols: symbolAttempts.map((verification) => ({
          ...verification.details,
          status: verification.status,
          reason: verification.reason,
        })),
      },
    );
    diagnosis.record(
      'CHART_MODE_DETECTED',
      candidates.length === 1 ? 'PASS' : 'UNAVAILABLE',
      candidates.length === 1 ? 'HEADER_AND_TICKER_VERIFIED' : reason,
      {
        matchingCharts: candidates.length,
        modes: candidates.map(({ unit, currency }) => ({ unit, currency })),
        convention: 'AUTHORITATIVE_MINT_SUPPLY',
        visualSupplyConventionAcceptance: 'PENDING',
      },
    );
    if (candidates.length !== 1)
      return unavailable(candidates.length > 1 ? 'AMBIGUOUS_AXIOM_CHART' : reason);
    const { chart, ticker, symbolKey, currency, unit } = candidates[0]!;
    // Axiom reloads its series with a new nonce on a mode change. Do not insert the new
    // unit into the old series while the header has changed but symbol resolution has not.
    if (
      this.observed?.chart === chart &&
      this.observed.unit !== unit &&
      this.observed.ticker === ticker
    )
      this.pendingTicker = ticker;
    this.observed = { chart, ticker, unit };
    if (this.pendingTicker === ticker) return unavailable('AXIOM_SCALE_SWITCH_PENDING');
    this.pendingTicker = null;
    this.historyScope = JSON.stringify([data.ownerId, data.context, data.mint, symbolKey]);
    const historyScope = this.historyScope;
    if (currency === 'USD' && unit === 'market-cap') {
      this.histories.render(
        data.history,
        chart,
        data.ownerId,
        data.mint,
        symbolKey,
        () =>
          this.historyScope === historyScope &&
          data.url === location.href &&
          symbolSnapshotKey(readAxiomSymbol(chart)) === symbolKey,
      );
    } else this.histories.unavailable(data.history, 'HISTORY_REQUIRES_USD_MARKET_CAP');
    historyValidated = true;
    if (averages.length === 0) {
      this.remove('NO_OPEN_POSITION');
      diagnosis.finish('NO_OPEN_POSITION');
      return { available: true, reason: 'NO_OPEN_POSITION', drawn: 0 };
    }
    if (averages.length !== 1) return unavailable('AMBIGUOUS_AVERAGE');
    const marker = averages[0]!;
    const result = axiomAverageLevel(marker, unit, currency);
    diagnosis.record(
      'ENTRY_MARKET_CAP_VALIDATED',
      result.level === undefined ? 'UNAVAILABLE' : 'PASS',
      result.reason ?? 'AUTHORITATIVE_LEVEL_CONVERTED',
      {
        level: result.level ?? null,
        unit,
        currency,
        historicalFxRequired: currency === 'USD',
        averagePriceSol: marker.priceSol,
        authoritativeMarketCapSol: marker.marketCapSol ?? null,
        historicalSolUsd: marker.solUsd ?? null,
        usdAcquisition: marker.usdEntry?.details ?? null,
      },
    );
    if (result.level === undefined) return unavailable(result.reason!);
    const fingerprint = JSON.stringify([data.context, data.mint, ticker, unit, result.level]);
    if (this.entity?.chart === chart && this.entity.fingerprint === fingerprint) {
      let shapes: { id: string }[] | undefined;
      try {
        shapes = chart.getAllShapes?.();
      } catch {
        return unavailable('AXIOM_NATIVE_API_UNAVAILABLE');
      }
      if (!shapes || shapes.some((shape) => shape.id === this.entity!.id)) {
        diagnosis.record('DRAWING_REQUESTED', 'PASS', 'EXISTING_AVG_RETAINED');
        diagnosis.record('DRAWING_CREATED', 'PASS', 'EXISTING_ENTITY', {
          drawingId: this.entity.id,
        });
        diagnosis.record(
          'DRAWING_VISIBLE_OR_REJECTED',
          'UNAVAILABLE',
          shapes
            ? 'ENTITY_PRESENT_VISUAL_PLACEMENT_REQUIRES_OPERATOR'
            : 'HOST_ENTITY_INSPECTION_UNAVAILABLE',
          { drawingId: this.entity.id, visualAcceptance: 'PENDING' },
        );
        diagnosis.finish('VISUAL_ACCEPTANCE_PENDING');
        return {
          available: true,
          reason: 'AXIOM_NATIVE_AVG',
          drawn: 1,
          level: result.level,
          currency,
          unit,
        };
      }
    }
    this.remove();
    if (this.creating) {
      diagnosis.finish('AXIOM_NATIVE_DRAWING_PENDING');
      return { available: false, reason: 'AXIOM_NATIVE_DRAWING_PENDING', drawn: 0 };
    }
    this.creating = true;
    try {
      diagnosis.record('DRAWING_REQUESTED', 'PASS', 'CREATE_SHAPE_HORIZONTAL_LINE', {
        unit,
        currency,
        level: result.level,
      });
      diagnosis.finish('DRAWING_PROMISE_PENDING');
      const label =
        currency === 'USD' && unit === 'market-cap'
          ? 'PF AVG — $' +
            new Intl.NumberFormat('en-US', {
              notation: 'compact',
              maximumFractionDigits: 1,
            }).format(result.level)
          : 'PF AVG';
      const id = await chart.createShape(
        { price: result.level },
        {
          shape: 'horizontal_line',
          lock: true,
          disableSelection: true,
          disableSave: true,
          disableUndo: true,
          zOrder: 'top',
          text: label,
          overrides: {
            linecolor: '#74e6aa',
            textcolor: '#74e6aa',
            linewidth: 1,
            linestyle: 0,
            showLabel: true,
            showPrice: true,
            fontsize: 10,
            text: label,
            horzLabelsAlign: 'right',
            vertLabelsAlign: 'bottom',
          },
        },
      );
      diagnosis.record(
        'DRAWING_CREATED',
        id ? 'PASS' : 'FAIL',
        id ? 'CREATE_SHAPE_RETURNED_ENTITY' : 'CREATE_SHAPE_RETURNED_NO_ID',
        { drawingId: id },
      );
      if (!id) return unavailable('AXIOM_NATIVE_DRAWING_FAILED');
      if (
        this.revision !== revision ||
        data.url !== location.href ||
        symbolSnapshotKey(readAxiomSymbol(chart)) !== symbolKey
      ) {
        chart.removeEntity(id);
        diagnosis.record('DRAWING_VISIBLE_OR_REJECTED', 'FAIL', 'STALE_DRAWING_REMOVED', {
          drawingId: id,
        });
        diagnosis.finish('AXIOM_CONTEXT_CHANGED');
        return { available: false, reason: 'AXIOM_CONTEXT_CHANGED', drawn: 0 };
      }
      this.entity = { chart, id, fingerprint };
      let present: boolean | undefined;
      try {
        present = chart.getAllShapes?.().some((shape) => shape.id === id);
      } catch {
        /* Presence inspection is optional, not drawing rejection. */
      }
      diagnosis.record(
        'DRAWING_VISIBLE_OR_REJECTED',
        present === false ? 'FAIL' : 'UNAVAILABLE',
        present === false
          ? 'ENTITY_MISSING_AFTER_CREATION'
          : 'ENTITY_CREATED_VISUAL_PLACEMENT_REQUIRES_OPERATOR',
        { drawingId: id, entityPresent: present ?? null, visualAcceptance: 'PENDING' },
      );
      diagnosis.finish('VISUAL_ACCEPTANCE_PENDING');
      return {
        available: true,
        reason: 'AXIOM_NATIVE_AVG',
        drawn: 1,
        level: result.level,
        currency,
        unit,
      };
    } catch (error) {
      diagnosis.record('DRAWING_CREATED', 'FAIL', 'DRAWING_API_THREW', {
        errorName:
          error && typeof error === 'object' && 'name' in error && typeof error.name === 'string'
            ? error.name.slice(0, 80)
            : 'UNKNOWN_ERROR',
        // Drawing API errors only; no credentials or wallet/provider error objects.
        errorMessage:
          error instanceof Error ? error.message.slice(0, 200) : 'Unknown drawing rejection',
      });
      return unavailable('AXIOM_NATIVE_DRAWING_FAILED');
    } finally {
      this.creating = false;
    }
  }
}
