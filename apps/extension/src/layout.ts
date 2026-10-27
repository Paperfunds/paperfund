import type { TerminalId } from './terminal.js';

export const PANEL_LAYOUTS_KEY = 'paperfundPanelLayouts';
export const PANEL_MIN_WIDTH = 300;
export const PANEL_MIN_HEIGHT = 320;
export const PANEL_MAX_WIDTH = 560;
export const PANEL_MAX_HEIGHT = 820;
const VIEWPORT_MARGIN = 8;

export interface PanelLayout {
  x: number;
  y: number;
  width: number;
  height: number;
  collapsed: boolean;
}

export type PanelLayouts = Partial<Record<TerminalId, PanelLayout>>;

export function defaultPanelLayout(viewportWidth: number, viewportHeight: number): PanelLayout {
  const width = Math.min(376, Math.max(PANEL_MIN_WIDTH, viewportWidth - VIEWPORT_MARGIN * 2));
  const height = Math.min(660, Math.max(PANEL_MIN_HEIGHT, viewportHeight - VIEWPORT_MARGIN * 2));
  return clampPanelLayout(
    { x: viewportWidth - width - 14, y: 14, width, height, collapsed: false },
    viewportWidth,
    viewportHeight,
  );
}

export function clampPanelLayout(
  layout: PanelLayout,
  viewportWidth: number,
  viewportHeight: number,
): PanelLayout {
  const availableWidth = Math.max(1, viewportWidth - VIEWPORT_MARGIN * 2);
  const availableHeight = Math.max(1, viewportHeight - VIEWPORT_MARGIN * 2);
  const width = Math.min(
    Math.max(layout.width, Math.min(PANEL_MIN_WIDTH, availableWidth)),
    Math.min(PANEL_MAX_WIDTH, availableWidth),
  );
  const height = Math.min(
    Math.max(layout.height, Math.min(PANEL_MIN_HEIGHT, availableHeight)),
    Math.min(PANEL_MAX_HEIGHT, availableHeight),
  );
  return {
    x: Math.min(
      Math.max(layout.x, VIEWPORT_MARGIN),
      Math.max(VIEWPORT_MARGIN, viewportWidth - width - VIEWPORT_MARGIN),
    ),
    y: Math.min(
      Math.max(layout.y, VIEWPORT_MARGIN),
      Math.max(VIEWPORT_MARGIN, viewportHeight - height - VIEWPORT_MARGIN),
    ),
    width,
    height,
    collapsed: layout.collapsed,
  };
}

export function isPanelLayout(value: unknown): value is PanelLayout {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<PanelLayout>;
  return (
    ['x', 'y', 'width', 'height'].every(
      (key) =>
        typeof item[key as keyof PanelLayout] === 'number' &&
        Number.isFinite(item[key as keyof PanelLayout] as number),
    ) && typeof item.collapsed === 'boolean'
  );
}
