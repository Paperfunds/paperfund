import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AxiomNativeAverage,
  axiomAverageLevel,
  axiomNativeIdentity,
  axiomNativeUnit,
  type AxiomChartData,
  type AxiomNativeChart,
} from './axiom-native.js';

const data: AxiomChartData = {
  url: 'https://axiom.trade/meme/pool?chain=sol',
  context: 'pool',
  mint: 'mint',
  markers: [
    { id: 'average', kind: 'AVERAGE', priceSol: '0.0000243', marketCapSol: '24300', time: 0 },
  ],
};
function ticker(currency = 'SOL', nonce = 1, mint = 'mint') {
  return `axiom-chart-v1|pair|sol|${currency}|${nonce}|pool|${mint}`;
}
function header(doc: Document, currency = 'SOL', unit = 'MarketCap') {
  const color = (selected: boolean) => (selected ? '#526fff' : '#9aa3af');
  doc.body.innerHTML = `<button><span style="color:${color(currency === 'USD')}">USD</span>/<span style="color:${color(currency === 'SOL')}">SOL</span></button><button><span style="color:${color(unit === 'MarketCap')}">MarketCap</span>/<span style="color:${color(unit === 'Price')}">Price</span></button>`;
}
function fixture(parent: HTMLElement = document.body) {
  const frame = document.createElement('iframe');
  frame.title = 'Financial Chart';
  parent.append(frame);
  frame.getBoundingClientRect = () => ({ width: 700, height: 400 }) as DOMRect;
  header(frame.contentDocument!);
  let symbol = ticker();
  let sequence = 0;
  const ids = new Set<string>();
  const api: AxiomNativeChart = {
    symbolExt: () => ({ ticker: symbol }),
    createShape: vi.fn(async () => {
      const id = `pf-${++sequence}`;
      ids.add(id);
      return id;
    }),
    removeEntity: vi.fn((id) => {
      ids.delete(id);
    }),
    getAllShapes: () => [...ids].map((id) => ({ id })),
  };
  Object.assign(frame.contentWindow!, { tradingViewApi: { activeChart: () => api } });
  return {
    frame,
    api,
    ids,
    setTicker: (next: string) => {
      symbol = next;
    },
  };
}
beforeEach(() => {
  vi.stubGlobal('location', { href: data.url, pathname: '/meme/pool' });
});
afterEach(() => {
  localStorage.clear();
  delete (window as Window & { paperfundChartDiagnostics?: unknown }).paperfundChartDiagnostics;
  vi.restoreAllMocks();
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('current Axiom native AVG integration', () => {
  it('validates the versioned pair, mint, chain and currency independently of a global widget', () => {
    expect(axiomNativeIdentity(ticker(), data)?.currency).toBe('SOL');
    for (const value of [
      ticker('EUR'),
      ticker('SOL', 1, 'other'),
      ticker().replace('|pool|', '|other|'),
      ticker().replace('|sol|', '|bnb|'),
      ticker().replace('|pair|', '|token|'),
      'mint',
      ticker().replace('|1|', '|-1|'),
      ticker().replace('|mint', '|%E0%A4%A'),
    ])
      expect(axiomNativeIdentity(value, data)).toBeNull();
  });
  it('reads the actual two-color header without selected-state attributes or brightness guesses', () => {
    header(document);
    expect(axiomNativeUnit(document, 'SOL')).toBe('market-cap');
    header(document, 'USD', 'Price');
    expect(axiomNativeUnit(document, 'USD')).toBe('price');
    document.querySelector('span')!.style.color = '#9aa3af';
    expect(axiomNativeUnit(document, 'USD')).toBeNull();
    document.body.innerHTML = '<span>MarketCap</span>';
    expect(axiomNativeUnit(document, 'SOL')).toBeNull();
  });
  it('uses authoritative supply and historical FX; never substitutes a current quote', () => {
    const avg = data.markers[0]!;
    expect(axiomAverageLevel(avg, 'market-cap', 'SOL')).toEqual({ level: 24300 });
    expect(axiomAverageLevel({ ...avg, solUsd: '150' }, 'market-cap', 'USD')).toEqual({
      level: 3645000,
    });
    expect(axiomAverageLevel(avg, 'market-cap', 'USD').reason).toBe(
      'HISTORICAL_SOL_USD_UNAVAILABLE',
    );
    expect(axiomAverageLevel({ ...avg, marketCapSol: undefined }, 'market-cap', 'SOL').reason).toBe(
      'AUTHORITATIVE_SUPPLY_UNAVAILABLE',
    );
  });
  it('creates exactly one native horizontal AVG line, retains it on redraw, updates basis and removes after exit', async () => {
    const { api, ids } = fixture();
    const adapter = new AxiomNativeAverage();
    expect(await adapter.render(data)).toMatchObject({ available: true, drawn: 1, level: 24300 });
    expect(api.createShape).toHaveBeenCalledWith(
      { price: 24300 },
      expect.objectContaining({
        shape: 'horizontal_line',
        text: 'PF AVG',
        disableSave: true,
        overrides: expect.objectContaining({ showPrice: true, text: 'PF AVG' }),
      }),
    );
    await adapter.render(data);
    expect(api.createShape).toHaveBeenCalledTimes(1);
    // The host owns zoom/pan/resize. No screen coordinate enters the drawing contract.
    const next = { ...data, markers: [{ ...data.markers[0]!, marketCapSol: '30000' }] };
    await adapter.render(next);
    expect(api.removeEntity).toHaveBeenCalledWith('pf-1');
    expect(ids.size).toBe(1);
    expect(api.createShape).toHaveBeenLastCalledWith({ price: 30000 }, expect.anything());
    await adapter.render({ ...data, markers: [] });
    expect(ids.size).toBe(0);
  });
  it('does not draw historical BUY/SELL before live AVG acceptance', async () => {
    const { api } = fixture();
    const adapter = new AxiomNativeAverage();
    await adapter.render({ ...data, markers: [{ ...data.markers[0]!, kind: 'BUY' }] });
    expect(api.createShape).not.toHaveBeenCalled();
  });
  it('removes lines for another mint, unknown units, missing FX, and disposed charts', async () => {
    const { api, frame, ids, setTicker } = fixture();
    const adapter = new AxiomNativeAverage();
    await adapter.render(data);
    setTicker(ticker('SOL', 2, 'other'));
    expect((await adapter.render(data)).reason).toBe('CHART_TOKEN_MINT_MISMATCH');
    expect(ids.size).toBe(0);
    setTicker(ticker('USD', 3));
    header(frame.contentDocument!, 'USD');
    expect((await adapter.render(data)).reason).toBe('HISTORICAL_SOL_USD_UNAVAILABLE');
    expect(api.createShape).toHaveBeenCalledTimes(1);
    frame.remove();
    expect((await adapter.render(data)).available).toBe(false);
  });
  it('waits for series symbol resolution after a mode or currency toggle', async () => {
    const { frame, ids, setTicker } = fixture();
    const adapter = new AxiomNativeAverage();
    await adapter.render(data);
    frame.contentDocument!.querySelectorAll('button')[1]!.click();
    expect(ids.size).toBe(0);
    header(frame.contentDocument!, 'SOL', 'Price');
    expect((await adapter.render(data)).reason).toBe('AXIOM_SCALE_SWITCH_PENDING');
    setTicker(ticker('SOL', 2));
    expect((await adapter.render(data)).level).toBe(0.0000243);
    frame.contentDocument!.querySelector('button')!.click();
    header(frame.contentDocument!, 'USD', 'Price');
    expect((await adapter.render(data)).reason).toBe('AXIOM_SCALE_SWITCH_PENDING');
    setTicker(ticker('USD', 3));
    expect(
      (await adapter.render({ ...data, markers: [{ ...data.markers[0]!, solUsd: '150' }] })).level,
    ).toBeCloseTo(0.003645);
  });
  it('removes an async drawing completed after navigation/invalidation', async () => {
    const { api } = fixture();
    const adapter = new AxiomNativeAverage();
    let complete!: (id: string) => void;
    vi.mocked(api.createShape).mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const pending = adapter.render(data);
    adapter.invalidate();
    complete('late');
    expect((await pending).available).toBe(false);
    expect(api.removeEntity).toHaveBeenCalledWith('late');
  });
  it('restores only its own removed drawing and rejects ambiguous matching chart frames', async () => {
    const { api, ids } = fixture();
    const adapter = new AxiomNativeAverage();
    await adapter.render(data);
    ids.clear();
    await adapter.render(data);
    expect(api.createShape).toHaveBeenCalledTimes(2);
    fixture();
    expect((await adapter.render(data)).reason).toBe('AMBIGUOUS_AXIOM_CHART');
    expect(ids.size).toBe(0);
  });
});

function latestDiagnosis() {
  return (
    window as Window & {
      paperfundChartDiagnostics?: {
        firstFailure: string;
        stages: {
          stage: string;
          status: string;
          reason: string;
          details: Record<string, unknown>;
        }[];
      };
    }
  ).paperfundChartDiagnostics!;
}
describe('native diagnostic failure evidence', () => {
  beforeEach(() => {
    localStorage.setItem('paperfund:debug', '1');
    vi.spyOn(console, 'debug').mockImplementation(() => {});
  });
  it('reports API absence independently of a selected accessible frame', async () => {
    const { frame } = fixture();
    Object.assign(frame.contentWindow!, { tradingViewApi: undefined });
    await new AxiomNativeAverage().render(data);
    expect(latestDiagnosis().firstFailure).toBe('CHART_API_ACCESSIBLE');
    expect(latestDiagnosis().stages[2]?.details).toMatchObject({
      attempts: [expect.objectContaining({ reason: 'TRADINGVIEW_API_UNAVAILABLE_IN_FRAME_MAIN' })],
    });
  });
  it('reports mint mismatch, missing supply and missing historical FX at distinct stages', async () => {
    const { setTicker, frame } = fixture();
    const adapter = new AxiomNativeAverage();
    setTicker(ticker('SOL', 1, 'other'));
    await adapter.render(data);
    expect(latestDiagnosis().firstFailure).toBe('CURRENT_MINT_MATCHED');
    setTicker(ticker());
    await adapter.render({ ...data, markers: [{ ...data.markers[0]!, marketCapSol: undefined }] });
    expect(latestDiagnosis().firstFailure).toBe('ENTRY_MARKET_CAP_VALIDATED');
    expect(latestDiagnosis().stages[6]?.reason).toBe('AUTHORITATIVE_SUPPLY_UNAVAILABLE');
    setTicker(ticker('USD', 2));
    header(frame.contentDocument!, 'USD');
    await adapter.render(data);
    expect(latestDiagnosis().stages[6]?.reason).toBe('HISTORICAL_SOL_USD_UNAVAILABLE');
  });
  it('records drawing rejections and does not call creation visual acceptance', async () => {
    const { api } = fixture();
    const adapter = new AxiomNativeAverage();
    vi.mocked(api.createShape).mockRejectedValueOnce(new Error('Drawing permission rejected'));
    await adapter.render(data);
    expect(latestDiagnosis().firstFailure).toBe('DRAWING_CREATED');
    expect(latestDiagnosis().stages[8]?.details.errorMessage).toBe('Drawing permission rejected');
    await adapter.render(data);
    expect(latestDiagnosis().firstFailure).toBe('DRAWING_VISIBLE_OR_REJECTED');
    expect(latestDiagnosis().stages[9]?.details).toMatchObject({
      drawingId: 'pf-1',
      visualAcceptance: 'PENDING',
    });
  });
});

describe('observed Axiom global chart hosting lifecycle', () => {
  it('distinguishes an unmounted global root and recovers when the real iframe appears later', async () => {
    localStorage.setItem('paperfund:debug', '1');
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    const root = document.createElement('div');
    root.id = 'chart-root';
    document.body.append(root);
    const adapter = new AxiomNativeAverage();
    await adapter.render(data);
    expect(latestDiagnosis().stages[1]?.reason).toBe(
      'GLOBAL_CHART_ROOT_PRESENT_IFRAME_NOT_MOUNTED',
    );
    const { api } = fixture(root);
    expect((await adapter.render(data)).drawn).toBe(1);
    expect(api.createShape).toHaveBeenCalledTimes(1);
  });
  it('does not select a parked hidden global chart, and recovers when its wrapper becomes visible', async () => {
    localStorage.setItem('paperfund:debug', '1');
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    const wrapper = document.createElement('div');
    wrapper.id = 'global-trading-view-wrapper-a';
    wrapper.style.visibility = 'hidden';
    document.body.append(wrapper);
    const { api } = fixture(wrapper);
    const adapter = new AxiomNativeAverage();
    await adapter.render(data);
    expect(api.createShape).not.toHaveBeenCalled();
    expect(latestDiagnosis().stages[2]?.details.attempts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason: 'AXIOM_GLOBAL_CHART_PARKED_HIDDEN' }),
      ]),
    );
    wrapper.style.visibility = 'visible';
    expect((await adapter.render(data)).drawn).toBe(1);
  });
});

