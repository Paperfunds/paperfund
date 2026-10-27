import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { ROOT, saveEvidence } from './common.mjs';

const run = promisify(execFile);
const API = 'https://api.paperfund.app/api/v1/';
async function protections() {
  const gate = resolve(ROOT, 'docs/linked-pair-20261024/public-startup-qualification-20261026/gate.mjs');
  for (const action of ['qualify', 'state']) {
    const { stdout } = await run(process.execPath, [gate, action, 'Production'], {
      timeout: 30000, windowsHide: true, maxBuffer: 1024 * 1024,
    });
    if (JSON.parse(stdout).status !== 'PASS') throw Error('PAPER_FINANCIAL_PROTECTIONS_FAILED');
  }
}

// One protected local-dashboard session; API credentials never cross back into its page.
export function publicPaperControl({ fetcher = fetch, guard = protections, evidence = saveEvidence, now = Date.now } = {}) {
  let token, expires = 0, pending, busy = false;
  async function api(path, payload, authenticated = false) {
    if (authenticated && (!token || now() >= expires)) {
      token = undefined;
      throw Error('PAPER_OPERATOR_SIGN_IN_REQUIRED');
    }
    const response = await fetcher(API + path, {
      method: payload === undefined ? 'GET' : 'POST',
      headers: { ...(authenticated ? { authorization: `Bearer ${token}` } : {}),
        ...(payload === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
      redirect: 'error', signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) {
      if (response.status === 401) token = undefined;
      throw Error(`PAPER_API_HTTP_${response.status}`);
    }
    return response.json();
  }
  async function capability() {
    const status = await api('capabilities/generic-pumpswap', undefined, true);
    if (status.canControl !== true) {
      token = undefined;
      throw Error('PAPER_CONFIGURED_TRUSTED_OPERATOR_REQUIRED');
    }
    return status;
  }
  return {
    async status() {
      if (!token || now() >= expires) { token = undefined; return { authenticated: false }; }
      return { authenticated: true, ...await capability() };
    },
    async challenge(body) {
      if (busy) throw Error('PAPER_OPERATOR_BUSY');
      if (typeof body.walletAddress !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(body.walletAddress))
        throw Error('PAPER_INVALID_WALLET');
      token = undefined;
      const result = await api('auth/challenge', { walletAddress: body.walletAddress });
      pending = { walletAddress: body.walletAddress, challengeId: result.challengeId, message: result.message, expires: now() + 120000 };
      return result;
    },
    async verify(body) {
      if (busy) throw Error('PAPER_OPERATOR_BUSY');
      const challenge = pending;
      pending = undefined;
      if (!challenge || now() >= challenge.expires || body.walletAddress !== challenge.walletAddress ||
          body.challengeId !== challenge.challengeId || body.message !== challenge.message ||
          typeof body.signature !== 'string' || body.signature.length > 128)
        throw Error('PAPER_WALLET_CHALLENGE_MISMATCH');
      token = undefined;
      const result = await api('auth/verify', { walletAddress: body.walletAddress,
        challengeId: body.challengeId, message: body.message, signature: body.signature, transport: 'extension' });
      if (typeof result.sessionToken !== 'string') throw Error('PAPER_AUTHENTICATION_FAILED');
      token = result.sessionToken;
      expires = now() + 30 * 60 * 1000;
      return { authenticated: true, ...await capability() };
    },
    async control(body) {
      if (busy) throw Error('PAPER_OPERATOR_BUSY');
      if (Object.keys(body).length !== 1 || !['ENTRY', 'EXIT_ONLY'].includes(body.mode))
        throw Error('PAPER_INVALID_CONTROL');
      busy = true;
      try {
        const before = await capability();
        if (before.mode === 'HARD_STOP') throw Error('PAPER_HARD_STOP_REQUIRES_SEPARATE_REVIEW');
        if (body.mode === 'ENTRY') {
          if (before.mode !== 'EXIT_ONLY') throw Error('PAPER_EXPECTED_EXIT_ONLY_REFRESH_STATUS');
          await guard();
          const current = await capability();
          if (current.mode !== 'EXIT_ONLY') throw Error('PAPER_CONTROL_CHANGED_REFRESH_STATUS');
        }
        // The only production write here is the reviewed, authenticated API control call.
        await api('capabilities/generic-pumpswap/control', { mode: body.mode }, true);
        const after = await capability();
        if (after.mode !== body.mode || after.entriesEnabled !== (body.mode === 'ENTRY'))
          throw Error('PAPER_CONTROL_NOT_CONFIRMED_REFRESH_STATUS');
        const record = { at: new Date(now()).toISOString(), target: API, before, after };
        const saved = await evidence('public-paper-control', record);
        return { authenticated: true, ...after, evidence: saved };
      } finally { busy = false; }
    },
  };
}
