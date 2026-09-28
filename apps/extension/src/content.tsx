import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { Overlay } from './overlay.js';
import { TerminalAdapterRegistry, type TerminalTokenState } from './terminal.js';

const host = document.createElement('div');
host.id = 'paperfund-extension-root';
host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483646;pointer-events:none;';
document.documentElement.append(host);
const shadow = host.attachShadow({ mode: 'open' });
const style = document.createElement('style');
style.textContent = `
  :host { color-scheme: dark; }
  * { box-sizing: border-box; }
  button,input,a { font: inherit; }
  button { cursor:pointer; transition:border-color .14s ease,color .14s ease,background-color .14s ease,opacity .14s ease; }
  button:disabled { cursor:not-allowed; opacity:.35; }
  button:focus-visible,input:focus-visible,a:focus-visible { outline:2px solid #74e6aa; outline-offset:2px; }
  .pf-panel { pointer-events:auto; position:fixed; right:14px; bottom:14px; width:336px; max-height:calc(100vh - 28px); overflow:auto; color:#f1f4f3; background:#090d0f; border:1px solid #2b3337; border-radius:6px; box-shadow:0 20px 55px #000c; font:12px Inter,ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; scrollbar-width:thin; scrollbar-color:#313a3e #090d0f; }
  .pf-panel.collapsed { width:268px; overflow:hidden; }
  .pf-header { position:sticky; top:0; z-index:2; display:flex; align-items:center; justify-content:space-between; min-height:52px; padding:9px 10px; background:#0c1113fa; border-bottom:1px solid #252d30; }
  .pf-brand { display:flex; align-items:center; gap:9px; }
  .pf-brand>img { width:28px; height:28px; object-fit:cover; border-radius:3px; background:#fff; }
  .pf-brand>div { display:grid; gap:2px; }.pf-brand strong { font-size:12px; letter-spacing:.055em; }.pf-brand small,.pf-section-title,small { color:#78858a; font:600 8px ui-monospace,SFMono-Regular,Consolas,monospace; letter-spacing:.11em; }.pf-terminal{padding:3px 5px;border:1px solid #334039;border-radius:3px;color:#82d9aa;font:700 7px ui-monospace,SFMono-Regular,monospace;letter-spacing:.08em}
  .pf-head-actions { display:flex; gap:2px; }.pf-head-actions button,.pf-wallet-row button { background:transparent; border:0; color:#77858a; padding:5px 7px; }
  .pf-head-actions button:hover,.pf-wallet-row button:hover { color:#fff; }
  .pf-collapsed { display:flex; justify-content:space-between; padding:9px 11px; background:#0a0f11; }.pf-collapsed span,.green { color:#74e6aa!important; }.red { color:#ef7f87!important; }.sell,.neutral{color:#aab5b8!important}.urgent{color:#e4b96a!important}
  .pf-round { display:grid; grid-template-columns:1fr 1fr; border-bottom:1px solid #20282c; }.pf-round>div { display:grid; gap:5px; padding:12px; }.pf-round>div+div { border-left:1px solid #20282c; }.pf-round b { font:600 11px ui-monospace,monospace; }
  .pf-notice { margin:9px 11px 0; padding:9px 10px; border-left:2px solid #d2a956; background:#15191a; color:#c4ccce; font-size:10px; line-height:1.45; }.pf-notice.success{border-color:#74e6aa}.pf-notice.error{border-color:#ef7f87;color:#f2a5aa}
  .pf-auth,.pf-enter { padding:18px 14px; display:grid; gap:12px; }.pf-auth p,.pf-enter p { margin:0; color:#89969b; line-height:1.6; }
  .primary { width:100%; border:1px solid #8ce8b6; border-radius:4px; padding:11px; background:#74e6aa; color:#06120c; font-weight:800; font-size:10px; letter-spacing:.055em; }.primary:hover:not(:disabled){background:#86efb8}.pf-wallet { color:#cbd4d6; font:500 11px ui-monospace,monospace; text-align:center; }
  .pf-wallet-row { display:flex; align-items:center; gap:7px; padding:8px 11px; border-bottom:1px solid #20282c; color:#9ba8ad; font:500 10px ui-monospace,monospace; }.pf-wallet-row button{margin-left:auto;font-size:8px}.dot{width:6px;height:6px;border-radius:50%;background:#74e6aa}
  .pf-previous { display:flex; align-items:center; justify-content:space-between; padding:9px 10px; background:#102018; border:1px solid #294b3a; }.pf-previous b{color:#76f4b1}
  .pf-metrics { display:grid; grid-template-columns:1.2fr 1.2fr .7fr; border-bottom:1px solid #20282c; background:#0b1012; }.pf-metrics>div { display:grid; gap:5px; padding:11px 10px; border-right:1px solid #20282c; min-width:0; }.pf-metrics>div:last-child{border:0}.pf-metrics b{font:650 12px ui-monospace,SFMono-Regular,Consolas,monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums}
  .pf-market { display:flex; justify-content:space-between; gap:8px; padding:11px 12px; border-bottom:1px solid #20282c; color:#839096; font:500 9px ui-monospace,monospace; }.pf-market b{color:#cbd4d6}.pf-market.error{color:#ff8d94}.pf-market.empty{justify-content:center}
  .pf-ticket { padding:13px 12px; border-bottom:1px solid #20282c; }.pf-ticket-meta { display:flex; justify-content:space-between; color:#708087; font-size:9px; margin-bottom:13px; }.pf-ticket-meta b{color:#bbc6c9;margin-left:3px}.pf-ticket label{display:block;color:#8f9ba0;font-size:10px;margin-bottom:7px}
  .pf-input { position:relative; }.pf-input input{width:100%;padding:11px 45px 11px 11px;border:1px solid #30393d;border-radius:4px;background:#060a0c;color:#f5f7f6;outline:0;font:600 18px ui-monospace,SFMono-Regular,Consolas,monospace;font-variant-numeric:tabular-nums}.pf-input input:focus{border-color:#579274}.pf-input span{position:absolute;right:11px;top:14px;color:#69777c;font:600 9px ui-monospace,monospace}
  .pf-quick,.pf-sells { display:flex; gap:6px; margin-top:7px; }.pf-quick button,.pf-sells button{flex:1;padding:7px;border:1px solid #30393d;border-radius:3px;background:#101619;color:#9aa6aa;font:600 9px ui-monospace,monospace}.pf-quick button:hover:not(:disabled),.pf-sells button:hover:not(:disabled){color:#74e6aa;border-color:#436b58}.pf-sells .danger{color:#eef2f0;border-color:#596468;background:#1b2225;flex:1.5}.pf-sells .danger:hover:not(:disabled){color:#fff;border-color:#879397;background:#242d30}
  .pf-max { display:flex; justify-content:space-between; margin:12px 0 0; padding-top:10px; border-top:1px solid #20282c; color:#718086;font-size:9px}.pf-max b{color:#d6dfdc;font:600 10px ui-monospace,monospace}.pf-inline-error{color:#ff9097;font-size:9px;margin-top:7px}.buy{margin-top:11px}
  .pf-position,.pf-activity { padding:13px 12px; border-bottom:1px solid #20282c; }.pf-section-title{margin-bottom:10px}.pf-position-grid{display:grid;grid-template-columns:1fr 1fr;gap:11px}.pf-position-grid span{display:grid;gap:4px;color:#738187;font-size:9px}.pf-position-grid b{color:#e0e6e3;font:650 10px ui-monospace,SFMono-Regular,Consolas,monospace;font-variant-numeric:tabular-nums}.pf-empty-position{padding:10px 12px;border-bottom:1px solid #20282c;color:#6f7c81;font-size:9px;text-align:center}
  .pf-activity p{color:#68767b;font-size:10px}.pf-activity>div:not(.pf-section-title){display:grid;grid-template-columns:76px 1fr auto;gap:7px;padding:7px 0;border-top:1px solid #192024;align-items:center}.pf-activity span{font:700 8px ui-monospace,monospace}.pf-activity b{font:500 9px ui-monospace,monospace;color:#aeb9bc}.pf-activity time{color:#637076;font-size:8px}
  .pf-open { display:block;padding:11px 12px;color:#909c99;text-align:center;text-decoration:none;font:700 9px ui-monospace,monospace;letter-spacing:.07em}.pf-open:hover{color:#74e6aa}
  @media(max-width:500px){.pf-panel{right:8px;bottom:8px;width:calc(100vw - 16px);max-height:calc(100vh - 16px)}}
`;
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
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => registry.observe(setTerminal), []);
  useEffect(() => {
    void chrome.storage.local
      .get({ overlayEnabled: true, overlayCollapsed: false })
      .then((values) => {
        setEnabled(values['overlayEnabled'] !== false);
        setCollapsed(values['overlayCollapsed'] === true);
      });
    const changed = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== 'local') return;
      if (changes['overlayEnabled']) setEnabled(changes['overlayEnabled'].newValue !== false);
      if (changes['overlayCollapsed']) setCollapsed(changes['overlayCollapsed'].newValue === true);
    };
    chrome.storage.onChanged.addListener(changed);
    return () => chrome.storage.onChanged.removeListener(changed);
  }, []);
  if (!enabled || !terminal) return null;
  return (
    <Overlay
      terminal={terminal}
      collapsed={collapsed}
      onCollapsed={(value) => {
        setCollapsed(value);
        void chrome.storage.local.set({ overlayCollapsed: value });
      }}
      onDisable={() => void chrome.storage.local.set({ overlayEnabled: false })}
    />
  );
}

reactRoot.render(
  <StrictMode>
    <ContentApp />
  </StrictMode>,
);
