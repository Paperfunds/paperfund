import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { apiRequest } from './client.js';
import { PAPERFUND_APP_URL } from './config.js';

export function Popup() {
  const [enabled, setEnabled] = useState(true);
  const [wallet, setWallet] = useState('Not signed in');
  const [round, setRound] = useState('Unavailable');
  useEffect(() => {
    void chrome.storage.local
      .get({ overlayEnabled: true })
      .then((value) => setEnabled(value['overlayEnabled'] !== false));
    void apiRequest('ME')
      .then((value) =>
        setWallet(`${value.user.walletAddress.slice(0, 5)}…${value.user.walletAddress.slice(-5)}`),
      )
      .catch(() => undefined);
    void apiRequest('CURRENT_ROUND')
      .then((value) => setRound(value.round?.state ?? 'Unavailable'))
      .catch(() => undefined);
  }, []);
  return (
    <main>
      <header>
        <img src={chrome.runtime.getURL('icons/paperfund-mark.png')} alt="" />
        <div>
          <h1>Paperfund</h1>
          <p>Paper trading only</p>
        </div>
      </header>
      <dl>
        <div>
          <dt>Wallet</dt>
          <dd>{wallet}</dd>
        </div>
        <div>
          <dt>Round</dt>
          <dd>{round}</dd>
        </div>
      </dl>
      <label className="toggle-row">
        <span>
          <strong>Overlay</strong>
          <small>{enabled ? 'Enabled' : 'Disabled'}</small>
        </span>
        <input
          type="checkbox"
          checked={enabled}
          aria-label="Overlay enabled"
          onChange={(event) => {
            setEnabled(event.target.checked);
            void chrome.storage.local.set({ overlayEnabled: event.target.checked });
          }}
        />
      </label>
      <section className="supported" aria-label="Supported terminals">
        Axiom · GMGN.ai · Terminal.trade
      </section>
      <a href={PAPERFUND_APP_URL} target="_blank">
        Open Paperfund <span aria-hidden="true">↗</span>
      </a>
    </main>
  );
}

const css = document.createElement('style');
css.textContent = `*{box-sizing:border-box}body{margin:0;width:292px;background:#0a0d0e;color:#f3f5f5;font:12px Inter,ui-sans-serif,system-ui,-apple-system,sans-serif}main{padding:16px}header{display:flex;align-items:center;gap:10px;margin-bottom:15px}header img{width:34px;height:34px;object-fit:contain;background:#fff;border-radius:4px}h1{margin:0;font-size:16px;letter-spacing:-.01em}header p{margin:3px 0 0;color:#7e898c;font-size:9px;text-transform:uppercase;letter-spacing:.12em}dl{border:1px solid #262d2f;border-radius:6px;margin:0 0 10px;background:#101415}dl div{display:flex;justify-content:space-between;padding:9px 10px}dl div+div{border-top:1px solid #262d2f}dt{color:#849093}dd{margin:0;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-variant-numeric:tabular-nums}.toggle-row{display:flex;align-items:center;justify-content:space-between;padding:10px;border:1px solid #262d2f;border-radius:6px;background:#101415}.toggle-row span{display:grid;gap:2px}.toggle-row strong{font-size:12px}.toggle-row small{color:#849093}.toggle-row input{width:32px;height:18px;margin:0;accent-color:#71e7a4}.supported{margin:10px 0 0;color:#758084;text-align:center;font-size:10px}.supported+a{display:block;margin-top:12px;padding:10px;border-radius:5px;background:#71e7a4;color:#06100a;text-align:center;text-decoration:none;font-weight:800}a:hover{background:#85efb4}a:focus-visible,input:focus-visible{outline:2px solid #f3f5f5;outline-offset:2px}`;
document.head.append(css);
createRoot(document.getElementById('root')!).render(<Popup />);