describe('confirmed real Axiom pair-only symbol continuation', () => {
  it('matches the captured USD ticker and creates a native SOL market-cap AVG after switching currency', async () => {
    const pair = 'HTFaPY9rYmFiSfLVUXVjqmTs5KYTtqWjoABHJjxNAtMX';
    const mint = '8Wtg9wQCuDVLrQqH8pw2yKyvurmrjEeFcp9ysdDKpump';
    const input = {
      ...data,
      url: 'https://axiom.trade/meme/' + pair,
      context: pair,
      mint,
      marketBinding: { requestedContext: pair, mint },
    };
    vi.stubGlobal('location', { href: input.url, pathname: '/meme/' + pair });
    localStorage.setItem('paperfund:debug', '1');
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    const { api, frame, setTicker, ids } = fixture();
    setTicker('axiom-chart-v1|pair|sol|USD|1|' + pair + '|');
    header(frame.contentDocument!, 'USD');
    const adapter = new AxiomNativeAverage();
    expect((await adapter.render(input)).reason).toBe('HISTORICAL_SOL_USD_UNAVAILABLE');
    expect(latestDiagnosis().stages[4]).toMatchObject({
      status: 'PASS',
      details: {
        resolvedChartMint: mint,
        chartMarket: pair,
        matchingMethod: 'VERSIONED_PAIR_BACKEND_MINT_BINDING',
      },
    });
    expect(api.createShape).not.toHaveBeenCalled();
    setTicker('axiom-chart-v1|pair|sol|SOL|2|' + pair + '|');
    header(frame.contentDocument!, 'SOL');
    expect((await adapter.render(input)).level).toBe(24300);
    expect(api.createShape).toHaveBeenCalledWith(
      { price: 24300 },
      expect.objectContaining({ shape: 'horizontal_line', text: 'PF AVG' }),
    );
    expect(ids.size).toBe(1);
    expect(latestDiagnosis().stages[8]).toMatchObject({
      status: 'PASS',
      details: { drawingId: 'pf-1' },
    });
    expect(latestDiagnosis().stages[9]).toMatchObject({
      status: 'UNAVAILABLE',
      details: { entityPresent: true, visualAcceptance: 'PENDING' },
    });
  });
  it('invalidates on the documented symbol-resolved event and unsubscribes on controller cleanup', async () => {
    const { api, ids, setTicker } = fixture();
    let handler!: () => void;
    const unsubscribe = vi.fn();
    const subscribe = vi.fn((_context, callback: () => void) => {
      handler = callback;
    });
    api.onSymbolChanged = () => ({ subscribe, unsubscribe });
    const refresh = vi.fn();
    const adapter = new AxiomNativeAverage(refresh);
    await adapter.render(data);
    await adapter.render(data);
    expect(subscribe).toHaveBeenCalledTimes(1);
    setTicker(ticker('SOL', 2, 'other'));
    handler();
    expect(ids.size).toBe(0);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect((await adapter.render(data)).reason).toBe('CHART_TOKEN_MINT_MISMATCH');
    adapter.invalidate();
    expect(unsubscribe).toHaveBeenCalledWith(null, handler);
  });
  it('accepts explicit API market-cap unit metadata and rejects a contradictory active header', async () => {
    const { api, frame } = fixture();
    api.symbolExt = () => ({ ticker: ticker(), unit_id: 'market-cap', selectedCurrency: 'SOL' });
    frame.contentDocument!.body.innerHTML = '';
    const adapter = new AxiomNativeAverage();
    expect((await adapter.render(data)).level).toBe(24300);
    header(frame.contentDocument!, 'SOL', 'Price');
    expect((await adapter.render(data)).reason).toBe('AXIOM_NATIVE_UNIT_UNVERIFIED');
  });
});

