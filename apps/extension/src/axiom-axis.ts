/** Display-only calibration from labels actually painted on Axiom's price axis. */
export interface AxisTick {
  value: number;
  y: number;
  tolerance: number;
}

export function parseAxisLabel(text: string): Omit<AxisTick, 'y'> | null {
  const match = /^\s*\$?\s*([0-9]+(?:\.[0-9]+)?)\s*([KMB])?\s*(?:SOL)?\s*$/i.exec(
    text.replace(/,(?=\d{3}(?:\D|$))/g, ''),
  );
  if (!match) return null;
  const factor = { K: 1e3, M: 1e6, B: 1e9 }[match[2]?.toUpperCase() ?? ''] ?? 1;
  const value = Number(match[1]) * factor;
  const precision = match[1]!.split('.')[1]?.length ?? 0;
  return value > 0 && Number.isFinite(value)
    ? { value, tolerance: (factor * 10 ** -precision) / 2 }
    : null;
}

/** Require >=3 independent ticks and an unambiguous fit, bounded to the visible plot. */
export function calibrateAxis(
  ticks: readonly AxisTick[],
  plotHeight?: number,
): {
  kind: 'linear' | 'log';
  coordinate(value: number): number | null;
} | null {
  const sorted = [...ticks].sort((a, b) => a.y - b.y);
  if (
    sorted.length < 3 ||
    sorted.some(
      (t, i) =>
        !Number.isFinite(t.y) ||
        !Number.isFinite(t.value) ||
        t.value <= 0 ||
        (i > 0 && (t.y - sorted[i - 1]!.y < 8 || t.value >= sorted[i - 1]!.value)),
    )
  )
    return null;
  const first = sorted[0]!,
    last = sorted.at(-1)!;
  const fits = (['linear', 'log'] as const).flatMap((kind) => {
    const transform = kind === 'log' ? Math.log : (v: number) => v;
    const meanX = sorted.reduce((sum, t) => sum + transform(t.value), 0) / sorted.length;
    const meanY = sorted.reduce((sum, t) => sum + t.y, 0) / sorted.length;
    const slope =
      sorted.reduce((sum, t) => sum + (transform(t.value) - meanX) * (t.y - meanY), 0) /
      sorted.reduce((sum, t) => sum + (transform(t.value) - meanX) ** 2, 0);
    const coordinate = (v: number) => meanY + (transform(v) - meanX) * slope;
    // Label rounding is explicitly bounded; imprecise ticks cannot establish geometry.
    const valid = sorted.every((t) => {
      const uncertainty = Math.abs(coordinate(t.value + t.tolerance) - coordinate(t.value));
      return (
        t.tolerance < t.value &&
        uncertainty <= 8 &&
        Math.abs(coordinate(t.value) - t.y) <= 1 + uncertainty
      );
    });
    return valid ? [{ kind, coordinate }] : [];
  });
  if (fits.length !== 1) return null;
  const fit = fits[0]!;
  return {
    kind: fit.kind,
    coordinate(value) {
      if (!Number.isFinite(value) || value <= 0) return null;
      const y = fit.coordinate(value);
      if (plotHeight !== undefined) return y >= 0 && y <= plotHeight ? y : null;
      return value < last.value || value > first.value ? null : y;
    },
  };
}

interface PaintedAxis {
  url: string;
  mode: string;
  width: number;
  height: number;
  cssWidth: number;
  cssHeight: number;
  ticks: Map<number, AxisTick>;
}

/** Observes native text draws without changing their inputs, outputs or chart data. */
export class AxiomAxisCapture {
  private axes = new WeakMap<HTMLCanvasElement, PaintedAxis>();
  private installed = new WeakSet<object>();
  constructor(private readonly mode: (canvas: HTMLCanvasElement) => string = () => '') {}
  invalidate() {
    this.axes = new WeakMap();
  }
  observe(view: Window) {
    const prototype = (view as Window & typeof globalThis).CanvasRenderingContext2D?.prototype;
    if (!prototype || this.installed.has(prototype)) return;
    this.installed.add(prototype);
    const record = this.record.bind(this);
    const reset = (canvas: HTMLCanvasElement) => this.axes.delete(canvas);
    const fillText = prototype.fillText;
    prototype.fillText = function (text, x, y, maxWidth?) {
      const result =
        maxWidth === undefined
          ? fillText.call(this, text, x, y)
          : fillText.call(this, text, x, y, maxWidth);
      try {
        record(this, text, x, y);
      } catch {
        /* Observation cannot break host paint. */
      }
      return result;
    };
    for (const method of ['clearRect', 'fillRect'] as const) {
      const original = prototype[method];
      prototype[method] = function (x, y, width, height) {
        const result = original.call(this, x, y, width, height);
        const transform = this.getTransform();
        if (
          x <= 0 &&
          y <= 0 &&
          width * transform.a >= this.canvas.width &&
          height * transform.d >= this.canvas.height
        )
          reset(this.canvas);
        return result;
      };
    }
  }
  private record(context: CanvasRenderingContext2D, text: string, x: number, y: number) {
    const canvas = context.canvas,
      rect = canvas.getBoundingClientRect();
    if (rect.width > 160 || rect.width < 25 || rect.height < 180) return;
    const parsed = parseAxisLabel(text);
    if (!parsed) return;
    const transform = context.getTransform();
    if (transform.b !== 0 || transform.c !== 0 || transform.a <= 0 || transform.d <= 0) return;
    const px = x * transform.a + transform.e;
    if (px < 0 || px > canvas.width) return;
    const metrics = context.measureText(text);
    const center = y + (metrics.actualBoundingBoxDescent - metrics.actualBoundingBoxAscent) / 2;
    const cy = ((center * transform.d + transform.f) * rect.height) / canvas.height;
    if (!Number.isFinite(cy) || cy < 0 || cy > rect.height) return;
    let axis = this.axes.get(canvas);
    const mode = this.mode(canvas);
    if (
      !axis ||
      axis.url !== location.href ||
      axis.mode !== mode ||
      axis.width !== canvas.width ||
      axis.height !== canvas.height ||
      axis.cssWidth !== rect.width ||
      axis.cssHeight !== rect.height
    ) {
      axis = {
        url: location.href,
        mode,
        width: canvas.width,
        height: canvas.height,
        cssWidth: rect.width,
        cssHeight: rect.height,
        ticks: new Map(),
      };
      this.axes.set(canvas, axis);
    }
    axis.ticks.set(Math.round(cy), { ...parsed, y: cy });
    if (axis.ticks.size > 32) this.axes.delete(canvas);
  }
  read(canvas: HTMLCanvasElement): AxisTick[] {
    const axis = this.axes.get(canvas);
    const rect = canvas.getBoundingClientRect();
    return axis?.url === location.href &&
      axis.mode === this.mode(canvas) &&
      axis.width === canvas.width &&
      axis.height === canvas.height &&
      axis.cssWidth === rect.width &&
      axis.cssHeight === rect.height
      ? [...axis.ticks.values()]
      : [];
  }
}

export function domAxisTicks(axis: Element, top: number): AxisTick[] {
  return [...axis.querySelectorAll('text, [data-price], [data-axis-label]')].flatMap((label) => {
    const rect = label.getBoundingClientRect();
    const parsed = parseAxisLabel(label.textContent ?? '');
    return parsed && rect.width > 0 && rect.height > 0
      ? [{ ...parsed, y: rect.top + rect.height / 2 - top }]
      : [];
  });
}
