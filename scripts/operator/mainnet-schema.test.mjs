import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDatabase } from '../../packages/db/src/database.ts';
import { applyMainnetSchema, enrollMainnetRuntime } from './mainnet-tools.mjs';
import { sha } from './automation-core.mjs';
test('reviewed additive schema deployment and protected runtime enrollment are idempotent, retain STOP and grant no source-acceptance or STOP authority', async () => {
  const endpoint = 'postgresql://beta:disposable-beta-only@127.0.0.1:55462/beta',
    url = new URL(endpoint);
  assert.equal(url.port, '55462');
  assert.equal(url.hostname, '127.0.0.1');
  const admin = new pg.Pool({ connectionString: endpoint, max: 1 }),
    name = 'mainnet_schema_' + randomUUID().replaceAll('-', ''),
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'paperfund-mainnet-schema-test-'));
  let db,
    created = false,
    roleCreated = false,
    login;
  try {
    assert.equal((await admin.query('select current_database() n')).rows[0].n, 'beta');
    assert.equal(
      (
        await admin.query(
          "select 1 from pg_roles where rolname='paperfund_mainnet_automation_login'",
        )
      ).rowCount,
      0,
      'Unknown disposable login preserved',
    );
    await admin.query('create database "' + name + '"');
    created = true;
    url.pathname = '/' + name;
    db = createDatabase(url.toString());
    const migration = path.join(root, 'migrations');
    fs.mkdirSync(path.join(migration, 'meta'), { recursive: true });
    const journal = JSON.parse(fs.readFileSync('packages/db/migrations/meta/_journal.json'));
    journal.entries = journal.entries.filter((e) => e.idx < 18);
    fs.writeFileSync(path.join(migration, 'meta/_journal.json'), JSON.stringify(journal));
    for (const e of journal.entries)
      fs.copyFileSync(
        'packages/db/migrations/' + e.tag + '.sql',
        path.join(migration, e.tag + '.sql'),
      );
    await migrate(db.client, { migrationsFolder: migration });
    const before = (await db.pool.query('select stopped,generation::text from payout_stop_state'))
      .rows[0];
    const sql = fs.readFileSync(
        'packages/db/migrations/0018_mainnet_source_acceptance.sql',
        'utf8',
      ),
      old = sha(fs.readFileSync('packages/db/migrations/0017_beta_runtime_roles.sql'));
    assert.equal((await applyMainnetSchema(db.pool, sql, old)).installed, true);
    assert.equal((await applyMainnetSchema(db.pool, sql, old)).existingSchemaPreserved, true);
    assert.deepEqual(
      (await db.pool.query('select stopped,generation::text from payout_stop_state')).rows[0],
      before,
    );
    assert.equal(
      (await db.pool.query('select count(*)::int n from mainnet_source_acceptances')).rows[0].n,
      0,
    );
    const target = path.join(root, 'protected'),
      repository = path.join(root, 'repository');
    fs.mkdirSync(target);
    fs.mkdirSync(repository);
    fs.writeFileSync(path.join(repository, '.env'), 'DATABASE_URL=' + url.toString() + '\n');
    const wallet = '11111111111111111111111111111112',
      sid = 'DISPOSABLE_SID',
      configFile = path.join(target, 'automation-config.json');
    fs.writeFileSync(
      configFile,
      JSON.stringify({ signerSid: sid, readonlyDatabaseUrl: 'DISPOSABLE_RETAINED_VALUE' }),
    );
    fs.writeFileSync(
      path.join(target, 'automation-custody.json'),
      JSON.stringify({ wallet, compromised: false, signerSid: sid }),
    );
    const args = {
      target,
      repository,
      treasury: wallet,
      limits: {
        recipient: '10000',
        plan: '10000',
        outstanding: '20000',
        daily: '20000',
        pilot: '30000',
        maxFeePerTransaction: '10',
        maxEvidenceAgeMs: 60000,
      },
    };
    await enrollMainnetRuntime(args);
    roleCreated = true;
    const first = JSON.parse(fs.readFileSync(configFile));
    assert.equal(first.readonlyDatabaseUrl, 'DISPOSABLE_RETAINED_VALUE');
    assert.equal(first.mainnetEnrollmentState, 'READY');
    login = new pg.Pool({ connectionString: first.mainnetDatabaseUrl, max: 1 });
    assert.deepEqual(
      (await login.query('select stopped,generation::text from payout_stop_state')).rows[0],
      before,
    );
    await assert.rejects(
      login.query('update payout_stop_state set stopped=false'),
      (e) => e.code === '42501',
    );
    await assert.rejects(
      login.query("insert into mainnet_acceptance_revocations values('forbidden','test',default)"),
      (e) => e.code === '42501',
    );
    await assert.rejects(
      login.query('update users set wallet_address=wallet_address'),
      (e) => e.code === '42501',
    );
    await enrollMainnetRuntime(args);
    assert.equal(
      JSON.parse(fs.readFileSync(configFile)).mainnetDatabaseUrl,
      first.mainnetDatabaseUrl,
    );
    first.mainnetEnrollmentState = 'PENDING';
    fs.writeFileSync(configFile, JSON.stringify(first));
    await enrollMainnetRuntime(args);
    assert.equal(JSON.parse(fs.readFileSync(configFile)).mainnetEnrollmentState, 'READY');
    assert.equal(
      JSON.parse(fs.readFileSync(configFile)).mainnetDatabaseUrl,
      first.mainnetDatabaseUrl,
    );
    fs.writeFileSync(
      'artifacts/operator/mainnet-schema-enrollment-tests.json',
      JSON.stringify(
        {
          at: new Date().toISOString(),
          passed: true,
          isolatedDatabaseOnly: true,
          realFinancialRecordsChanged: false,
          stopUnchanged: true,
          credentialPreserved: true,
          recoveredPendingEnrollment: true,
          signerCannotWriteStop: true,
          signerCannotAcceptSource: true,
          signerCannotChangeUsers: true,
        },
        null,
        2,
      ),
    );
  } finally {
    if (login) await login.end();
    if (db) await db.close();
    if (created) await admin.query('drop database "' + name + '" with(force)');
    if (roleCreated) await admin.query('drop role paperfund_mainnet_automation_login');
    await admin.end();
    if (fs.realpathSync(root).startsWith(fs.realpathSync(os.tmpdir()) + path.sep))
      fs.rmSync(root, { recursive: true, force: true });
  }
});
