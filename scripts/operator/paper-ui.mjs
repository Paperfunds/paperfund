/* global document, window, btoa, TextEncoder */
export async function initPublicPaper(request) {
  const get = id => document.getElementById(id);
  let working = false;
  function render(s) {
    get('paper-result').textContent = s.authenticated
      ? `Production: ${s.mode} | entriesEnabled=${s.entriesEnabled} | Trusted operator verified`
      : 'Connect and sign with the configured trusted-operator wallet. Signing authenticates you; it sends no transaction.';
    get('paper-enable').disabled = working || !s.authenticated || s.mode !== 'EXIT_ONLY';
    get('paper-pause').disabled = working || !s.authenticated || s.mode !== 'ENTRY';
  }
  async function refresh() { const s = await request('/api/public-paper'); render(s); return s; }
  async function act(work) {
    if (working) return;
    working = true;
    for (const id of ['paper-connect', 'paper-enable', 'paper-pause', 'paper-refresh']) get(id).disabled = true;
    let error;
    try { await work(); } catch (e) { error = e.message; }
    finally {
      working = false;
      get('paper-connect').disabled = false;
      get('paper-refresh').disabled = false;
      try { await refresh(); } catch (e) { error ??= e.message; render({ authenticated: false }); }
      if (error) get('paper-result').textContent += `\n${error}. Refresh status before retrying. No automatic retry was made.`;
    }
  }
  get('paper-connect').onclick = () => act(async () => {
    const wallet = window.phantom?.solana ?? window.solana ?? window.solflare;
    if (!wallet?.connect || !wallet?.signMessage)
      throw Error('Open this dashboard in Chrome with your operator wallet extension enabled');
    const connected = await wallet.connect();
    const walletAddress = (connected?.publicKey ?? wallet.publicKey).toString();
    const challenge = await request('/api/public-paper/challenge', { walletAddress });
    const signed = await wallet.signMessage(new TextEncoder().encode(challenge.message), 'utf8');
    const bytes = signed.signature ?? signed;
    const signature = btoa(String.fromCharCode(...bytes));
    render(await request('/api/public-paper/verify', { walletAddress,
      challengeId: challenge.challengeId, message: challenge.message, signature }));
  });
  get('paper-enable').onclick = () => act(async () => {
    get('paper-result').textContent = 'Checking production financial protections, then enabling authenticated PAPER trading…';
    render(await request('/api/public-paper/control', { mode: 'ENTRY' }));
  });
  get('paper-pause').onclick = () => act(async () => render(await request('/api/public-paper/control', { mode: 'EXIT_ONLY' })));
  get('paper-refresh').onclick = () => act(refresh);
  await refresh();
}
