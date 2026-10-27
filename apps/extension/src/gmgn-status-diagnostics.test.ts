import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installChartBridge } from './chart-native.js';
import { operatorDiagnostic } from './diagnostics.js';

const { render } = vi.hoisted(() => ({ render: vi.fn() }));
vi.mock('./gmgn-lightweight.js', () => ({
  GmgnLightweightDrawings: class {
    render = render;
    invalidate() {}
  },
}));

type Record = { event: string; context?: string; mint?: string; reason?: string; world?: string };
const host = window as Window & { paperfundDiagnostics?: Record[]; paperfundChartBridgeCleanup?: () => void };
const mint = 'A7rRfLf67GMp5DFeY7s4kUaZLZbbz6UFPM5XYSg2pump';
const url = `https://gmgn.ai/sol/token/${mint}`;
const input = { context: mint, mint, url, ownerId: 'owner', markers: [] };
const statuses = () => (host.paperfundDiagnostics ?? []).filter(record => record.event === 'GMGN_CHART_STATUS');
const send = () => window.dispatchEvent(new MessageEvent('message', { source: window,
  origin: 'https://gmgn.ai', data: { channel: 'paperfund:chart:v1', direction: 'UPDATE', value: input } }));
const tick = () => vi.advanceTimersByTime(100);

beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal('location', new URL(url));
  localStorage.removeItem('paperfund:debug'); delete host.paperfundDiagnostics;
  render.mockReset().mockReturnValue({ available: false, reason: 'GMGN_CHART_INITIALIZING', drawn: 0 });
  vi.spyOn(console, 'debug').mockImplementation(() => {});
  vi.spyOn(window, 'postMessage').mockImplementation(() => {});
  installChartBridge();
});
afterEach(() => {
  host.paperfundChartBridgeCleanup?.(); delete host.paperfundChartBridgeCleanup;
  delete host.paperfundDiagnostics; localStorage.removeItem('paperfund:debug');
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
});

describe('GMGN status diagnostic recovery', () => {
  it('reports unchanged status when debug is enabled after the first update', () => {
    send(); expect(statuses()).toHaveLength(0);
    localStorage.setItem('paperfund:debug', '1'); tick();
    expect(statuses()).toHaveLength(1);
    expect(statuses()[0]).toMatchObject({ context: mint, mint, world: 'MAIN', reason: 'GMGN_CHART_INITIALIZING' });
    tick(); expect(statuses()).toHaveLength(1);
  });
  it('restores an evicted record once and retains the existing 200-record bound', () => {
    localStorage.setItem('paperfund:debug', '1'); send(); expect(statuses()).toHaveLength(1);
    for (let i = 0; i < 200; i++) operatorDiagnostic('OTHER_DIAGNOSTIC', { sequence: i }, 'MAIN');
    expect(statuses()).toHaveLength(0); tick();
    expect(statuses()).toHaveLength(1); expect(host.paperfundDiagnostics).toHaveLength(200);
    tick(); expect(statuses()).toHaveLength(1);
  });
  it('deduplicates unchanged status while delivering it on every existing poll', () => {
    localStorage.setItem('paperfund:debug', '1'); send(); tick(); tick();
    expect(statuses()).toHaveLength(1); expect(render).toHaveBeenCalledTimes(3);
    const posts = vi.mocked(window.postMessage).mock.calls.filter(([message]) =>
      message.channel === 'paperfund:chart:v1' && message.direction === 'STATUS');
    expect(posts).toHaveLength(3);
    for (const [message] of posts) expect(message).toMatchObject({ context: mint,
      reason: 'GMGN_CHART_INITIALIZING', available: false, drawn: 0 });
    render.mockReturnValue({ available: false, reason: 'GMGN_UNITS_UNVERIFIED', drawn: 0 });
    tick(); expect(statuses()).toHaveLength(2); tick(); expect(statuses()).toHaveLength(2);
  });
  it('does not treat another token or world record as a retained current-context MAIN status', () => {
    send(); localStorage.setItem('paperfund:debug', '1');
    host.paperfundDiagnostics = [
      { event: 'GMGN_CHART_STATUS', context: 'other', mint: 'other', world: 'MAIN' },
      { event: 'GMGN_CHART_STATUS', context: mint, mint, world: 'ISOLATED_RELAY' },
    ];
    tick(); expect(statuses().filter(record => record.context === mint && record.world === 'MAIN')).toHaveLength(1);
    tick(); expect(statuses()).toHaveLength(3);
  });
  it('remains silent with debug disabled even when records are absent', () => {
    send(); tick(); expect(statuses()).toHaveLength(0); expect(render).toHaveBeenCalledTimes(2);
  });
  it('preserves status delivery when diagnostic storage throws', () => {
    send(); vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('STORAGE_DISABLED'); });
    expect(tick).not.toThrow(); expect(statuses()).toHaveLength(0);
    expect(vi.mocked(window.postMessage).mock.calls.filter(([message]) => message.direction === 'STATUS')).toHaveLength(2);
  });
});
