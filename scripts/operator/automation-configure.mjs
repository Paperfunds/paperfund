import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
let setupPhase = 'CONFIG_READ';
export async function configureReadOnlyDatabase({ target, repository }) {
  const file = path.join(target, 'automation-config.json'),
    config = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (config.readonlyDatabaseUrl) {
    console.log('Dedicated observer configuration retained.');
    return;
  }
  if (!repository || !path.isAbsolute(repository)) throw Error('PATH');
  setupPhase = 'SOURCE_CONFIGURATION';
  const env = fs.readFileSync(path.join(repository, '.env'), 'utf8');
  const line = env.split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL='));
  if (!line) throw Error('CONFIG');
  const url = line
      .slice('DATABASE_URL='.length)
      .trim()
      .replace(/^(['"])(.*)\1$/, '$2'),
    pool = new pg.Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 3000 });
  try {
    setupPhase = 'DATABASE_CONNECTION';
    const role = 'paperfund_automation_readonly';
    if ((await pool.query('select 1 from pg_roles where rolname=$1', [role])).rowCount)
      throw Error('EXISTING_ROLE_PRESERVED');
    const password = randomBytes(32).toString('hex'),
      db = (await pool.query('select current_database() n')).rows[0].n;
    setupPhase = 'ROLE_CREATION';
    await pool.query('begin');
    await pool.query(
      "create role paperfund_automation_readonly login nosuperuser nocreatedb nocreaterole noinherit password '" +
        password +
        "'",
    );
    await pool.query(
      'grant connect on database "' +
        db.replaceAll('"', '""') +
        '" to paperfund_automation_readonly',
    );
    await pool.query('grant usage on schema public to paperfund_automation_readonly');
    await pool.query(
      'grant select on payout_stop_state,payout_plans to paperfund_automation_readonly',
    );
    const endpoint = new URL(url);
    endpoint.username = role;
    endpoint.password = password;
    config.readonlyDatabaseUrl = endpoint.toString();
    setupPhase = 'WRITE_PRIVILEGE_CHECK';
    const access = await pool.query(
      "select exists(select 1 from pg_tables where schemaname='public' and has_table_privilege('paperfund_automation_readonly',quote_ident(schemaname)||'.'||quote_ident(tablename),'INSERT,UPDATE,DELETE,TRUNCATE')) writable",
    );
    if (access.rows[0].writable) throw Error('PUBLIC_WRITE_GRANTS_REQUIRE_REVIEW');
    await pool.query('commit');
    fs.writeFileSync(file, JSON.stringify(config));
    console.log('Dedicated SELECT-only role provisioned; no financial records changed.');
  } finally {
    await pool.end();
  }
}
if (process.argv[1]?.endsWith('automation-configure.bundle.cjs'))
  configureReadOnlyDatabase({
    target: path.join(process.env.ProgramFiles, 'PaperfundSigner'),
    repository: process.argv[2],
  }).catch((e) => {
    const code = /^[A-Z0-9_]{1,60}$/.test(e.code ?? e.message ?? '')
      ? (e.code ?? e.message)
      : 'UNAVAILABLE';
    console.error('AUTO_READONLY_ROLE_SETUP_BLOCKED_' + setupPhase + ':' + code);
    process.exitCode = 1;
  });