describe('authoritative USD acquisition level rendering', () => {
  it('draws the replayed USD cap directly without requiring SOL mode or substituting current FX', async () => {
    const { api, frame, setTicker, ids } = fixture();
    setTicker(ticker('USD'));
    header(frame.contentDocument!, 'USD');
    const adapter = new AxiomNativeAverage();
    const value = {
      ...data,
      markers: [
        {
          ...data.markers[0]!,
          usdEntry: {
            marketCapUsd: '24300',
            priceUsd: '0.0000243',
            details: {
              remainingUsdBasis: '24.3',
              fills: [{ fxSource: 'PYTH_HERMES_TIMESTAMP', solUsd: '150' }],
            },
          },
        },
      ],
    };
    expect((await adapter.render(value)).level).toBe(24300);
    expect(api.createShape).toHaveBeenCalledWith(
      { price: 24300 },
      expect.objectContaining({ text: 'PF AVG — $24.3K', shape: 'horizontal_line' }),
    );
    expect(ids.size).toBe(1);
    await adapter.render({ ...value, markers: [] });
    expect(ids.size).toBe(0);
  });
  it('reports the configuration blocker explicitly and never calls the drawing API', async () => {
    const { api, frame, setTicker } = fixture();
    setTicker(ticker('USD'));
    header(frame.contentDocument!, 'USD');
    const value = {
      ...data,
      markers: [
        {
          ...data.markers[0]!,
          usdEntry: {
            reason: 'HISTORICAL_FX_PROVIDER_NOT_CONFIGURED',
            details: { remainingUsdBasis: null },
          },
        },
      ],
    };
    expect((await new AxiomNativeAverage().render(value)).reason).toBe(
      'HISTORICAL_FX_PROVIDER_NOT_CONFIGURED',
    );
    expect(api.createShape).not.toHaveBeenCalled();
  });
});

