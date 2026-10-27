import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { execFileSync } from 'node:child_process';
import { generateKeyPairSync, createPrivateKey, createPublicKey } from 'node:crypto';
import pg from 'pg';
import {
  AutomationEngine,
  EventStore,
  verifyMandate,
  safeError,
  fail,
} from './automation-core.mjs';
import { AutomatedClaimAdapter, protectedRpc } from './automation-claim.mjs';
import { keyHandle } from './claim-runtime.mjs';
import { ExistingPayoutAutomation } from './automation-payout.mjs';
import { createMainnetPayoutRuntime } from './automation-mainnet.mjs';
let operationPhase = 'PRIVATE_ROOT';
async function main() {
  const installation = path.join(process.env.ProgramFiles, 'PaperfundSigner'),
    root = path.join(process.env.LOCALAPPDATA, 'PaperfundSigner', 'automation'),
    ipc = path.join(process.env.ProgramData, 'PaperfundAutomation');
  fs.mkdirSync(root, { recursive: true });
  operationPhase = 'SINGLETON';
  const singleton = net.createServer((s) => s.destroy());
  await new Promise((ok, no) => {
    singleton.once('error', no);
    singleton.listen(3193, '127.0.0.1', ok);
  });
  const bridge = (mode, input = '') =>
    execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'RemoteSigned',
        '-File',
        path.join(installation, 'automation-dpapi.ps1'),
        '-Mode',
        mode,
      ],
      { input, encoding: 'utf8', windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
    ).trim();
  operationPhase = 'AUDIT_DPAPI';
  let key;
  if (fs.existsSync(path.join(root, 'audit.dpapi'))) {
    key = createPrivateKey({
      key: Buffer.from(bridge('ReadAudit'), 'base64'),
      format: 'der',
      type: 'pkcs8',
    });
  } else {
    key = generateKeyPairSync('ed25519').privateKey;
    const der = key.export({ format: 'der', type: 'pkcs8' });
    try {
      bridge('WriteAudit', der.toString('base64'));
    } finally {
      der.fill(0);
    }
  }
  operationPhase = 'AUDIT_JOURNAL_AND_CONFIG';
  const publicKey = createPublicKey(key),
    store = new EventStore(path.join(root, 'events'), key, publicKey),
    config = JSON.parse(
      fs
        .readFileSync(path.join(installation, 'automation-config.json'), 'utf8')
        .replace(/^\uFEFF/, ''),
    );
  let pool = null;
  if (config.readonlyDatabaseUrl)
    pool = new pg.Pool({
      connectionString: config.readonlyDatabaseUrl,
      max: 1,
      connectionTimeoutMillis: 3000,
      options: '-c default_transaction_read_only=on',
      application_name: 'paperfund-isolated-automation-observer',
    });
  const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  const loadPolicy = (now) => {
    if (!fs.existsSync(path.join(installation, 'standing-policy.json')))
      fail('STANDING_POLICY_REQUIRED');
    const p = verifyMandate(
      readJson(path.join(installation, 'standing-policy.json')),
      fs.readFileSync(path.join(installation, 'standing-policy-root.cer')),
      readJson(path.join(installation, 'policy-revocations.json')),
      now,
    );
    if (!fs.existsSync(path.join(installation, 'automation-custody.json')))
      fail('FRESH_CUSTODY_REQUIRED');
    const custody = readJson(path.join(installation, 'automation-custody.json'));
    if (
      custody.wallet !== p.wallet ||
      custody.signerSid !== config.signerSid ||
      custody.compromised !== false
    )
      fail('FRESH_CUSTODY_REQUIRED');
    return p;
  };
  let payoutRuntime;
  const gate = async () => {
    if (fs.existsSync(path.join(ipc, 'inbox/emergency.stop')))
      return {
        healthy: true,
        stopped: true,
        provider: 'UNQUALIFIED',
        utc: 'UNQUALIFIED',
        mainnetPayoutAccepted: false,
      };
    if (!pool)
      return {
        healthy: false,
        stopped: null,
        provider: 'UNQUALIFIED',
        utc: 'UNQUALIFIED',
        mainnetPayoutAccepted: false,
      };
    try {
      const c = await pool.connect();
      try {
        await c.query('begin read only');
        const role = (
          await c.query(
            'select rolsuper,rolcreaterole,rolcreatedb from pg_roles where rolname=current_user',
          )
        ).rows[0];
        if (role.rolsuper || role.rolcreaterole || role.rolcreatedb)
          fail('DEDICATED_READONLY_DATABASE_ROLE_REQUIRED');
        const stop = (
          await c.query(
            'select stopped,generation::text from payout_stop_state where singleton=true',
          )
        ).rows[0];
        await c.query('rollback');
        const financial = (await payoutRuntime?.status?.()) ?? { accepted: false };
        return {
          healthy: true,
          stopped: stop?.stopped ?? null,
          stopGeneration: stop?.generation,
          provider: financial.provider ?? 'UNQUALIFIED',
          utc: financial.utc ?? 'UNQUALIFIED',
          mainnetPayoutAccepted: financial.accepted === true,
        };
      } finally {
        c.release();
      }
    } catch {
      return {
        healthy: false,
        stopped: null,
        provider: 'UNQUALIFIED',
        utc: 'UNQUALIFIED',
        mainnetPayoutAccepted: false,
      };
    }
  };
  const openKey = async (expected) => {
    const custody = readJson(path.join(installation, 'automation-custody.json'));
    if (custody.wallet !== expected) fail('KEY_IDENTITY_MISMATCH');
    return keyHandle(bridge('ReadWallet'), expected);
  };
  const claim = new AutomatedClaimAdapter({
    rpc: protectedRpc(config.rpcEndpoint),
    root: path.join(root, 'transactions'),
    openKey,
  });
  let engine;
  payoutRuntime = createMainnetPayoutRuntime({
    config,
    installation,
    requestKey: key,
    loadPolicy,
    readRpc: protectedRpc(config.rpcEndpoint),
  });
  const payout = new ExistingPayoutAutomation(payoutRuntime, openKey);
  const adapter = {
    prepare: (channel, source, p) =>
      channel === 'claims' ? claim.prepare(channel, source, p) : payout.prepare(channel, source, p),
    preflight: (r, p) => claim.preflight(r, p),
    sign: (r, p, g) => claim.sign(r, p, g),
    submit: (s, r, p, g) => claim.submit(s, r, p, g),
    recoverSigned: (j) => claim.recoverSigned(j),
    reconcile: (j) => claim.reconcile(j),
    executePayout: (r, p, g) => payout.execute(r, p, g),
    reconcilePayout: (j) => payout.recover(j.prepared),
    queue: async () => (payoutRuntime.acceptedMainnet ? await payoutRuntime.queue() : []),
  };
  engine = new AutomationEngine({ store, loadPolicy, gate, adapter });
  let stopping = false;
  for (const signal of ['SIGTERM', 'SIGINT'])
    process.once(signal, () => {
      stopping = true;
    });
  const publish = async () => {
    let policy = null,
      blockers = [];
    try {
      policy = loadPolicy(Date.now());
      const settings = store.settings();
      if (
        settings.emergencyStop &&
        policy.resumeAutomationStop === true &&
        policy.generation === settings.generation
      ) {
        store.append('SETTINGS', { emergencyStop: false });
        const marker = path.join(ipc, 'inbox/emergency.stop');
        if (fs.existsSync(marker)) fs.unlinkSync(marker);
      }
    } catch (e) {
      blockers.push(safeError(e));
    }
    const g = await gate();
    if (g.stopped !== false) blockers.push('AUTO_FINANCIAL_STOP_ASSERTED_OR_UNAVAILABLE');
    const mainnet = (await payoutRuntime.status?.()) ?? {
      accepted: false,
      reason: payoutRuntime.reason,
    };
    if (!mainnet.accepted) blockers.push(mainnet.reason ?? 'AUTO_MAINNET_ACCEPTANCE_REQUIRED');
    const status = {
      ...engine.status(),
      policy,
      blockers,
      gate: g,
      mainnet,
      supervision: 'WINDOWS_TASK_SCHEDULER_PASSWORD_LOGON_LIMITED',
      auditPublicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    };
    const body = JSON.stringify(status);
    const temp = path.join(ipc, 'public/status.pending-' + process.pid);
    fs.writeFileSync(temp, body);
    fs.renameSync(temp, path.join(ipc, 'public/status.json'));
  };
  operationPhase = 'PUBLIC_STATUS';
  await publish();
  while (!stopping) {
    const files = fs
      .readdirSync(path.join(ipc, 'inbox'))
      .filter((n) => /^[0-9a-f-]{36}\.json$/.test(n))
      .slice(0, 50);
    for (const name of files) {
      const file = path.join(ipc, 'inbox', name);
      try {
        const stat = fs.lstatSync(file);
        if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 4096) fail('REQUEST_INVALID');
        const r = readJson(file);
        if (
          r.schema !== 'paperfund-automation-request-v1' ||
          name !== r.id + '.json' ||
          !Number.isFinite(Date.parse(r.createdAt)) ||
          Date.now() - Date.parse(r.createdAt) > 300000 ||
          Date.parse(r.createdAt) > Date.now() + 5000
        )
          fail('REQUEST_EXPIRED_OR_INVALID');
        if (store.events.some((e) => e.type === 'REQUEST' && e.data.id === r.id)) {
          fs.unlinkSync(file);
          continue;
        }
        try {
          if (r.action === 'claim-now') {
            await engine.run('manual:' + r.id, 'claims', { requestedAt: r.createdAt });
            store.append('REQUEST', { id: r.id, action: r.action, accepted: true });
          } else if (r.action === 'reconcile') {
            await engine.reconcile();
            store.append('REQUEST', { id: r.id, action: r.action, accepted: true });
          } else await engine.control(r.action, r.id);
        } catch (e) {
          store.append('REQUEST', { id: r.id, action: r.action, error: safeError(e) });
        }
        fs.unlinkSync(file);
      } catch (e) {
        store.append('REQUEST_REJECTED', { file: name, error: safeError(e) });
        if (fs.existsSync(file)) fs.renameSync(file, path.join(ipc, 'rejected', name));
      }
    }
    try {
      await engine.tick();
    } catch (e) {
      store.append('TICK_BLOCKED', { error: safeError(e) });
    }
    await publish();
    for (let i = 0; i < 5 && !stopping; i++) await new Promise((r) => setTimeout(r, 1000));
  }
  await payoutRuntime.close();
  await pool?.end();
  await new Promise((r) => singleton.close(r));
}
if (process.argv[1]?.endsWith('automation-service.bundle.cjs'))
  main().catch((e) => {
    const detail = /^E[A-Z]+$/.test(e?.code ?? '') ? e.code : safeError(e);
    console.error('AUTO_SERVICE_' + operationPhase + '_' + detail.replace(/^AUTO_/, ''));
    process.exit(1);
  });
