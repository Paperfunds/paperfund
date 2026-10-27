import {prepareOperatorWinnerTest,operatorWinnerTestStatus} from './winner-test-review.mjs';import {launchWinnerTest} from './winner-test-client.mjs';
import {prepareDeveloperTransfer} from './developer-transfer-review.mjs';
import {launchDeveloperTransfer} from './developer-transfer-client.mjs';
import {launchManualClaim} from './manual-claim.mjs';
import { automationStatus, automationControl, exportPolicyDraft } from './automation-client.mjs';
import { rewardOverview } from './reward-overview.mjs';
import { captureRewardAccounting } from './reward-accounting.mjs';
import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ROOT, WALLET, json, saveEvidence } from './common.mjs';
import { systemStatus } from './status.mjs';
import { captureDiscovery } from './discovery.mjs';
import { reviewPlan } from './treasury.mjs';
import { publicError } from './errors.mjs';
import { prepareMainnetClaim } from './claim-review.mjs';
import { publicPaperControl } from './public-paper.mjs';

export function allowedRequest(req, port) {
  return (
    req.socket.remoteAddress === '127.0.0.1' &&
    req.headers.host === '127.0.0.1:' + port &&
    !Object.keys(req.headers).some(
      (k) => k === 'forwarded' || k.startsWith('x-forwarded-') || k.startsWith('cf-'),
    ) &&
    (!req.headers.origin || req.headers.origin === 'http://127.0.0.1:' + port) &&
    (!req.headers['sec-fetch-site'] ||
      ['same-origin', 'none'].includes(req.headers['sec-fetch-site']))
  );
}
async function currentClaimReview(){
  try{return JSON.parse(await readFile(resolve(process.env.ProgramData??ROOT,'PaperfundClaimReview/review.json'),'utf8'));}
  catch{return JSON.parse(await readFile(resolve(ROOT,'artifacts/operator/claim-review-latest.json'),'utf8'));}
}
function same(a, b) {
  return (
    typeof a === 'string' &&
    a.length === b.length &&
    timingSafeEqual(Buffer.from(a), Buffer.from(b))
  );
}
async function body(req) {
  let b = '';
  for await (const chunk of req) {
    b += chunk;
    if (b.length > 4096) throw Error('BODY_LIMIT');
  }
  return JSON.parse(b || '{}');
}
export function operatorServer({
  token = randomBytes(32).toString('hex'),
  port = 3188,
  status = systemStatus,
  discovery = captureDiscovery,
  review = reviewPlan,
  manualClaim = launchManualClaim,
  paper = publicPaperControl(),
} = {}) {
  const cookie = randomBytes(32).toString('hex');
  let cached = null,
    last = 0,
    busy = false;
  const server = createServer(async (req, res) => {
    res.setHeader('cache-control', 'no-store');
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'no-referrer');
    res.setHeader(
      'content-security-policy',
      "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    function reply(code, v) {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(json(v));
    }
    if (!allowedRequest(req, port)) return reply(403, { error: 'LOCAL_DIRECT_REQUEST_REQUIRED' });
    const path = new URL(req.url, 'http://127.0.0.1:' + port).pathname;
    try {
      if (req.method === 'POST' && path === '/session') {
        if (req.headers.origin !== 'http://127.0.0.1:' + port)
          return reply(403, { error: 'ORIGIN_REQUIRED' });
        const b = await body(req);
        if (!same(b.token, token)) return reply(403, { error: 'SESSION_DENIED' });
        res.setHeader(
          'set-cookie',
          'pf_operator=' + cookie + '; HttpOnly; SameSite=Strict; Path=/',
        );
        return reply(200, { ok: true });
      }
      if (req.method === 'GET' && ['/', '/ui.mjs', '/paper-ui.mjs', '/ui.css'].includes(path)) {
        const file = path === '/' ? 'index.html' : path.slice(1);
        res.writeHead(200, {
          'content-type':
            path === '/'
              ? 'text/html; charset=utf-8'
              : path.endsWith('.mjs')
                ? 'text/javascript'
                : 'text/css',
        });
        res.end(await readFile(new URL(file, import.meta.url)));
        return;
      }
      if (
        !same(
          (req.headers.cookie ?? '')
            .split('; ')
            .find((v) => v.startsWith('pf_operator='))
            ?.slice(12),
          cookie,
        )
      )
        return reply(401, { error: 'OPEN_WITH_LOCAL_LAUNCHER' });
      if (req.method === 'GET' && path === '/api/public-paper') return reply(200, await paper.status());
      if(req.method==='GET'&&path==='/api/winner-test')return reply(200,operatorWinnerTestStatus());
      if (req.method === 'GET' && path === '/api/automation')
        return reply(200, await automationStatus());
      if (req.method === 'GET' && path === '/api/reward-overview')
        return reply(200, await rewardOverview());
      if (req.method === 'GET' && path === '/api/claim-review') {
        let latest = null,
          signer = null;
        try {
          latest = await currentClaimReview();
        } catch { /* Public evidence may not exist yet. */ }
        try {
          signer = JSON.parse(
            (
              await readFile(
                resolve(
                  process.env.ProgramData,
                  'PaperfundSignerAcceptance/claim-CheckWallet.public.json',
                ),
                'utf8',
              )
            ).replace(/^\uFEFF/, ''),
          );
        } catch { /* Public evidence may not exist yet. */ }
        return reply(200, {
          latest,
          signer,
          nativeLaunch: await readFile(resolve(process.env.ProgramData??ROOT,'PaperfundSignerAcceptance/native-claim-launch.public.json'),'utf8').then(x=>JSON.parse(x.replace(/^\uFEFF/,''))).catch(()=>null),
          manualResult: await readFile(resolve(process.env.ProgramData??ROOT,'PaperfundSignerAcceptance/claim-Execute.public.json'),'utf8').then(x=>JSON.parse(x.replace(/^\uFEFF/,''))).catch(()=>null),
          manualError: await readFile(resolve(process.env.ProgramData??ROOT,'PaperfundSignerAcceptance/manual-claim-error.public.json'),'utf8').then(x=>JSON.parse(x.replace(/^\uFEFF/,''))).catch(()=>null),
          authorization: 'NONE',
          execution: 'BLOCKED_USE_ISOLATED_EXACT_APPROVAL',
        });
      }
      if(req.method==='GET'&&path==='/api/round-evidence'){try{return reply(200,JSON.parse(await readFile(resolve(ROOT,'artifacts/operator/round-evidence-latest.json'),'utf8')));}catch{return reply(200,{qualification:'REVIEW',missing:['AUTOMATIC_ROUND_EVIDENCE_NOT_STARTED']});}}
      if(req.method==='GET'&&path==='/api/developer-transfer'){
        const get=async file=>readFile(file,'utf8').then(x=>JSON.parse(x.replace(/^\uFEFF/,''))).catch(()=>null);
        return reply(200,{latest:await get(resolve(ROOT,'artifacts/operator/developer-transfer-review.json')),request:await get(resolve(ROOT,'artifacts/operator/native-developer-transfer-request.json')),error:await get(resolve(process.env.ProgramData,'PaperfundSignerAcceptance/manual-developer-transfer-error.public.json')),native:await get(resolve(process.env.ProgramData,'PaperfundSignerAcceptance/native-developer-transfer-launch.public.json')),execution:await get(resolve(process.env.ProgramData,'PaperfundSignerAcceptance/claim-DeveloperTransfer.public.json')),recovery:await get(resolve(process.env.ProgramData,'PaperfundSignerAcceptance/claim-ReconcileDeveloperTransfer.public.json'))});
      }
      if (req.method === 'GET' && path === '/api/status') {
        if (!cached || Date.now() - last > 5000) {
          cached = await status();
          last = Date.now();
        }
        return reply(200, cached);
      }
      if (req.method === 'POST') {
        if (req.headers.origin !== 'http://127.0.0.1:' + port)
          return reply(403, { error: 'ORIGIN_REQUIRED' });
        if (path === '/api/public-paper/challenge') return reply(200, await paper.challenge(await body(req)));
        if (path === '/api/public-paper/verify') return reply(200, await paper.verify(await body(req)));
        if (path === '/api/public-paper/control') return reply(200, await paper.control(await body(req)));
        if (path === '/api/automation/control') {
          const b = await body(req);
          try {
            return reply(202, await automationControl(b.action));
          } catch (e) {
            return reply(423, {
              error: e.message,
              action:
                'Use secure enrollment; no authority was granted and no transaction was sent.',
            });
          }
        }
        if (path === '/api/automation/draft') return reply(200, await exportPolicyDraft());
        if (path === '/api/reward-refresh') {
          if (busy) return reply(409, { error: 'DISCOVERY_IN_PROGRESS' });
          busy = true;
          try {
            await captureRewardAccounting({ replayAll: false });
            return reply(200, await rewardOverview());
          } finally {
            busy = false;
          }
        }
        if (path === '/api/discover') {
          if (busy) return reply(409, { error: 'DISCOVERY_IN_PROGRESS' });
          busy = true;
          try {
            return reply(200, await discovery());
          } finally {
            busy = false;
          }
        }
        if (path === '/api/review') {
          const b = await body(req),
            r = await review(b.planId);
          return reply(200, { ...r, evidence: await saveEvidence('payout-review', r) });
        }
        if(path==='/api/winner-test/prepare'){await body(req);if(busy)return reply(409,{error:'OPERATOR_BUSY'});busy=true;try{const envelope=await prepareOperatorWinnerTest();await writeFile(resolve(process.env.ProgramData??ROOT,'PaperfundClaimReview/winner-test-review.json'),JSON.stringify(envelope));return reply(200,envelope);}finally{busy=false;}}
        if(path==='/api/winner-test/authorize'||path==='/api/winner-test/reconcile'){const request=await body(req),recovery=path.endsWith('/reconcile'),envelope=recovery?null:operatorWinnerTestStatus();return reply(202,await launchWinnerTest(envelope,recovery?{mode:'reconcile'}:request));}
        if(path==='/api/developer-transfer/prepare'){
          if(busy)return reply(409,{error:'DISCOVERY_IN_PROGRESS'});busy=true;
          try{const envelope=await prepareDeveloperTransfer();await writeFile(resolve(ROOT,'artifacts/operator/developer-transfer-review.json'),JSON.stringify(envelope,null,2));await writeFile(resolve(process.env.ProgramData,'PaperfundClaimReview/developer-transfer-review.json'),JSON.stringify(envelope));return reply(200,envelope);}finally{busy=false;}
        }
        if(path==='/api/developer-transfer/authorize'||path==='/api/developer-transfer/reconcile'){
          const request=await body(req),recovery=path.endsWith('/reconcile');const envelope=recovery?null:JSON.parse(await readFile(resolve(ROOT,'artifacts/operator/developer-transfer-review.json'),'utf8'));return reply(202,await launchDeveloperTransfer(envelope,recovery?{mode:'reconcile'}:request));
        }
        if (path === '/api/manual-claim') {
          const b=await body(req);
          const envelope=await currentClaimReview();
          return reply(202,await manualClaim(envelope,b));
        }
        if (path === '/api/claim-plan') {
          if (busy) return reply(409, { error: 'DISCOVERY_IN_PROGRESS' });
          busy = true;
          try {
            return reply(200, await prepareMainnetClaim());
          } finally {
            busy = false;
          }
        }
        if (['/api/approve', '/api/sign', '/api/broadcast', '/api/release'].includes(path))
          return reply(423, { error: 'FINANCIAL_EFFECTS_DISABLED_USE_QUALIFIED_ISOLATED_RUNTIME' });
      }
      return reply(404, { error: 'NOT_FOUND' });
    } catch (e) {
      const detail = publicError(e);
      const evidence = await saveEvidence('operation-error', {
        checkedAt: new Date().toISOString(),
        path,
        ...detail,
      }).catch(() => null);
      return reply(503, { error: detail.code, action: detail.action, evidence });
    }
  });
  return { server, token, cookie };
}
async function main() {
  const port = 3188,
    { server, token } = operatorServer({ port });
  await new Promise((ok, fail) => {
    server.once('error', fail);
    server.listen(port, '127.0.0.1', ok);
  });
  const dir = resolve(ROOT, 'logs/operator'),
    session = resolve(dir, 'session.json');
  await mkdir(dir, { recursive: true });
  if (process.platform === 'win32') {
    const sid = execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        '[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value',
      ],
      { encoding: 'utf8', windowsHide: true },
    ).trim();
    try {
      execFileSync(
        'icacls.exe',
        [dir, '/inheritance:r', '/grant:r', '*' + sid + ':(OI)(CI)F', '*S-1-5-18:(OI)(CI)F'],
        { windowsHide: true, stdio: 'pipe' },
      );
    } catch {
      server.close();
      throw Error('OPERATOR_ACL_FAILED');
    }
  }
  await writeFile(
    session,
    json({
      processId: process.pid,
      startedAt: new Date().toISOString(),
      wallet: WALLET,
      url: 'http://127.0.0.1:' + port + '/#' + token,
    }),
    { mode: 0o600 },
  );
  console.log('Paperfund operator listening on 127.0.0.1:3188. Financial effects disabled.');
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.once(signal, () =>
      server.close(async () => {
        await unlink(session).catch(() => {});
      }),
    );
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch(() => {
    console.error('Operator startup failed: check port 3188 and directory ACL.');
    process.exitCode = 1;
  });
