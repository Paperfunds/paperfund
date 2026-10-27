import type { PaperfundMarker } from './chart-history.js';
import { AxiomAxisCapture, calibrateAxis, domAxisTicks } from './axiom-axis.js';

interface SymbolInfo {
  ticker?: string;
  name?: string;
  currency_code?: string;
  unit_id?: string;
}
export interface AxiomSeries {
  symbolInfo(): SymbolInfo | null;
  firstValue(): number | { value: number } | null;
  priceScale(): {
    priceToCoordinate(value: number, first: number): number;
    coordinateToPrice(y: number, first: number): number;
    height(): number;
  };
}
export type ChartUnit = 'price' | 'market-cap';

function selectedChartControls(root: ParentNode): Partial<SymbolInfo> {
  const labels = [
    ...root.querySelectorAll(
      '[aria-pressed="true"], [aria-selected="true"], [data-state="active"], [data-state="on"], [data-active="true"], option:checked',
    ),
  ].map((element) =>
    (element.getAttribute('aria-label') ?? element.textContent ?? '').trim().toUpperCase(),
  );
  const units = new Set(
    labels.flatMap((label) =>
      ['MC', 'MCAP', 'MARKET CAP', 'MARKETCAP'].includes(label)
        ? ['market-cap']
        : label === 'PRICE'
          ? ['price']
          : [],
    ),
  );
  const currencies = new Set(labels.filter((label) => label === 'SOL' || label === 'USD'));
  return {
    ...(units.size === 1 ? { unit_id: [...units][0]! } : {}),
    ...(currencies.size === 1 ? { currency_code: [...currencies][0]! } : {}),
  };
}

/** Explicit symbol metadata only. Neither terminal market cap nor candle magnitude is a unit. */
export function axiomScale(
  info: SymbolInfo,
  mint: string,
  context: string,
): { unit: ChartUnit; currency: 'SOL' | 'USD' } | null {
  const names = `${info.ticker ?? ''} ${info.name ?? ''}`.split(/[^a-zA-Z0-9]+/);
  if (!names.includes(mint) && !names.includes(context)) return null;
  const unit =
    info.unit_id?.toLowerCase() ??
    (names.some((n) => /^(MCAP|MARKETCAP)$/i.test(n))
      ? 'market-cap'
      : names.some((n) => /^PRICE$/i.test(n))
        ? 'price'
        : null);
  const currency = info.currency_code ?? names.find((n) => n === 'SOL' || n === 'USD');
  if (
    !['price', 'market-cap', 'marketcap', 'mcap'].includes(unit ?? '') ||
    !['SOL', 'USD'].includes(currency ?? '')
  )
    return null;
  return { unit: unit === 'price' ? 'price' : 'market-cap', currency: currency as 'SOL' | 'USD' };
}

export function verifiedCoordinate(
  series: AxiomSeries,
  value: number,
  height: number,
): number | null {
  const first = series.firstValue();
  const base = typeof first === 'number' ? first : first?.value;
  if (!Number.isFinite(base) || !Number.isFinite(value) || value <= 0) return null;
  const scale = series.priceScale();
  if (Math.abs(scale.height() - height) > 2) return null;
  const y = scale.priceToCoordinate(value, base!);
  const restored = scale.coordinateToPrice(y, base!);
  if (
    !Number.isFinite(y) ||
    !Number.isFinite(restored) ||
    Math.abs(restored - value) > Math.abs(value) * 1e-6
  )
    return null;
  return y;
}

/** Paperfund owns the overlay; visible axis labels establish coordinates. */
export class AxiomChartAdapter {
  private layers = new Set<HTMLElement>();
  private axis = new AxiomAxisCapture((canvas) => {
    const doc = canvas.ownerDocument;
    const frame = doc.defaultView?.frameElement;
    return JSON.stringify({
      ...selectedChartControls(frame?.parentElement ?? doc),
      ...selectedChartControls(doc),
    });
  });
  private frames = new WeakSet<HTMLIFrameElement>();
  constructor() {
    if (location.hostname !== 'axiom.trade') return;
    const observe = () => {
      for (const frame of document.querySelectorAll<HTMLIFrameElement>(
        'iframe[id^="tradingview_"], iframe[title="Financial Chart"]',
      )) {
        const attach = () => {
          try {
            if (frame.contentWindow) this.axis.observe(frame.contentWindow);
          } catch {
            /* Cross-origin frames fail closed. */
          }
        };
        attach();
        if (!this.frames.has(frame)) {
          this.frames.add(frame);
          frame.addEventListener('load', attach);
        }
      }
    };
    new MutationObserver(observe).observe(document, { childList: true, subtree: true });
    observe();
  }
  clear() {
    for (const layer of this.layers) layer.remove();
    this.layers.clear();
  }
  invalidate() {
    this.clear();
    this.axis.invalidate();
  }
  render(data: { mint: string; context: string; markers: PaperfundMarker[] }): {
    available: boolean;
    reason: string;
  } {
    this.clear();
    if (location.hostname !== 'axiom.trade') return { available: false, reason: 'NOT_AXIOM' };
    return this.renderAxis(data, 'AXIOM_AXIS_NOT_FOUND');
  }