it('keeps active AVG through a history visibility toggle and retains history after full exit', async () => {
  const { frame, api, ids, setTicker } = fixture();
  setTicker(ticker('USD'));
  header(frame.contentDocument!, 'USD');
  const history = {
    ownerId: 'user',
    mint: 'mint',
    visible: true,
    diagnostics: { fills: 1, cycles: 1, displayedCycles: 1, omittedMarkers: 0, unavailable: [] },
    drawings: [
      {
        id: 'hist-average',
        ownerId: 'user',
        mint: 'mint',
        roundId: 'round',
        accountId: 'account',
        cycleId: 'cycle',
        kind: 'BUY_AVG' as const,
        levelUsd: '10000',
        time: 1,
        label: 'PF BUY AVG',
      },
      {
        id: 'hist-fill',
        ownerId: 'user',
        mint: 'mint',
        roundId: 'round',
        accountId: 'account',
        cycleId: 'cycle',
        kind: 'BUY' as const,
        levelUsd: '10000',
        time: 1,
        label: 'PF BUY',
      },
    ],
  };
  const value = {
    ...data,
    ownerId: 'user',
    history,
    markers: [
      { ...data.markers[0]!, usdEntry: { marketCapUsd: '24300', priceUsd: '0.1', details: {} } },
    ],
  };
  const adapter = new AxiomNativeAverage();
  await adapter.render(value);
  for (let i = 0; i < 8; i++) await Promise.resolve();
  expect(ids.size).toBe(3);
  await adapter.render({ ...value, history: { ...history, visible: false } });
  for (let i = 0; i < 8; i++) await Promise.resolve();
  expect(ids.size).toBe(1);
  expect(api.createShape).toHaveBeenCalledTimes(3);
  await adapter.render({ ...value, markers: [] });
  for (let i = 0; i < 8; i++) await Promise.resolve();
  expect(ids.size).toBe(2);
  adapter.invalidate('NAVIGATION');
  expect(ids.size).toBe(0);
});
