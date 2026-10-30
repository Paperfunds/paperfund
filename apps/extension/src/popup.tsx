import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { apiRequest } from './client.js';
import { PAPERFUND_APP_URL } from './config.js';
import { PANEL_LAYOUTS_KEY } from './layout.js';

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
        <img src={chrome.runtime.getURL('icons/paperfund-mark-v2.svg')} alt="" />
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
      <button
        className="reset-layout"
        onClick={() => void chrome.storage.local.remove(PANEL_LAYOUTS_KEY)}
      >
        Reset panel layout
      </button>
      <section className="supported" aria-label="Supported terminals">
        Axiom · GMGN.ai · Terminal / Padre
      </section>
      <a href={PAPERFUND_APP_URL} target="_blank">
        Open Paperfund <span aria-hidden="true">↗</span>
      </a>
    </main>
  );
}

const css = document.createElement('style');
css.textContent = `*{box-sizing:border-box}body{margin:0;width:292px;background:#0a0d0e;color:#2b2530;font:12px Inter,ui-sans-serif,system-ui,-apple-system,sans-serif}main{padding:16px}header{display:flex;align-items:center;gap:10px;margin-bottom:15px}header img{width:34px;height:34px;object-fit:contain;background:#14101b;border-radius:7px}h1{margin:0;font-size:16px;letter-spacing:-.01em}header p{margin:3px 0 0;color:#817788;font-size:9px;text-transform:uppercase;letter-spacing:.12em}dl{border:1px solid #e7e2ec;border-radius:8px;margin:0 0 10px;background:#ffffff}dl div{display:flex;justify-content:space-between;padding:9px 10px}dl div+div{border-top:1px solid #e7e2ec}dt{color:#867d8f}dd{margin:0;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-variant-numeric:tabular-nums}.toggle-row{display:flex;align-items:center;justify-content:space-between;padding:10px;border:1px solid #e7e2ec;border-radius:6px;background:#ffffff}.toggle-row span{display:grid;gap:2px}.toggle-row strong{font-size:12px}.toggle-row small{color:#867d8f}.toggle-row input{width:32px;height:18px;margin:0;accent-color:#8158b8}.reset-layout{width:100%;margin-top:8px;padding:8px;border:1px solid #ded7e6;border-radius:5px;background:#ffffff;color:#4b4053;font-weight:650}.reset-layout:hover{border-color:#8c67b8;color:#875abe}.supported{margin:10px 0 0;color:#827888;text-align:center;font-size:10px}.supported+a{display:block;margin-top:12px;padding:10px;border-radius:5px;background:#8158b8;color:#ffffff;text-align:center;text-decoration:none;font-weight:800}a:hover{background:#9674cc}a:focus-visible,input:focus-visible,button:focus-visible{outline:2px solid #2b2530;outline-offset:2px}`;
css.textContent += `
body{background:#0e101b;color:#f3f0fa}
header img{background:#171322;border-radius:8px}
h1{color:#f6f2fc;letter-spacing:-.04em}
header p,.supported{color:#a99db7}
dl,.toggle-row{background:#191b2b;border-color:#40354d;border-radius:9px}
dl div+div{border-color:#40354d}
dt,.toggle-row small{color:#b0a2bc}
dd,.toggle-row strong{color:#f2eafb}
.toggle-row input{accent-color:#a477eb}
.reset-layout{background:#201d2e;border-color:#514160;color:#e7dbf3;border-radius:7px}
.reset-layout:hover{border-color:#9878d2;color:#d8beff}
.supported+a{background:linear-gradient(110deg,#bd9aff,#9061e5);color:#151021;border-radius:8px}
.supported+a:hover{background:linear-gradient(110deg,#d5b9ff,#aa7ff4)}
a:focus-visible,input:focus-visible,button:focus-visible{outline-color:#c3a5f6}
`;
document.head.append(css);
createRoot(document.getElementById('root')!).render(<Popup />);
