import { it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fixture } from './legacy-beta-fixture.js';
it('boots the pinned candidate on an isolated database, retains STOP and completes the existing Windows file-drain protocol', async () => {
  const f = await fixture(),
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'paperfund-reward-worker-'));
  let child: ReturnType<typeof spawn> | undefined;
  let exited: Promise<number | null> | undefined;
  let output = '';
  try {
    await f.db.pool.query(
      fs.readFileSync('packages/db/isolated/current-quotes/settlement.sql', 'utf8'),
    );
    await f.db.pool.query(
      fs.readFileSync('packages/db/isolated/current-quotes/durable.sql', 'utf8'),
    );
    await f.db.pool.query(
      fs.readFileSync('packages/db/isolated/current-quotes/platform-accounting.sql', 'utf8'),
    );
    await f.db.pool.query(
      fs.readFileSync('packages/db/isolated/current-quotes/grants.sql', 'utf8'),
    );
    const apiReader=await f.db.pool.connect();try{await apiReader.query('begin');await apiReader.query('set local role paperfund_beta_api');await apiReader.query("select legacy_hour_digest('hour')");}finally{await apiReader.query('rollback');apiReader.release();}
    expect(
      (
        await f.db.pool.query(
          "select has_table_privilege('paperfund_beta_worker','current_quote_settlement_policies','INSERT') allowed",
        )
      ).rows[0].allowed,
    ).toBe(false);
    await f.db.pool.query(
      "insert into current_quote_settlement_policies(id,effective_from,ends_before,selection_version,provider_id) values('worker-policy','2044-01-01T00:00:00Z','2044-01-02T00:00:00Z','DURABLE_QUOTE_V2','CUSTOM_RPC')",
    );
    const dbName = (await f.db.pool.query('select current_database() n')).rows[0].n;
    if (!/^legacy_beta_\d+_[a-f0-9]+$/.test(dbName)) throw Error('DISPOSABLE_DATABASE_REQUIRED');
    const profile = {
      schema: 'PAPERFUND_PUBLIC_CURRENT_QUOTES_V1',
      nonPaying: true,
      archiveDirectory: path.join(dir, 'archive'),
      controlDirectory: path.join(dir, 'control'),
      rewardSettlement: { model: 'DURABLE_QUOTE_V2', policyId: 'worker-policy' },
    };
    fs.mkdirSync(profile.controlDirectory);
    const file = path.join(dir, 'profile.json');
    fs.writeFileSync(file, JSON.stringify(profile));
    const pin = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    const heartbeat = path.join(dir, 'heartbeat.json');
    child = spawn(
      process.execPath,
      ['docs/reward-accounting-20261027/candidate-final-reviewed/worker.mjs', file, pin],
      {
        cwd: process.cwd(),
        windowsHide: true,
        env: {
          ...process.env,
          DATABASE_URL: 'postgresql://beta:disposable-beta-only@127.0.0.1:55462/' + dbName,
          REDIS_URL: 'redis://127.0.0.1:1',
          SOLANA_RPC_URL: 'https://example.invalid',
          PRIVATE_BETA_NON_PAYING: 'true',
          BETA_INVITE_ONLY: 'true',
          PAYOUT_EXECUTION_ENABLED: 'false',
          PAYOUT_SIGNER_TYPE: 'DISABLED',
          CREATOR_FEE_INGESTION_ENABLED: 'false',
          CREATOR_FEE_SHADOW_MODE: 'true',
          WORKER_TICK_INTERVAL_MS: '500',
          WORKER_HEARTBEAT_FILE: heartbeat,
        },
      },
    );
    child.stdout?.on('data', (b) => {
      output = (output + String(b)).slice(-12000);
    });
    child.stderr?.on('data', (b) => {
      output = (output + String(b)).slice(-12000);
    });
    exited = new Promise((resolve) => child!.once('exit', resolve));
    const until = Date.now() + 15000;
    while (!fs.existsSync(heartbeat) && Date.now() < until && child.exitCode === null)
      await new Promise((r) => setTimeout(r, 100));
    expect(fs.existsSync(heartbeat), output).toBe(true);
    expect(JSON.parse(fs.readFileSync(heartbeat, 'utf8')).rewardCapture.model).toBe(
      'DURABLE_QUOTE_V2',
    );
    fs.writeFileSync(
      path.join(profile.controlDirectory, 'worker-drain.request.json'),
      JSON.stringify({ schema: 'PAPERFUND_DRAIN_V1', requestId: 'isolated-release-review' }),
    );
    const drained = path.join(profile.controlDirectory, 'worker-drained.json');
    const deadline = Date.now() + 10000;
    while (!fs.existsSync(drained) && Date.now() < deadline)
      await new Promise((r) => setTimeout(r, 100));
    expect(fs.existsSync(drained), output).toBe(true);
    expect(await exited).toBe(0);
    expect((await f.db.pool.query('select stopped from payout_stop_state')).rows[0].stopped).toBe(
      true,
    );
    expect((await f.db.pool.query('select count(*)::int n from payout_executions')).rows[0].n).toBe(
      0,
    );
  } finally {
    if (child && child.exitCode === null) {
      child.kill();
      if (exited) await exited;
    }
    await f.cleanup();
    const resolved = path.resolve(dir),
      parent = path.resolve(os.tmpdir()) + path.sep;
    if (
      resolved.startsWith(parent) &&
      path.basename(resolved).startsWith('paperfund-reward-worker-')
    )
      fs.rmSync(resolved, { recursive: true });
  }
}, 30000);
