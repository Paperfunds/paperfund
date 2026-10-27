import {createRequire} from 'node:module';
const {configureReadOnlyDatabase}=createRequire(import.meta.url)('./automation-configure.bundle.cjs');
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import pg from 'pg';
test('disabled installer database role is SELECT-only and idempotent; an unknown existing login is never reset', async () => {
  const endpoint = 'postgresql://beta:disposable-beta-only@127.0.0.1:55462/beta';
  const url = new URL(endpoint);
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.port, '55462');
  assert.equal(url.pathname, '/beta');
  const admin = new pg.Pool({ connectionString: endpoint, max: 1 }),
    database = 'auto_role_' + process.pid + '_' + randomUUID().replaceAll('-', ''),
    role = 'paperfund_automation_readonly',
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'paperfund-automation-role-test-'));
  let created = false,
    roleCreated = false,
    db,
    readonly;
  try {
    assert.equal((await admin.query('select current_database() n')).rows[0].n, 'beta');
    assert.equal(
      (await admin.query('select 1 from pg_roles where rolname=$1', [role])).rowCount,
      0,
      'Existing disposable role retained; do not run competing tests.',
    );
    await admin.query('create database "' + database + '"');
    created = true;
    const dbUrl = new URL(endpoint);
    dbUrl.pathname = '/' + database;
    db = new pg.Pool({ connectionString: dbUrl.toString(), max: 1 });
    await db.query(
      'create table payout_stop_state(singleton boolean,stopped boolean,generation bigint);create table payout_plans(id text);insert into payout_stop_state values(true,true,0)',
    );
    const installation = path.join(root, 'PaperfundSigner');
    fs.mkdirSync(installation);
    const config = path.join(installation, 'automation-config.json'),
      initial = {
        readonlyDatabaseUrl: null,
        rpcEndpoint: 'https://example.invalid',
        signerSid: 'DISPOSABLE_TEST_SID',
      };
    fs.writeFileSync(config, JSON.stringify(initial));
    fs.writeFileSync(path.join(root, '.env'), 'DATABASE_URL=' + dbUrl.toString());
    const configure = () => configureReadOnlyDatabase({ target: installation, repository: root });
    await configure();
    roleCreated = true;
    const ready = JSON.parse(fs.readFileSync(config, 'utf8'));
    readonly = new pg.Pool({ connectionString: ready.readonlyDatabaseUrl, max: 1 });
    assert.equal(
      (await readonly.query('select stopped from payout_stop_state')).rows[0].stopped,
      true,
    );
    await assert.rejects(
      readonly.query('update payout_stop_state set stopped=false'),
      (e) => e.code === '42501',
    );
    await assert.rejects(
      readonly.query('insert into payout_plans values($1)', ['NO_WRITE']),
      (e) => e.code === '42501',
    );
    const flags = (
      await admin.query(
        'select rolsuper,rolcreaterole,rolcreatedb from pg_roles where rolname=$1',
        [role],
      )
    ).rows[0];
    assert.deepEqual(flags, { rolsuper: false, rolcreaterole: false, rolcreatedb: false });
    await configure();
    const before = fs.readFileSync(config, 'utf8');
    fs.writeFileSync(config, JSON.stringify(initial));
    await assert.rejects(configure(), /EXISTING_ROLE_PRESERVED/);
    assert.equal(
      (await readonly.query('select stopped from payout_stop_state')).rows[0].stopped,
      true,
    );
    fs.writeFileSync(config, before);
    fs.writeFileSync(
      'artifacts/operator/automation-role-test.json',
      JSON.stringify(
        {
          passed: true,
          scope: 'DISPOSABLE_POSTGRES_127_0_0_1_55462_ONLY',
          selectOnly: true,
          stopWriteDenied: true,
          planWriteDenied: true,
          unknownLoginPasswordPreserved: true,
          idempotentConfiguration: true,
          productionRoleCreated: false,
          at: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
  } finally {
    await readonly?.end();
    await db?.end();
    if (created) await admin.query('drop database "' + database + '" with (force)');
    if (roleCreated) await admin.query('drop role ' + role);
    await admin.end();
    const resolved = path.resolve(root);
    assert(
      resolved.startsWith(path.resolve(os.tmpdir()) + path.sep + 'paperfund-automation-role-test-'),
    );
    fs.rmSync(resolved, { recursive: true });
  }
});