  /** Independent of TradingView widgets: match the actual pane and calibrated visible axis. */
  private renderAxis(
    data: { mint: string; context: string; markers: PaperfundMarker[] },
    reason: string,
  ) {
    const tokenLink = [...document.querySelectorAll<HTMLAnchorElement>('a[href]')].some((link) => {
      try {
        const url = new URL(link.href);
        return url.hostname === 'solscan.io' && url.pathname === `/token/${data.mint}`;
      } catch {
        return false;
      }
    });
    // The bridge binds backend-resolved mint to this exact current terminal URL. A Solscan
    // anchor is optional host markup, not an execution or chart-identity authority.
    const currentContext = location.pathname?.split('/')[2];
    if (!tokenLink && currentContext !== data.context && currentContext !== data.mint)
      return { available: false, reason: 'AXIOM_MINT_UNVERIFIED' };
    for (const frame of document.querySelectorAll<HTMLIFrameElement>(
      'iframe[id^="tradingview_"], iframe[title="Financial Chart"]',
    )) {
      try {
        const doc = frame.contentDocument;
        if (!doc || frame.getBoundingClientRect().height < 180) continue;
        const controls = {
          ...selectedChartControls(frame.parentElement ?? document),
          ...selectedChartControls(doc),
        };
        if (
          controls.unit_id !== 'market-cap' ||
          !['SOL', 'USD'].includes(controls.currency_code ?? '')
        ) {
          reason = 'AXIOM_SYMBOL_UNIT_UNVERIFIED';
          continue;
        }
        const canvases = [...doc.querySelectorAll('canvas')];
        const plots = canvases.filter(
          (c) => c.getBoundingClientRect().width >= 280 && c.getBoundingClientRect().height >= 180,
        );
        for (const plot of plots) {
          const rect = plot.getBoundingClientRect();
          const axes = [...doc.querySelectorAll('canvas, [data-axis="right"], .price-axis')].filter(
            (axis) => {
              const r = axis.getBoundingClientRect();
              return (
                r.width >= 25 &&
                r.width <= 160 &&
                Math.abs(r.top - rect.top) <= 1 &&
                Math.abs(r.height - rect.height) <= 1 &&
                Math.abs(r.left - rect.right) <= 2
              );
            },
          );
          for (const axis of axes) {
            const ticks =
              axis.tagName === 'CANVAS'
                ? this.axis.read(axis as HTMLCanvasElement)
                : domAxisTicks(axis, rect.top);
            const mapping = calibrateAxis(ticks, rect.height);
            if (!mapping) {
              reason = 'AXIOM_AXIS_UNVERIFIED';
              continue;
            }
            const layer = doc.createElement('div');
            layer.dataset.paperfundChart = data.mint;
            layer.dataset.paperfundScale = mapping.kind;
            layer.style.cssText = `position:fixed;pointer-events:none;overflow:hidden;z-index:60;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px`;
            let drawn = 0;
            let clipped = 0;
            let missingFx = false;
            let missingSupply = false;
            for (const marker of data.markers) {
              const sol = Number(marker.marketCapSol);
              const fx = controls.currency_code === 'USD' ? Number(marker.solUsd) : 1;
              if (!Number.isFinite(sol) || sol <= 0) {
                missingSupply = true;
                continue;
              }
              if (!Number.isFinite(fx) || fx <= 0) {
                missingFx = true;
                continue;
              }
              const value = sol * fx,
                y = mapping.coordinate(value);
              if (y === null || y < 0 || y > rect.height) {
                clipped++;
                continue;
              }
              const line = doc.createElement('div');
              const color = marker.kind === 'SELL' ? '#aab5b8' : '#74e6aa';
              line.dataset.markerId = marker.id;
              line.style.cssText = `position:absolute;left:0;right:0;top:${y}px;border-top:1px ${marker.kind === 'AVERAGE' ? 'solid' : 'dashed'} ${color};font:10px sans-serif;color:${color};text-align:right`;
              const amount =
                value >= 1e6
                  ? (value / 1e6).toFixed(2) + 'M'
                  : value >= 1e3
                    ? (value / 1e3).toFixed(1) + 'K'
                    : value.toPrecision(5);
              line.textContent = `PF ${marker.kind === 'AVERAGE' ? 'AVG ENTRY' : marker.kind === 'SELL' ? 'SELL / EXIT' : 'BUY'}  ${controls.currency_code === 'USD' ? '$' : ''}${amount}${controls.currency_code === 'SOL' ? ' SOL' : ''}`;
              layer.appendChild(line);
              drawn++;
            }
            doc.body.appendChild(layer);
            this.layers.add(layer);
            return {
              drawn,
              clipped,
              tickCount: ticks.length,
              scale: mapping.kind,
              currency: controls.currency_code,
              available: !missingFx && !missingSupply,
              reason: missingSupply
                ? 'AUTHORITATIVE_FILL_SUPPLY_UNAVAILABLE'
                : missingFx
                  ? 'HISTORICAL_SOL_USD_UNAVAILABLE'
                  : `AXIOM_VISIBLE_AXIS_${mapping.kind.toUpperCase()}`,
            };
          }
        }
      } catch {
        reason = 'AXIOM_FRAME_UNAVAILABLE';
      }
    }
    return { available: false, reason };
  }
}
