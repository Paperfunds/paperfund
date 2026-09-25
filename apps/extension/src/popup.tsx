import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { apiRequest } from './client.js';
import { PAPERFUND_APP_URL } from './config.js';

function Popup() {
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
      <h1>
        <span>P</span> Paperfund
      </h1>
      <p>Paper trading only</p>
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
      <label>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => {
            setEnabled(event.target.checked);
            void chrome.storage.local.set({ overlayEnabled: event.target.checked });
          }}
        />{' '}
        Show overlay on Axiom
      </label>
      <a href={PAPERFUND_APP_URL} target="_blank">
        Open Paperfund ↗
      </a>
    </main>
  );
}

const css = document.createElement('style');
css.textContent = `*{box-sizing:border-box}body{margin:0;width:280px;background:#0b0f11;color:#e9eef0;font:12px system-ui,sans-serif}main{padding:16px}h1{display:flex;align-items:center;gap:8px;margin:0;font-size:16px}h1 span{display:grid;place-items:center;width:25px;height:25px;border-radius:5px;background:#76f4b1;color:#07140d}p{margin:5px 0 15px;color:#6f7d82;font-size:9px;text-transform:uppercase;letter-spacing:.1em}dl{border:1px solid #253036;margin:0 0 14px}dl div{display:flex;justify-content:space-between;padding:9px}dl div+div{border-top:1px solid #253036}dt{color:#748287}dd{margin:0;font-family:monospace}label{display:flex;gap:8px;align-items:center;color:#aeb9bc}a{display:block;margin-top:14px;padding:10px;background:#76f4b1;color:#07140d;text-align:center;text-decoration:none;font-weight:800;border-radius:5px}`;
document.head.append(css);
createRoot(document.getElementById('root')!).render(<Popup />);
