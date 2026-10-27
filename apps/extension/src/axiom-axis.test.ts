import { describe, expect, it } from 'vitest';
import { AxiomAxisCapture, calibrateAxis, parseAxisLabel } from './axiom-axis.js';

describe('visible Axiom axis calibration', () => {
  it('observes canvas labels at device pixel ratio 2 and invalidates redraw, resize and mode changes', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 140;
    canvas.height = 800;
    let height = 400,
      mode = 'MC/SOL';
    canvas.getBoundingClientRect = () => ({ width: 70, height }) as DOMRect;
    const painted: string[] = [];
    class Painter {
      canvas = canvas;
      fillText(text: string) {
        painted.push(text);
      }
      clearRect() {}
      fillRect() {}
      getTransform() {
        return { a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 };
      }
      measureText() {
        return { actualBoundingBoxAscent: 4, actualBoundingBoxDescent: 4 };
      }
    }
    const capture = new AxiomAxisCapture(() => mode);
    capture.observe({ CanvasRenderingContext2D: Painter } as unknown as Window);
    const painter = new Painter() as unknown as CanvasRenderingContext2D;
    [40000, 30000, 20000, 10000].forEach((value, i) =>
      painter.fillText(String(value), 5, 50 + i * 100),
    );
    expect(painted).toHaveLength(4);
    expect(calibrateAxis(capture.read(canvas))!.coordinate(24300)).toBeCloseTo(207);
    mode = 'MC/USD';
    expect(capture.read(canvas)).toEqual([]);
    mode = 'MC/SOL';
    height = 800;
    expect(capture.read(canvas)).toEqual([]);
    height = 400;
    painter.clearRect(0, 0, 70, 400);
    expect(capture.read(canvas)).toEqual([]);
  });
  it('parses rounded market-cap labels and rejects percentages, times and prices without precision', () => {
    expect(parseAxisLabel('$24.30K')).toEqual({ value: 24300, tolerance: 5 });
    expect(parseAxisLabel('1.25M SOL')).toEqual({ value: 1250000, tolerance: 5000 });
    for (const text of ['12:00', '24%', '-4K', 'NaN', 'Migration Market Cap 24K'])
      expect(parseAxisLabel(text)).toBeNull();
  });
  it('calibrates linear zoom/resize geometry using independent labels and clips off-scale values', () => {
    const ticks = [40000, 30000, 20000, 10000].map((value, i) => ({
      value,
      y: 50 + i * 100,
      tolerance: 0.5,
    }));
    const scale = calibrateAxis(ticks)!;
    expect(scale.kind).toBe('linear');
    expect(scale.coordinate(24300)).toBeCloseTo(207);
    expect(scale.coordinate(50000)).toBeNull();
    expect(calibrateAxis(ticks.map((t) => ({ ...t, y: t.y * 2 })))!.coordinate(24300)).toBeCloseTo(
      414,
    );
  });
  it('detects logarithmic scale mathematically and rejects mixed/ambiguous/incomplete scales', () => {
    const ticks = [1000, 100, 10, 1].map((value, i) => ({
      value,
      y: 100 + i * 100,
      tolerance: 0.0001,
    }));
    expect(calibrateAxis(ticks)!.kind).toBe('log');
    expect(calibrateAxis(ticks)!.coordinate(Math.sqrt(1000 * 100))).toBeCloseTo(150);
    expect(calibrateAxis(ticks.slice(0, 2))).toBeNull();
    expect(calibrateAxis(ticks.map((t, i) => ({ ...t, y: t.y + (i === 1 ? 30 : 0) })))).toBeNull();
    expect(calibrateAxis(ticks.map((t) => ({ ...t, tolerance: t.value })))).toBeNull();
  });
  it('calibrates three ordinary rounded K labels and maps the full visible plot', () => {
    const ticks = ['50K', '30K', '10K'].map((text, i) => ({ ...parseAxisLabel(text)!, y: 50 + 150 * i }));
    const mapping = calibrateAxis(ticks, 400)!;
    expect(mapping.kind).toBe('linear');
    expect(mapping.coordinate(25000)).toBeCloseTo(237.5);
    expect(mapping.coordinate(55000)).toBeCloseTo(12.5);
    expect(mapping.coordinate(60000)).toBeNull();
    expect(parseAxisLabel('25,000')).toMatchObject({ value: 25000 });
  });
});
