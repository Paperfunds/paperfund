import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publicPaperControl } from './public-paper.mjs';
import { operatorServer } from './server.mjs';

function fixture({ trusted = true, mode = 'EXIT_ONLY', guardFails = false } = {}) {
  const calls = [], saved = [];
  let guarded = 0;
  const paper = publicPaperControl({
    guard: async () => { guarded++; if (guardFails) throw Error('PAPER_FINANCIAL_PROTECTIONS_FAILED'); },
    evidence: async (name, value) => { saved.push({ name, value }); return { file: 'test.json' }; },
    fetcher: async (url, options) => {
      calls.push({ url, options });
      assert.ok(url.startsWith('https://api.paperfund.app/api/v1/'));
      assert.equal(options.redirect, 'error');
      const payload = options.body && JSON.parse(options.body);
      let result;
      if (url.endsWith('/auth/challenge')) result = { challengeId: 'nonce', message: 'Sign this exact login message' };
      else if (url.endsWith('/auth/verify')) result = { sessionToken: 'private-test-token' };
      else {
        assert.equal(options.headers.authorization, 'Bearer private-test-token');
        if (url.endsWith('/control')) { assert.deepEqual(Object.keys(payload), ['mode']); mode = payload.mode; }
        result = { canControl: trusted, mode, entriesEnabled: mode === 'ENTRY', userId: 'trusted-user' };
      }
      return { ok: true, status: 200, json: async () => result };
    },
  });
  async function login() {
    const walletAddress = '11111111111111111111111111111111';
    const challenge = await paper.challenge({ walletAddress });
    return paper.verify({ walletAddress, ...challenge, signature: 'signed' });
  }
  return { paper, calls, saved, login, guarded: () => guarded };
}
test('no wallet authentication means no control request', async () => {
  const f = fixture();
  assert.deepEqual(await f.paper.status(), { authenticated: false });
  await assert.rejects(f.paper.control({ mode: 'ENTRY' }), /SIGN_IN_REQUIRED/);
  assert.equal(f.calls.length, 0);
});
test('ordinary authenticated wallets cannot activate ENTRY or retain the server credential', async () => {
  const f = fixture({ trusted: false });
  await assert.rejects(f.login(), /CONFIGURED_TRUSTED_OPERATOR_REQUIRED/);
  assert.deepEqual(await f.paper.status(), { authenticated: false });
  assert.ok(!f.calls.some(c => c.url.endsWith('/control')));
});
test('challenge mismatch/replay never reaches API verification', async () => {
  const f = fixture();
  await f.paper.challenge({ walletAddress: '11111111111111111111111111111111' });
  await assert.rejects(f.paper.verify({ challengeId: 'forged' }), /CHALLENGE_MISMATCH/);
  await assert.rejects(f.paper.verify({ challengeId: 'nonce' }), /CHALLENGE_MISMATCH/);
  assert.equal(f.calls.length, 1);
});
test('trusted operator enables exact production control after safeguards and can pause buys', async () => {
  const f = fixture();
  const login = await f.login();
  assert.equal(JSON.stringify(login).includes('private-test-token'), false);
  const enabled = await f.paper.control({ mode: 'ENTRY' });
  assert.equal(enabled.mode, 'ENTRY'); assert.equal(enabled.entriesEnabled, true);
  assert.equal(f.guarded(), 1);
  const paused = await f.paper.control({ mode: 'EXIT_ONLY' });
  assert.equal(paused.mode, 'EXIT_ONLY'); assert.equal(paused.entriesEnabled, false);
  assert.equal(f.calls.filter(c => c.url.endsWith('/control')).length, 2);
  assert.equal(JSON.stringify(f.saved).includes('private-test-token'), false);
  await assert.rejects(f.paper.control({ mode: 'ENTRY', url: 'https://other.test' }), /INVALID_CONTROL/);
});
test('failed financial safeguards and HARD_STOP cannot be overridden', async () => {
  for (const options of [{ guardFails: true }, { mode: 'HARD_STOP' }]) {
    const f = fixture(options); await f.login();
    await assert.rejects(f.paper.control({ mode: 'ENTRY' }), /PROTECTIONS_FAILED|HARD_STOP/);
    assert.ok(!f.calls.some(c => c.url.endsWith('/control')));
  }
});
test('local dashboard control requires existing session cookie, exact origin and safe host', async () => {
  let calls = 0;
  const serverPort = 3197;
  const { server } = operatorServer({ port: serverPort, token: 'local-test-token',
    paper: { status: async () => ({ authenticated: false }), control: async b => { calls++; return b; } } });
  await new Promise(resolve => server.listen(serverPort, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${serverPort}`;
  try {
    const payload = { method: 'POST', headers: { origin: base, 'content-type': 'application/json' }, body: '{"mode":"ENTRY"}' };
    assert.equal((await fetch(base + '/api/public-paper/control', payload)).status, 401);
    const session = await fetch(base + '/session', { ...payload, body: '{"token":"local-test-token"}' });
    const cookie = session.headers.get('set-cookie').split(';')[0];
    assert.equal((await fetch(base + '/api/public-paper/control', { ...payload, headers: { ...payload.headers, cookie, origin: 'https://evil.test' } })).status, 403);
    assert.equal((await fetch(base + '/api/public-paper/control', { ...payload, headers: { 'content-type': 'application/json', cookie } })).status, 403);
    assert.equal((await fetch(base + '/api/public-paper/control', { ...payload, headers: { ...payload.headers, cookie, 'x-forwarded-host': 'evil.test' } })).status, 403);
    assert.equal(calls, 0);
    assert.equal((await fetch(base + '/api/public-paper/control', { ...payload, headers: { ...payload.headers, cookie } })).status, 200);
    assert.equal(calls, 1);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
