import { describe, expect, it, vi } from 'vitest';
import {
  AxiomChartAdapter,
  axiomScale,
  verifiedCoordinate,
  type AxiomSeries,
} from './axiom-chart.js';
import { averageEntryFx, marketCapSol } from './chart-history.js';
import type { Trade } from '@paperfund/shared/browser';

describe('Axiom authoritative display conversion and scale', () => {
  it('renders BUY/AVG/SELL from visible DOM axis geometry without any TradingView API', () => {
    vi.stubGlobal('location', { hostname: 'axiom.trade' });
    const link = document.createElement('a');
    link.href = 'https://solscan.io/token/mint';
    document.body.append(link);
    const frame = document.createElement('iframe');
    frame.title = 'Financial Chart';
    document.body.append(frame);
    const doc = frame.contentDocument!;
    doc.body.innerHTML =
      '<button aria-pressed="true">MC</button><button aria-pressed="true">SOL</button><canvas></canvas><div data-axis="right"><span data-axis-label>40000</span><span data-axis-label>30000</span><span data-axis-label>20000</span><span data-axis-label>10000</span></div>';
    let height = 400;
    frame.getBoundingClientRect = () => ({ width: 680, height }) as DOMRect;
    doc.querySelector('canvas')!.getBoundingClientRect = () =>
      ({ left: 10, top: 20, right: 610, width: 600, height }) as DOMRect;
    doc.querySelector('[data-axis]')!.getBoundingClientRect = () =>
      ({ left: 610, top: 20, width: 70, height }) as DOMRect;
    [...doc.querySelectorAll('[data-axis-label]')].forEach((label, i) => {
      label.getBoundingClientRect = () =>
        ({ top: 20 + ((50 + i * 100) * height) / 400 - 5, width: 50, height: 10 }) as DOMRect;
    });
    const adapter = new AxiomChartAdapter();
    const data = {
      mint: 'mint',
      context: 'pool',
      markers: ['BUY', 'AVERAGE', 'SELL'].map((kind) => ({
        id: kind,
        kind: kind as 'BUY' | 'AVERAGE' | 'SELL',
        priceSol: '0.0000243',
        marketCapSol: '24300',
        time: 1,
      })),
    };
    expect(adapter.render(data)).toMatchObject({
      available: true,
      reason: 'AXIOM_VISIBLE_AXIS_LINEAR',
      drawn: 3,
    });
    expect(doc.querySelector<HTMLElement>('[data-marker-id="AVERAGE"]')!.style.top).toBe('207px');
    height = 800;
    adapter.render(data);
    expect(doc.querySelector<HTMLElement>('[data-marker-id="AVERAGE"]')!.style.top).toBe('414px');
    data.markers = data.markers.filter((m) => m.kind !== 'AVERAGE');
    adapter.render(data);
    expect(doc.querySelector('[data-marker-id="AVERAGE"]')).toBeNull();
    expect(doc.querySelectorAll('[data-marker-id]')).toHaveLength(2);
    expect(adapter.render({ ...data, mint: 'other' }).available).toBe(false);
    expect(doc.querySelector('[data-paperfund-chart]')).toBeNull();
    adapter.render(data);
    expect(doc.querySelectorAll('[data-marker-id]')).toHaveLength(2);
    adapter.clear();
    frame.remove();
    link.remove();
    vi.unstubAllGlobals();
  });
  it('maps raw Token-2022 supply with decimals, tiny execution prices and no terminal MC', () => {
    expect(marketCapSol('0.000000234', '1000000000000000', 6)).toBe('234');
    expect(marketCapSol('0.000000234', '1000000000000000000', 9)).toBe('234');
    expect(marketCapSol('0.5', '2000000', 6)).toBe('1');
    expect(marketCapSol('0.5', 'bad', 6)).toBeNull();
  });
  it('requires exact current mint/pool identity and explicit units/currency', () => {
    expect(axiomScale({ ticker: 'pool_MCAP_SOL' }, 'mint', 'pool')).toEqual({
      unit: 'market-cap',
      currency: 'SOL',
    });
    expect(
      axiomScale({ ticker: 'mint', unit_id: 'market-cap', currency_code: 'USD' }, 'mint', 'pool'),
    ).toEqual({ unit: 'market-cap', currency: 'USD' });
    expect(axiomScale({ ticker: 'other_MCAP_SOL' }, 'mint', 'pool')).toBeNull();
    expect(axiomScale({ ticker: 'mint', currency_code: 'USD' }, 'mint', 'pool')).toBeNull();
  });
  it('round-trips host coordinates and fails closed on mismatched panes or bad mapping', () => {
    const scale = {
      height: () => 400,
      priceToCoordinate: (p: number) => 400 - Math.log(p) * 20,
      coordinateToPrice: (y: number) => Math.exp((400 - y) / 20),
    };
    const series: AxiomSeries = {
      symbolInfo: () => null,
      firstValue: () => ({ value: 5 }),
      priceScale: () => scale,
    };
    expect(verifiedCoordinate(series, 234, 400)).toBeCloseTo(400 - Math.log(234) * 20);
    expect(verifiedCoordinate(series, 234, 300)).toBeNull();
    scale.coordinateToPrice = () => 99;
    expect(verifiedCoordinate(series, 234, 400)).toBeNull();
  });
  it('keeps weighted historical FX through partial exits and requires every buy FX', () => {
    const fills = [
      {
        id: 'a',
        mint_address: 'mint',
        hourly_round_id: 'round',
        side: 'BUY',
        base_quantity: '100',
        actual_input_lamports: '1000',
        sol_usd_at_execution: '100',
        executed_at: '2026-10-01T00:00:00Z',
      },
      {
        id: 'b',
        mint_address: 'mint',
        hourly_round_id: 'round',
        side: 'BUY',
        base_quantity: '100',
        actual_input_lamports: '1000',
        sol_usd_at_execution: '200',
        executed_at: '2026-10-01T00:01:00Z',
      },
      {
        id: 'c',
        mint_address: 'mint',
        hourly_round_id: 'round',
        side: 'SELL',
        base_quantity: '100',
        executed_at: '2026-10-01T00:02:00Z',
      },
    ] as Trade[];
    expect(averageEntryFx(fills, 'mint', 'round')).toBe('150.000000000000000000');
    fills[0]!.sol_usd_at_execution = null;
    expect(averageEntryFx(fills, 'mint', 'round')).toBeUndefined();
  });
});
