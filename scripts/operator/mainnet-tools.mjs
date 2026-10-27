import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import pg from 'pg';
import { verifyFinancialAcceptance, verifyTreasuryHistory } from './mainnet-evidence.mjs';
import { protectedRpc } from './automation-claim.mjs';
import { sha, amount, COMPROMISED, fail, safeError } from './automation-core.mjs';
import { assertCurrentQuoteSourceScope } from './current-quote-acceptance.mjs';
export async function publishFinancialAcceptance({
  pool,
  envelope,
  certificate,
  revoked = [],
  evidenceDirectory,
  rpc,
  now = Date.now(),
  persist = false,
}) {
  const p = verifyFinancialAcceptance(envelope, certificate, revoked, now);
  const hashes = new Set([
    ...p.utc.evidenceHashes,
    ...p.provider.evidenceHashes,
    p.funding.evidenceHash,
  ]);
  if (!evidenceDirectory || !path.isAbsolute(evidenceDirectory))
    fail('EVIDENCE_DIRECTORY_REQUIRED');
  for (const hash of hashes) {
    const file = path.join(evidenceDirectory, hash + '.json'),
      stat = fs.lstatSync(file);
    if (stat.isSymbolicLink() || !stat.isFile() || sha(fs.readFileSync(file)) !== hash)
      fail('EVIDENCE_FILE_MISMATCH');
    JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  // A real archive and exact received cash must corroborate the accepted custody partition.
  await verifyTreasuryHistory(rpc, p);
  const c = await pool.connect();
  try {
    await c.query(
      persist
        ? 'begin isolation level serializable'
        : 'begin isolation level serializable read only',
    );
    const stop = (await c.query('select stopped from payout_stop_state where singleton=true'))
      .rows[0];
    if (stop?.stopped !== true) fail('ACCEPTANCE_ENROLLMENT_REQUIRES_FINANCIAL_STOP');
    for (const h of p.hours) {
      await assertCurrentQuoteSourceScope(c, p, h);
      const r = (
        await c.query(
          'select r.state,r.starts_at,r.ends_at_exclusive,legacy_hour_digest(r.id) digest,exists(select 1 from legacy_source_reviews v where v.hourly_round_id=r.id) reviewed from hourly_rounds r where id=$1' +
            (persist ? ' for share' : ''),
          [h.roundId],
        )
      ).rows[0];
      if (
        !r ||
        r.state !== 'FINALIZED' ||
        r.digest !== h.structuralHash ||
        r.reviewed ||
        r.starts_at.toISOString() !== h.startsAt ||
        r.ends_at_exclusive.toISOString() !== h.endsAt
      )
        fail('SOURCE_ACCEPTANCE_CHANGED_OR_REVIEW');
      if (persist)
        await c.query(
          'insert into mainnet_source_acceptances(id,hourly_round_id,profile,network,genesis,structural_hash,acceptance_hash,signed_envelope,expires_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict(hourly_round_id,acceptance_hash) do nothing',
          [
            randomUUID(),
            h.roundId,
            p.profile,
            p.network,
            p.genesis,
            h.structuralHash,
            p.acceptanceHash,
            envelope,
            p.expiresAt,
          ],
        );
    }
    if (persist) await c.query('commit');
    else await c.query('rollback');
    return {
      validated: true,
      published: persist,
      hours: p.hours.map((h) => h.roundId),
      acceptanceHash: p.acceptanceHash,
      financialStopPreserved: true,
      transactionAuthority: 'NONE',
    };
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
}
export async function enrollMainnetRuntime({
  target,
  repository,
  treasury,
  limits,
  fundingModel,
  platformWallet,
}) {
  if (treasury === COMPROMISED) fail('FRESH_CUSTODY_REQUIRED');
  const configFile = path.join(target, 'automation-config.json'),
    config = JSON.parse(fs.readFileSync(configFile, 'utf8').replace(/^\uFEFF/, ''));
  if (
    fundingModel !== undefined &&
    (fundingModel !== 'CREATOR_SPLIT_V1' ||
      typeof platformWallet !== 'string' ||
      !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(platformWallet) ||
      platformWallet === treasury ||
      platformWallet === COMPROMISED)
  )
    fail('MAINNET_SPLIT_ENROLLMENT_INVALID');
  if (fundingModel === 'CREATOR_SPLIT_V1' && amount(limits.reserveLamports) <= 0n)
    fail('MAINNET_SPLIT_RESERVE_REQUIRED');
  const custody = JSON.parse(
    fs.readFileSync(path.join(target, 'automation-custody.json'), 'utf8').replace(/^\uFEFF/, ''),
  );
  if (
    custody.wallet !== treasury ||
    custody.compromised !== false ||
    custody.signerSid !== config.signerSid
  )
    fail('FRESH_CUSTODY_REQUIRED');
  for (const k of ['recipient', 'plan', 'outstanding', 'daily', 'pilot', 'maxFeePerTransaction'])
    if (amount(limits[k]) <= 0n) fail('MAINNET_TREASURY_LIMITS_REQUIRED');
  if (
    amount(limits.maxFeePerTransaction) > 5000n ||
    !Number.isInteger(limits.maxEvidenceAgeMs) ||
    limits.maxEvidenceAgeMs < 1 ||
    limits.maxEvidenceAgeMs > 60000
  )
    fail('MAINNET_TREASURY_LIMITS_REQUIRED');
  if (config.mainnetDatabaseUrl) {
    if (
      fundingModel !== undefined &&
      (config.mainnetFundingModel !== fundingModel || config.platformWallet !== platformWallet)
    )
      fail('EXISTING_MAINNET_POLICY_CHANGE_REVIEW_REQUIRED');
    if (config.mainnetTreasury !== treasury) fail('EXISTING_MAINNET_CREDENTIAL_PRESERVED');
    if (config.mainnetEnrollmentState !== 'PENDING')
      return { configured: true, existingCredentialPreserved: true, financialAuthority: 'NONE' };
  }
  const env = fs.readFileSync(path.join(repository, '.env'), 'utf8'),
    line = env.split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL='));
  if (!line) fail('DATABASE_NOT_CONFIGURED');
  const adminUrl = line
      .slice(13)
      .trim()
      .replace(/^(['"])(.*)\1$/, '$2'),
    pool = new pg.Pool({ connectionString: adminUrl, max: 1, connectionTimeoutMillis: 3000 });
  try {
    if (
      !(await pool.query("select to_regclass('public.mainnet_source_acceptances') present")).rows[0]
        .present
    )
      fail('MAINNET_SCHEMA_NOT_DEPLOYED');
    const stop = (await pool.query('select stopped from payout_stop_state where singleton=true'))
      .rows[0];
    if (stop?.stopped !== true) fail('ENROLLMENT_REQUIRES_FINANCIAL_STOP');
    const role = 'paperfund_mainnet_automation_login';
    const roleExists = (await pool.query('select 1 from pg_roles where rolname=$1', [role]))
      .rowCount;
    if (roleExists && !config.mainnetDatabaseUrl) fail('EXISTING_MAINNET_CREDENTIAL_PRESERVED');
    const url = config.mainnetDatabaseUrl ? new URL(config.mainnetDatabaseUrl) : new URL(adminUrl),
      password = config.mainnetDatabaseUrl
        ? decodeURIComponent(url.password)
        : randomBytes(32).toString('hex');
    url.username = role;
    url.password = password;
    if (roleExists) {
      const probe = new pg.Pool({ connectionString: url.toString(), max: 1 });
      try {
        await probe.query('select stopped from payout_stop_state where singleton=true');
      } catch {
        fail('EXISTING_MAINNET_CREDENTIAL_PRESERVED');
      } finally {
        await probe.end();
      }
    }
    // Reuse the existing protected config ACL. No new plaintext credential copy is created.
    const next = {
      ...config,
      repository,
      mainnetDatabaseUrl: url.toString(),
      mainnetTreasury: treasury,
      mainnetTreasuryPolicy: limits,
      ...(fundingModel ? { mainnetFundingModel: fundingModel, platformWallet } : {}),
      mainnetMaxRecipientsPerBatch: 8,
      mainnetEnrollmentState: 'PENDING',
    };
    fs.writeFileSync(configFile, JSON.stringify(next));
    await pool.query('begin');
    if (!roleExists)
      await pool.query(
        "create role paperfund_mainnet_automation_login login nosuperuser nocreatedb nocreaterole inherit password '" +
          password +
          "'",
      );
    await pool.query('grant paperfund_mainnet_signer to paperfund_mainnet_automation_login');
    const db = (await pool.query('select current_database() n')).rows[0].n;
    await pool.query(
      'grant connect on database "' +
        db.replaceAll('"', '""') +
        '" to paperfund_mainnet_automation_login',
    );
    if (
      (
        await pool.query(
          "select has_table_privilege('paperfund_mainnet_automation_login','payout_stop_state','UPDATE') bad",
        )
      ).rows[0].bad
    )
      fail('MAINNET_ROLE_STOP_WRITE_FORBIDDEN');
    if (
      (
        await pool.query(
          "select has_table_privilege('paperfund_mainnet_automation_login','mainnet_source_acceptances','INSERT') bad",
        )
      ).rows[0].bad
    )
      fail('MAINNET_ROLE_ACCEPTANCE_WRITE_FORBIDDEN');
    await pool.query('commit');
    next.mainnetEnrollmentState = 'READY';
    fs.writeFileSync(configFile, JSON.stringify(next));
    return {
      configured: true,
      financialAuthority: 'NONE',
      financialStopPreserved: true,
      channels: 'ALL_OFF',
    };
  } catch (e) {
    await pool.query('rollback').catch(() => {});
    throw e;
  } finally {
    await pool.end();
  }
}

export async function applyMainnetSchema(pool, sql, previousHash) {
  const expectedWhen = '1792337400006',
    hash = sha(sql),
    c = await pool.connect();
  try {
    await c.query('begin');
    await c.query(
      "select pg_advisory_xact_lock(hashtextextended('paperfund-mainnet-schema-v1',0))",
    );
    const stop = (await c.query('select stopped from payout_stop_state where singleton=true'))
      .rows[0];
    if (stop?.stopped !== true) fail('SCHEMA_DEPLOYMENT_REQUIRES_FINANCIAL_STOP');
    const latest = (
      await c.query(
        'select hash,created_at::text from drizzle.__drizzle_migrations order by created_at desc limit 1',
      )
    ).rows[0];
    const exists = (
      await c.query("select to_regclass('public.mainnet_source_acceptances') present")
    ).rows[0].present;
    if (latest?.created_at === expectedWhen && latest.hash === hash && exists) {
      await c.query('rollback');
      return { installed: true, existingSchemaPreserved: true, hash };
    }
    if (exists || latest?.created_at !== '1792337400005' || latest.hash !== previousHash)
      fail('MAINNET_SCHEMA_BASELINE_CHANGED');
    await c.query(sql);
    await c.query('insert into drizzle.__drizzle_migrations(hash,created_at) values($1,$2)', [
      hash,
      expectedWhen,
    ]);
    await c.query('commit');
    return {
      installed: true,
      hash,
      migration: 18,
      financialRecordsChanged: false,
      standingAuthority: 'NONE',
    };
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally {
    c.release();
  }
}

export async function revokeFinancialAcceptance(pool, target, acceptanceHash, reason) {
  if (
    !/^[a-f0-9]{64}$/.test(acceptanceHash) ||
    typeof reason !== 'string' ||
    reason.length < 1 ||
    reason.length > 256
  )
    fail('FINANCIAL_REVOCATION_INVALID');
  const file = path.join(target, 'mainnet-acceptance-revocations.json'),
    ids = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
  if (!ids.includes(acceptanceHash)) {
    ids.push(acceptanceHash);
    fs.writeFileSync(file, JSON.stringify(ids));
  }
  await pool.query(
    'insert into mainnet_acceptance_revocations(acceptance_hash,reason) values($1,$2) on conflict(acceptance_hash) do nothing',
    [acceptanceHash, reason],
  );
  return { revoked: true, acceptanceHash, transactionAuthority: 'NONE', evidencePreserved: true };
}
export async function toolsMain() {
  const target = path.join(process.env.ProgramFiles, 'PaperfundSigner'),
    mode = process.argv[2],
    config = JSON.parse(
      fs.readFileSync(path.join(target, 'automation-config.json'), 'utf8').replace(/^\uFEFF/, ''),
    );
  const raw = fs.readFileSync(0, 'utf8'),
    input = JSON.parse(raw);
  if (mode === 'enroll-runtime')
    return enrollMainnetRuntime({
      target,
      repository: input.repository ?? config.repository,
      treasury: input.treasury,
      limits: input.limits,
      fundingModel: input.fundingModel,
      platformWallet: input.platformWallet,
    });
  if (!['validate', 'publish', 'apply-schema', 'revoke'].includes(mode))
    fail('MAINNET_TOOL_MODE_INVALID');
  const env = fs.readFileSync(path.join(input.repository ?? config.repository, '.env'), 'utf8'),
    line = env.split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL=')),
    url = line
      ?.slice(13)
      .trim()
      .replace(/^(['"])(.*)\1$/, '$2');
  if (!url) fail('DATABASE_NOT_CONFIGURED');
  const pool = new pg.Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 3000 });
  try {
    if (mode === 'revoke')
      return revokeFinancialAcceptance(pool, target, input.acceptanceHash, input.reason);
    if (mode === 'apply-schema')
      return applyMainnetSchema(
        pool,
        fs.readFileSync(path.join(target, 'mainnet-source-acceptance.sql'), 'utf8'),
        input.previousMigrationHash,
      );
    const result = await publishFinancialAcceptance({
      pool,
      envelope: input.envelope,
      certificate: fs.readFileSync(path.join(target, 'standing-policy-root.cer')),
      revoked: fs.existsSync(path.join(target, 'mainnet-acceptance-revocations.json'))
        ? JSON.parse(
            fs.readFileSync(path.join(target, 'mainnet-acceptance-revocations.json'), 'utf8'),
          )
        : [],
      evidenceDirectory: input.evidenceDirectory,
      rpc: protectedRpc(config.rpcEndpoint),
      persist: mode === 'publish',
    });
    if (mode === 'publish') {
      if (!fs.existsSync(path.join(target, 'mainnet-acceptance-revocations.json')))
        fs.writeFileSync(path.join(target, 'mainnet-acceptance-revocations.json'), '[]');
      const dest = path.join(target, 'mainnet-acceptance.json');
      if (fs.existsSync(dest))
        fs.copyFileSync(dest, dest + '.previous-' + Date.now(), fs.constants.COPYFILE_EXCL);
      fs.writeFileSync(dest, JSON.stringify(input.envelope));
    }
    return result;
  } finally {
    await pool.end();
  }
}
if (process.argv[1]?.endsWith('mainnet-tools.bundle.cjs'))
  toolsMain()
    .then((r) => console.log(JSON.stringify(r)))
    .catch((e) => {
      console.error(safeError(e));
      process.exitCode = 1;
    });
