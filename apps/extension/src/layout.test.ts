import { describe, expect, it } from 'vitest';

import {
  PANEL_MAX_HEIGHT,
  PANEL_MAX_WIDTH,
  PANEL_MIN_HEIGHT,
  PANEL_MIN_WIDTH,
  clampPanelLayout,
  defaultPanelLayout,
  isPanelLayout,
  type PanelLayouts,
} from './layout.js';

describe('per-terminal panel layout', () => {
  it('uses a practical default and keeps the panel inside the viewport', () => {
    expect(defaultPanelLayout(1280, 800)).toEqual({
      x: 890,
      y: 14,
      width: 376,
      height: 660,
      collapsed: false,
    });
    expect(
      clampPanelLayout({ x: -200, y: 900, width: 900, height: 20, collapsed: true }, 1280, 800),
    ).toEqual({
      x: 8,
      y: 472,
      width: PANEL_MAX_WIDTH,
      height: PANEL_MIN_HEIGHT,
      collapsed: true,
    });
  });

  it('preserves independent terminal preferences and validates stored data', () => {
    const layouts: PanelLayouts = {
      AXIOM: { x: 8, y: 8, width: PANEL_MIN_WIDTH, height: PANEL_MIN_HEIGHT, collapsed: false },
      GMGN: { x: 100, y: 40, width: PANEL_MAX_WIDTH, height: PANEL_MAX_HEIGHT, collapsed: true },
    };
    expect(layouts.AXIOM).not.toEqual(layouts.GMGN);
    expect(isPanelLayout(layouts.AXIOM)).toBe(true);
    expect(isPanelLayout({ x: '8', y: 8, width: 300, height: 320, collapsed: false })).toBe(false);
  });
});
