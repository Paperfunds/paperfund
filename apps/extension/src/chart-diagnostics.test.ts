import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChartDiagnosis, chartContextInventory, chartStages } from './chart-diagnostics.js';
import { installDiagnosticCollector, operatorDiagnostic } from './diagnostics.js';
import { AxiomNativeAverage } from './axiom-native.js';

afterEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete (window as Window & { paperfundChartDiagnostics?: unknown }).paperfundChartDiagnostics;
});
describe('observable chart diagnosis', () => {
  it('reports every stage, first failure and downstream unavailable reasons', () => {
    const report = new ChartDiagnosis('pair', 'mint');
    report.record('CHART_CONTEXT_DETECTED', 'PASS', 'MAIN_TOP');
    report.record('CHART_IFRAME_FOUND', 'FAIL', 'NO_FRAME');
    const result = report.finish('NO_FRAME');
    expect(result.firstFailure).toBe('CHART_IFRAME_FOUND');
    expect(result.stages.map((stage) => stage.stage)).toEqual([...chartStages]);
    expect(result.stages[2]).toMatchObject({
      status: 'UNAVAILABLE',
      reason: 'NOT_REACHED: NO_FRAME',
    });
  });
  it('inventories nested contexts and inaccessible frames without assuming top globals', () => {
    const wrapper = document.createElement('iframe');
    document.body.append(wrapper);
    const child = wrapper.contentDocument!.createElement('iframe');
    child.title = 'Financial Chart';
    wrapper.contentDocument!.body.append(child);
    Object.assign(child.contentWindow!, { tradingViewApi: {} });
    const blocked = document.createElement('iframe');
    document.body.append(blocked);
    Object.defineProperty(blocked, 'contentDocument', {
      get: () => {
        throw new DOMException('Blocked', 'SecurityError');
      },
    });
    expect(chartContextInventory(document)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          framePath: 'top/iframe[0]/iframe[0]',
          tradingViewApi: 'object',
          selectedByAdapter: false,
        }),
        expect.objectContaining({ access: 'FRAME_ACCESS_THREW', errorName: 'SecurityError' }),
      ]),
    );
  });
  it('consolidates isolated metadata in MAIN and rejects foreign sources', () => {
    localStorage.setItem('paperfund:debug', '1');
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    installDiagnosticCollector();
    const message = {
      channel: 'paperfund:diagnostic:v1',
      event: 'CHART_UPDATE_SENT',
      details: { markerCount: 1 },
    };
    window.dispatchEvent(
      new MessageEvent('message', { source: window, origin: location.origin, data: message }),
    );
    const records = (
      window as Window & { paperfundDiagnostics?: { event: string; world: string }[] }
    ).paperfundDiagnostics!;
    expect(records.at(-1)).toMatchObject({ event: 'CHART_UPDATE_SENT', world: 'ISOLATED_RELAY' });
    const count = records.length;
    window.dispatchEvent(
      new MessageEvent('message', { source: window, origin: 'https://other.test', data: message }),
    );
    expect(records).toHaveLength(count);
    const post = vi.spyOn(window, 'postMessage');
    operatorDiagnostic('CHART_UPDATE_SENT', { markerCount: 1 });
    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'paperfund:diagnostic:v1' }),
      location.origin,
    );
  });
  it('makes an absent real-context API observable before any drawing is attempted', async () => {
    localStorage.setItem('paperfund:debug', '1');
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.stubGlobal('location', { href: 'https://axiom.trade/meme/pair', pathname: '/meme/pair' });
    await new AxiomNativeAverage().render({
      url: location.href,
      context: 'pair',
      mint: 'mint',
      markers: [],
    });
    const report = (
      window as Window & {
        paperfundChartDiagnostics?: {
          firstFailure: string;
          stages: { stage: string; status: string }[];
        };
      }
    ).paperfundChartDiagnostics!;
    expect(report.firstFailure).toBe('CHART_IFRAME_FOUND');
    expect(report.stages.find((stage) => stage.stage === 'DRAWING_REQUESTED')?.status).toBe(
      'UNAVAILABLE',
    );
  });
});
