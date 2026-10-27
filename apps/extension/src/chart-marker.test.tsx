// @vitest-environment jsdom

import './test/setup.js';

import { describe, expect, it } from 'vitest';

import { findTerminalChart } from './chart-marker.js';

describe('terminal chart marker anchoring', () => {
  it("uses GMGN's stable Financial Chart iframe and ignores undersized lookalikes", () => {
    const small = document.createElement('iframe');
    small.title = 'Financial Chart';
    small.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 100,
      bottom: 100,
      width: 100,
      height: 100,
      toJSON: () => ({}),
    });
    const chart = document.createElement('iframe');
    chart.title = 'Financial Chart';
    chart.getBoundingClientRect = () => ({
      x: 10,
      y: 20,
      top: 20,
      left: 10,
      right: 710,
      bottom: 520,
      width: 700,
      height: 500,
      toJSON: () => ({}),
    });
    document.body.append(small, chart);

    expect(findTerminalChart('GMGN')).toBe(chart);
    small.remove();
    chart.remove();
  });

  it('fails closed when the terminal exposes no stable chart container', () => {
    expect(findTerminalChart('AXIOM')).toBeNull();
    expect(findTerminalChart('PADRE')).toBeNull();
  });
});
