import {
  StrictMode,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { createRoot } from 'react-dom/client';

import { Overlay } from './overlay.js';
import { ChartAverageMarker, type ChartMarkers } from './chart-marker.js';
import {
  PANEL_LAYOUTS_KEY,
  clampPanelLayout,
  defaultPanelLayout,
  isPanelLayout,
  type PanelLayout,
  type PanelLayouts,
} from './layout.js';
import {
  TerminalAdapterRegistry,
  isActionableTerminal,
  type TerminalTokenState,
} from './terminal.js';

import { operatorDiagnostic } from './diagnostics.js';

operatorDiagnostic('CHART_CONTENT_READY', {
  status: 'PASS',
  frame: 'top',
  flagOrigin: location.origin,
});
const host = document.createElement('div');
host.id = 'paperfund-extension-root';
host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483646;pointer-events:none;';
document.documentElement.append(host);
const shadow = host.attachShadow({ mode: 'open' });
const style = document.createElement('style');
style.textContent = `
  :host { color-scheme: light; }
  .pf-refresh-status { padding:5px 12px;color:#756f7c;font:10px ui-sans-serif,sans-serif; }
  .pf-trade-summary { margin:7px 11px 0;padding:7px 9px;border:1px solid #d9cce8;border-radius:3px;background:#f3eff8;color:#684b91;font:600 9px ui-monospace,monospace; }
  * { box-sizing: border-box; }
  button,input,a { font: inherit; }
  button { cursor:pointer; transition:border-color .14s ease,color .14s ease,background-color .14s ease,opacity .14s ease; }
  button:disabled { cursor:not-allowed; opacity:.35; }
  button:focus-visible,input:focus-visible,a:focus-visible { outline:2px solid #875abe; outline-offset:2px; }
  .pf-panel { pointer-events:auto; position:fixed; overflow:auto; color:#25212c; background:#ffffff; border:1px solid #e4dfe9; border-radius:6px; box-shadow:0 20px 55px #20162c30; font:12px Inter,ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; scrollbar-width:thin; scrollbar-color:#ddd7e5 #ffffff; }
  .pf-panel.collapsed { overflow:hidden; }
  .pf-header { position:sticky; top:0; z-index:2; display:flex; align-items:center; justify-content:space-between; min-height:52px; padding:9px 10px; background:#fbfaff; border-bottom:1px solid #e8e3ec; cursor:grab; touch-action:none; user-select:none; }
  .pf-header:active { cursor:grabbing; }
  .pf-brand { display:flex; align-items:center; gap:9px; }
  .pf-brand>img { width:28px; height:28px; object-fit:cover; border-radius:3px; background:#fff; }
  .pf-brand>div { display:grid; gap:2px; }.pf-brand strong { font-size:12px; letter-spacing:.055em; }.pf-brand small,.pf-section-title,small { color:#8a8191; font:600 8px ui-monospace,SFMono-Regular,Consolas,monospace; letter-spacing:.11em; }.pf-terminal{padding:3px 5px;border:1px solid #e4dbe9;border-radius:3px;color:#704d9a;font:700 7px ui-monospace,SFMono-Regular,monospace;letter-spacing:.08em}
  .pf-head-actions { display:flex; gap:2px; }.pf-head-actions button,.pf-wallet-row button { background:transparent; border:0; color:#7d7485; padding:5px 7px; }
  .pf-head-actions button:hover,.pf-wallet-row button:hover { color:#fff; }
  .pf-collapsed { display:flex; justify-content:space-between; padding:9px 11px; background:#f6f3f9; }.pf-collapsed span,.green { color:#17805d!important; }.red { color:#ba4054!important; }.sell,.neutral{color:#625a68!important}.urgent{color:#9d773f!important}
  .pf-round { display:grid; grid-template-columns:1fr 1fr; border-bottom:1px solid #e8e3eb; }.pf-round>div { display:grid; gap:5px; padding:12px; }.pf-round>div+div { border-left:1px solid #e8e3eb; }.pf-round b { font:600 11px ui-monospace,monospace; }
  .pf-notice { margin:9px 11px 0; padding:9px 10px; border-left:2px solid #a77e46; background:#fff9f0; color:#5d5364; font-size:10px; line-height:1.45; }.pf-notice.success{border-color:#875abe}.pf-notice.error{border-color:#ba4054;color:#b54052}
  .pf-auth,.pf-enter { padding:18px 14px; display:grid; gap:12px; }.pf-auth p,.pf-enter p { margin:0; color:#79717f; line-height:1.6; }
  .primary { width:100%; border:1px solid #aa8ed5; border-radius:4px; padding:11px; background:#875abe; color:#ffffff; font-weight:800; font-size:10px; letter-spacing:.055em; }.primary:hover:not(:disabled){background:#9877d2}.pf-wallet { color:#4b4053; font:500 11px ui-monospace,monospace; text-align:center; }
  .pf-wallet-row { display:flex; align-items:center; gap:7px; padding:8px 11px; border-bottom:1px solid #e8e3eb; color:#756f7c; font:500 10px ui-monospace,monospace; }.pf-wallet-row button{margin-left:auto;font-size:8px}.dot{width:6px;height:6px;border-radius:50%;background:#875abe}
  .pf-previous { display:flex; align-items:center; justify-content:space-between; padding:9px 10px; background:#f3eff8; border:1px solid #d9cce8; }.pf-previous b{color:#17805d}
  .pf-metrics { display:grid; grid-template-columns:1.2fr 1.2fr .7fr; border-bottom:1px solid #e8e3eb; background:#faf8fc; }.pf-metrics>div { display:grid; gap:5px; padding:11px 10px; border-right:1px solid #e8e3eb; min-width:0; }.pf-metrics>div:last-child{border:0}.pf-metrics b{font:650 12px ui-monospace,SFMono-Regular,Consolas,monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums}
  .pf-market { display:flex; justify-content:space-between; gap:8px; padding:11px 12px; border-bottom:1px solid #e8e3eb; color:#81788a; font:500 9px ui-monospace,monospace; }.pf-market b{color:#4b4053}.pf-market.error{color:#ff8d94}.pf-market.empty{justify-content:center}
  .pf-ticket { padding:13px 12px; border-bottom:1px solid #e8e3eb; }.pf-ticket-meta { display:flex; justify-content:space-between; color:#84798b; font-size:9px; margin-bottom:13px; }.pf-ticket-meta b{color:#4d4355;margin-left:3px}.pf-ticket label{display:block;color:#817888;font-size:10px;margin-bottom:7px}
  .pf-input { position:relative; }.pf-input input{width:100%;padding:11px 45px 11px 11px;border:1px solid #ded7e6;border-radius:4px;background:#ffffff;color:#27212c;outline:0;font:600 18px ui-monospace,SFMono-Regular,Consolas,monospace;font-variant-numeric:tabular-nums}.pf-input input:focus{border-color:#8c67b8}.pf-input span{position:absolute;right:11px;top:14px;color:#80788a;font:600 9px ui-monospace,monospace}
  .pf-quick,.pf-sells { display:flex; gap:6px; margin-top:7px; }.pf-quick button,.pf-sells button{flex:1;padding:7px;border:1px solid #ded7e6;border-radius:3px;background:#f8f6fb;color:#625a6b;font:600 9px ui-monospace,monospace}.pf-quick button:hover:not(:disabled),.pf-sells button:hover:not(:disabled){color:#875abe;border-color:#a489c8}.pf-sells .danger{color:#302737;border-color:#d7ccd9;background:#f4f0f8;flex:1.5}.pf-sells .danger:hover:not(:disabled){color:#fff;border-color:#b9aaba;background:#eae5f0}
  .pf-max { display:flex; justify-content:space-between; margin:12px 0 0; padding-top:10px; border-top:1px solid #e8e3eb; color:#847b89;font-size:9px}.pf-max b{color:#3b3241;font:600 10px ui-monospace,monospace}.pf-inline-error{color:#b32d45;font-size:9px;margin-top:7px}.buy{margin-top:11px}
  .pf-position { padding:13px 12px; border-bottom:1px solid #e8e3eb; }.pf-section-title{margin-bottom:10px}.pf-position-grid{display:grid;grid-template-columns:1fr 1fr;gap:11px}.pf-position-grid span{display:grid;gap:4px;color:#867a8b;font-size:9px}.pf-position-grid b{color:#2b2632;font:650 10px ui-monospace,SFMono-Regular,Consolas,monospace;font-variant-numeric:tabular-nums}.pf-empty-position{padding:10px 12px;border-bottom:1px solid #e8e3eb;color:#817888;font-size:9px;text-align:center}
  .pf-average-entry{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0 0 11px;padding:7px 8px;border-left:2px solid #875abe;background:#f3eff8;color:#875abe;font:700 8px ui-monospace,monospace;letter-spacing:.07em}.pf-average-entry b{color:#4b3862;font-size:9px;letter-spacing:0}
  .pf-open { display:block;padding:11px 12px;color:#7d7287;text-align:center;text-decoration:none;font:700 9px ui-monospace,monospace;letter-spacing:.07em}.pf-open:hover{color:#875abe}
  .pf-resize-handle{position:sticky;float:right;right:0;bottom:0;width:18px;height:18px;margin-top:-18px;cursor:nwse-resize;touch-action:none;background:linear-gradient(135deg,transparent 45%,#a49aad 46%,#a49aad 54%,transparent 55%,transparent 68%,#847b89 69%,#847b89 77%,transparent 78%)}
`;
style.textContent += `.pf-token-summary{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:9px 0;border-bottom:1px solid #e8e3eb;margin-bottom:10px}.pf-token-summary>div{display:grid;gap:4px;min-width:0}.pf-token-summary small{font-size:10px;color:#8b969c;text-transform:uppercase}.pf-token-summary b{font:600 11px ui-monospace,monospace;overflow-wrap:anywhere}`;
shadow.append(style);
const mount = document.createElement('div');
shadow.append(mount);
const reactRoot = createRoot(mount);
const registry = new TerminalAdapterRegistry();

function ContentApp() {
  const [terminal, setTerminal] = useState<TerminalTokenState | null>(() =>
    registry.detect(location.href),
  );
  const [enabled, setEnabled] = useState(true);
  const [layout, setLayout] = useState<PanelLayout>(() =>
    defaultPanelLayout(window.innerWidth, window.innerHeight),
  );
  const [markers, setMarkers] = useState<ChartMarkers | null>(null);
  const layoutRef = useRef(layout);
  const interactionCleanup = useRef<(() => void) | null>(null);
  layoutRef.current = layout;
  useEffect(() => () => interactionCleanup.current?.(), []);
  useEffect(() => registry.observe(setTerminal), []);
  useEffect(() => {
    // Registry owns route context; the overlay separately supplies backend-resolved mint.
    const value =
      enabled && isActionableTerminal(terminal)
        ? { terminal: terminal.terminal, context: terminal.mint, url: terminal.url }
        : null;
    window.postMessage(
      { channel: 'paperfund:chart:v1', direction: 'CONTEXT', value },
      location.origin,
    );
    return () =>
      window.postMessage(
        { channel: 'paperfund:chart:v1', direction: 'CONTEXT', value: null },
        location.origin,
      );
  }, [enabled, terminal]);
  useEffect(() => {
    void chrome.storage.local
      .get({ overlayEnabled: true, [PANEL_LAYOUTS_KEY]: {} })
      .then((values) => {
        setEnabled(values['overlayEnabled'] !== false);
        const stored = (values[PANEL_LAYOUTS_KEY] ?? {}) as PanelLayouts;
        const candidate = terminal ? stored[terminal.terminal] : undefined;
        setLayout(
          isPanelLayout(candidate)
            ? clampPanelLayout(candidate, window.innerWidth, window.innerHeight)
            : defaultPanelLayout(window.innerWidth, window.innerHeight),
        );
      });
    const changed = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== 'local') return;
      if (changes['overlayEnabled']) setEnabled(changes['overlayEnabled'].newValue !== false);
      if (changes[PANEL_LAYOUTS_KEY]) {
        const stored = (changes[PANEL_LAYOUTS_KEY].newValue ?? {}) as PanelLayouts;
        const candidate = terminal ? stored[terminal.terminal] : undefined;
        setLayout(
          isPanelLayout(candidate)
            ? clampPanelLayout(candidate, window.innerWidth, window.innerHeight)
            : defaultPanelLayout(window.innerWidth, window.innerHeight),
        );
      }
    };
    chrome.storage.onChanged.addListener(changed);
    return () => chrome.storage.onChanged.removeListener(changed);
  }, [terminal?.terminal]);
  useEffect(() => {
    const clamp = () =>
      setLayout((current) => clampPanelLayout(current, window.innerWidth, window.innerHeight));
    window.addEventListener('resize', clamp);
    return () => window.removeEventListener('resize', clamp);
  }, []);

  async function persist(next: PanelLayout): Promise<void> {
    if (!terminal) return;
    const stored = await chrome.storage.local.get({ [PANEL_LAYOUTS_KEY]: {} });
    const layouts = (stored[PANEL_LAYOUTS_KEY] ?? {}) as PanelLayouts;
    await chrome.storage.local.set({
      [PANEL_LAYOUTS_KEY]: { ...layouts, [terminal.terminal]: next },
    });
  }

  function beginInteraction(mode: 'drag' | 'resize', event: ReactPointerEvent<HTMLElement>) {
    if (event.button !== 0 || !terminal) return;
    const target = event.target as Element;
    if (mode === 'drag' && target.closest('button,a,input')) return;
    event.preventDefault();
    interactionCleanup.current?.();
    const handle = event.currentTarget;
    const pointerId = event.pointerId;
    handle.setPointerCapture(pointerId);
    const startX = event.clientX;
    const startY = event.clientY;
    const initial = layoutRef.current;
    let latest = initial;
    const move = (pointer: PointerEvent) => {
      if (pointer.pointerId !== pointerId) return;
      const dx = pointer.clientX - startX;
      const dy = pointer.clientY - startY;
      latest = clampPanelLayout(
        mode === 'drag'
          ? { ...initial, x: initial.x + dx, y: initial.y + dy }
          : { ...initial, width: initial.width + dx, height: initial.height + dy },
        window.innerWidth,
        window.innerHeight,
      );
      setLayout(latest);
    };
    const cleanup = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
      interactionCleanup.current = null;
    };
    const end = (pointer: PointerEvent) => {
      if (pointer.pointerId !== pointerId) return;
      cleanup();
      void persist(latest);
    };
    interactionCleanup.current = cleanup;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  }
  if (!enabled || !isActionableTerminal(terminal)) return null;
  return (
    <>
      <Overlay
        terminal={terminal}
        layout={layout}
        onCollapsed={(value) => {
          const next = { ...layoutRef.current, collapsed: value };
          setLayout(next);
          void persist(next);
        }}
        onDragStart={(event) => beginInteraction('drag', event)}
        onResizeStart={(event) => beginInteraction('resize', event)}
        onMarkersChange={setMarkers}
        onDisable={() => void chrome.storage.local.set({ overlayEnabled: false })}
      />
      {markers?.context === terminal.mint && markers && <ChartAverageMarker value={markers} />}
    </>
  );
}

reactRoot.render(
  <StrictMode>
    <ContentApp />
  </StrictMode>,
);
