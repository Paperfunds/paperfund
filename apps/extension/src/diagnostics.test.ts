import { afterEach, describe, expect, it, vi } from 'vitest';
import { operatorDiagnostic } from './diagnostics.js';

afterEach(() => { localStorage.clear(); delete (window as Window & { paperfundDiagnostics?: unknown[] }).paperfundDiagnostics; vi.restoreAllMocks(); });
describe('operator diagnostics', () => {
  it('is silent by default and bounds explicitly enabled records', () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    operatorDiagnostic('CHART', { reason: 'AXIOM_AXIS_UNVERIFIED' });
    expect(debug).not.toHaveBeenCalled();
    localStorage.setItem('paperfund:debug', '1');
    for (let i = 0; i < 205; i++) operatorDiagnostic('CHART', { drawn: i });
    expect((window as Window & { paperfundDiagnostics?: unknown[] }).paperfundDiagnostics).toHaveLength(200);
    expect(debug).toHaveBeenCalledTimes(205);
  });
  it('does not interrupt behavior when diagnostic storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('disabled'); });
    expect(() => operatorDiagnostic('CHART', {})).not.toThrow();
  });
});
