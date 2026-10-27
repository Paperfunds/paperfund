import fs from 'node:fs';
import path from 'node:path';
import {
  createHash,
  randomUUID,
  sign,
  verify,
  X509Certificate,
  createPublicKey,
} from 'node:crypto';
export const COMPROMISED = 'GHMGUyYpdaC4TfUTwHEWBeZHPYq6csJDP1iVuYCjyQyW';
export const MAINNET = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
export const sha = (b) => createHash('sha256').update(b).digest('hex');
export const copy = (o) => JSON.parse(JSON.stringify(o));
export const iso = (n) => new Date(n).toISOString();
export function fail(code) {
  throw Error('AUTO_' + code);
}
export function safeError(e) {
  return /^(AUTO|CLAIM|PAYOUT|RPC)_[A-Z0-9_]+$/.test(e?.code ?? e?.message ?? '')
    ? (e.code ?? e.message)
    : 'AUTO_OPERATION_FAILED_REVIEW_PRIVATE_EVIDENCE';
}
export function amount(s) {
  if (typeof s !== 'string' || !/^(0|[1-9][0-9]*)$/.test(s)) fail('INVALID_LAMPORTS');
  return BigInt(s);
}
export function dueClaim(now) {
  const d = new Date(now);
  d.setUTCMinutes(59, 0, 0);
  if (+d > now) d.setUTCHours(d.getUTCHours() - 1);
  return +d;
}
export const nextClaim = (now) => dueClaim(now) + 3600000;
export function verifyMandate(envelope, certificate, revoked = [], now = Date.now()) {
  if (
    !envelope ||
    typeof envelope.payloadBase64 !== 'string' ||
    typeof envelope.signatureBase64 !== 'string'
  )
    fail('STANDING_POLICY_REQUIRED');
  const payload = Buffer.from(envelope.payloadBase64, 'base64');
  let key;
  try {
    key = new X509Certificate(certificate).publicKey;
  } catch {
    key = createPublicKey(certificate);
  }
  if (!verify('sha256', payload, key, Buffer.from(envelope.signatureBase64, 'base64')))
    fail('POLICY_SIGNATURE_INVALID');
  let p;
  try {
    p = JSON.parse(payload);
  } catch {
    fail('POLICY_INVALID');
  }
  validatePolicy(p, now);
  if (revoked.includes(p.id)) fail('POLICY_REVOKED');
  return Object.freeze(copy(p));
}
export function validatePolicy(p, now = Date.now()) {
  if (
    p?.schema !== 'paperfund-standing-automation-v1' ||
    p.network !== 'mainnet-beta' ||
    p.genesis !== MAINNET ||
    !/^[-a-zA-Z0-9]{16,128}$/.test(p.id) ||
    !p.operator ||
    !Number.isSafeInteger(p.generation) ||
    p.generation < 0 ||
    typeof p.financialStopGeneration !== 'string' ||
    !/^\d+$/.test(p.financialStopGeneration)
  )
    fail('POLICY_SCOPE_INVALID');
  if (
    !Number.isFinite(Date.parse(p.issuedAt)) ||
    Date.parse(p.issuedAt) > now ||
    !Number.isFinite(Date.parse(p.expiresAt)) ||
    Date.parse(p.expiresAt) <= now ||
    Date.parse(p.expiresAt) - Date.parse(p.issuedAt) > 7 * 86400000
  )
    fail('POLICY_EXPIRED_OR_INVALID_LIFETIME');
  if (
    p.wallet === COMPROMISED ||
    p.custody?.rotationConfirmed !== true ||
    p.custody?.wallet !== p.wallet ||
    p.custody?.mode !== 'DPAPI_CURRENT_USER_ISOLATED'
  )
    fail('FRESH_CUSTODY_REQUIRED');
  if (
    typeof p.wallet !== 'string' ||
    typeof p.mint !== 'string' ||
    p.claims?.instruction !== 'collect_creator_fee_v2' ||
    p.payouts?.recipients !== 'IMMUTABLE_QUALIFIED_EXISTING_PLANS'
  )
    fail('POLICY_SCOPE_INVALID');
  for (const c of ['claims', 'hourly', 'daily'])
    if (typeof (c === 'claims' ? p.claims : p.payouts[c])?.enabled !== 'boolean')
      fail('POLICY_SCOPE_INVALID');
  for (const v of [
    p.claims.minGrossLamports,
    p.claims.maxGrossLamports,
    p.claims.maxHourlyGrossLamports,
    p.claims.maxDailyGrossLamports,
    p.claims.maxFeeLamports,
    p.claims.maxDailyFeeLamports,
    p.payouts.maxRecipientLamports,
    p.payouts.maxDailyLamports,
    p.payouts.maxOutstandingLamports,
    p.payouts.maxFeeLamports,
    p.payouts.maxDailyFeeLamports,
    p.payouts.hourly.maxRoundLamports,
    p.payouts.daily.maxRoundLamports,
  ])
    amount(v);
  if (
    amount(p.claims.minGrossLamports) <= amount(p.claims.maxFeeLamports) ||
    amount(p.claims.maxGrossLamports) < amount(p.claims.minGrossLamports) ||
    amount(p.claims.maxFeeLamports) > 5000n ||
    amount(p.payouts.maxFeeLamports) > 5000n
  )
    fail('POLICY_LIMITS_INVALID');
  for (const v of [
    p.claims.maxTransactionsPerHour,
    p.claims.maxTransactionsPerDay,
    p.payouts.maxTransactionsPerDay,
  ])
    if (!Number.isSafeInteger(v) || v < 1 || v > 1000) fail('POLICY_LIMITS_INVALID');
  return p;
}
export class EventStore {
  constructor(root, key, publicKey) {
    this.root = root;
    this.key = key;
    this.publicKey = publicKey;
    fs.mkdirSync(root, { recursive: true });
    this.events = [];
    this.reload();
  }
  reload() {
    let previous = '0'.repeat(64);
    this.events = [];
    for (const name of fs
      .readdirSync(this.root)
      .filter((n) => /^\d{12}\.event\.json$/.test(n))
      .sort()) {
      const e = JSON.parse(fs.readFileSync(path.join(this.root, name), 'utf8'));
      const { signature, hash, ...body } = e;
      const bytes = JSON.stringify(body);
      if (
        body.sequence !== this.events.length + 1 ||
        name !== String(body.sequence).padStart(12, '0') + '.event.json' ||
        body.previous !== previous ||
        sha(bytes) !== hash ||
        !verify(null, Buffer.from(bytes), this.publicKey, Buffer.from(signature, 'base64'))
      )
        fail('AUDIT_TAMPERED');
      this.events.push(e);
      previous = hash;
    }
    const anchor = path.join(this.root, 'anchor.json');
    if (fs.existsSync(anchor)) {
      const a = JSON.parse(fs.readFileSync(anchor, 'utf8'));
      const payload = JSON.stringify([a.sequence, a.hash]);
      if (
        !verify(null, Buffer.from(payload), this.publicKey, Buffer.from(a.signature, 'base64')) ||
        this.events.length < a.sequence ||
        this.events[a.sequence - 1]?.hash !== a.hash
      )
        fail('AUDIT_TAMPERED');
    } else if (this.events.length) fail('AUDIT_ANCHOR_MISSING');
  }
  append(type, data, now = Date.now()) {
    const body = {
        sequence: this.events.length + 1,
        previous: this.events.at(-1)?.hash ?? '0'.repeat(64),
        at: iso(now),
        type,
        data: copy(data),
      },
      bytes = JSON.stringify(body),
      e = {
        ...body,
        hash: sha(bytes),
        signature: sign(null, Buffer.from(bytes), this.key).toString('base64'),
      };
    const file = path.join(this.root, String(body.sequence).padStart(12, '0') + '.event.json');
    const fd = fs.openSync(file, 'wx');
    try {
      fs.writeSync(fd, JSON.stringify(e));
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    this.events.push(e);
    const payload = JSON.stringify([e.sequence, e.hash]),
      anchor = {
        sequence: e.sequence,
        hash: e.hash,
        signature: sign(null, Buffer.from(payload), this.key).toString('base64'),
      };
    const af = path.join(this.root, 'anchor.pending');
    const afd = fs.openSync(af, 'w');
    try {
      fs.writeSync(afd, JSON.stringify(anchor));
      fs.fsyncSync(afd);
    } finally {
      fs.closeSync(afd);
    }
    fs.renameSync(af, path.join(this.root, 'anchor.json'));
    return e;
  }
  jobs() {
    const map = new Map();
    for (const e of this.events)
      if (e.type === 'JOB') map.set(e.data.id, { ...map.get(e.data.id), ...e.data, at: e.at });
    return [...map.values()];
  }
  settings() {
    let s = { claims: false, hourly: false, daily: false, generation: 0, emergencyStop: false };
    for (const e of this.events) if (e.type === 'SETTINGS') s = { ...s, ...e.data };
    return s;
  }
  unresolved() {
    return this.jobs().filter((j) =>
      [
        'RESERVED',
        'SIGNED',
        'SUBMISSION_UNCERTAIN',
        'SUBMITTED',
        'REVIEW',
        'FAILED_FINALIZED',
        'PAYOUT_EXECUTION_PENDING',
      ].includes(j.state),
    );
  }
  budget(kind, now) {
    const day = iso(now).slice(0, 10),
      hour = iso(now).slice(0, 13),
      jobs = this.jobs().filter((j) => j.kind === kind && j.reserved === true);
    const today = jobs.filter((j) => j.budgetDay === day),
      thisHour = today.filter((j) => j.budgetHour === hour);
    return {
      daily: today.reduce((n, j) => n + amount(j.principalLamports), 0n),
      hourly: thisHour.reduce((n, j) => n + amount(j.principalLamports), 0n),
      dailyFees: today.reduce((n, j) => n + amount(j.maximumFeeLamports), 0n),
      dayTransactions: today.reduce((n, j) => n + (j.transactionCount ?? 1), 0),
      hourTransactions: thisHour.reduce((n, j) => n + (j.transactionCount ?? 1), 0),
      outstanding: jobs
        .filter((j) => j.state !== 'FINALIZED_VERIFIED')
        .reduce((n, j) => n + amount(j.principalLamports), 0n),
    };
  }
}
export class AutomationEngine {
  constructor({ store, loadPolicy, gate, adapter, clock = Date.now }) {
    Object.assign(this, { store, loadPolicy, gate, adapter, clock });
    this.busy = false;
  }
  async guard(channel) {
    const now = this.clock(),
      p = await this.loadPolicy(now),
      s = this.store.settings();
    if (s.emergencyStop || p.generation !== s.generation)
      fail('EMERGENCY_STOP_OR_GENERATION_CHANGED');
    const g = await this.gate();
    if (g.stopped !== false) fail('FINANCIAL_STOP_ASSERTED_OR_UNAVAILABLE');
    if (!g.healthy) fail('FINANCIAL_EVIDENCE_UNAVAILABLE');
    if (g.stopGeneration !== p.financialStopGeneration) fail('FINANCIAL_STOP_GENERATION_CHANGED');
    if (
      channel !== 'claims' &&
      (g.provider !== 'QUALIFIED' || g.utc !== 'QUALIFIED' || g.mainnetPayoutAccepted !== true)
    )
      fail('PAYOUT_FINANCIAL_QUALIFICATION_BLOCKED');
    if (!(channel === 'claims' ? p.claims.enabled : p.payouts[channel].enabled))
      fail('CHANNEL_NOT_AUTHORIZED');
    return p;
  }
  async control(action, requestId = randomUUID()) {
    if (this.store.events.some((e) => e.type === 'REQUEST' && e.data.id === requestId))
      return { duplicate: true };
    if (action === 'STOP') {
      const s = this.store.settings();
      this.store.append(
        'SETTINGS',
        {
          claims: false,
          hourly: false,
          daily: false,
          emergencyStop: true,
          generation: s.generation + 1,
        },
        this.clock(),
      );
      this.store.append('REQUEST', { id: requestId, action });
      return { stopped: true };
    }
    const m = /^(claims|hourly|daily):(on|off)$/.exec(action);
    if (!m) fail('CONTROL_INVALID');
    const [, channel, value] = m;
    if (value === 'on') await this.guard(channel);
    this.store.append('SETTINGS', { [channel]: value === 'on' }, this.clock());
    this.store.append('REQUEST', { id: requestId, action });
    return { settings: this.store.settings() };
  }
  checkBudget(p, kind, channel, principal, fee, recipients = [], transactionCount = 1) {
    if (!Number.isSafeInteger(transactionCount) || transactionCount < 1 || transactionCount > 32)
      fail('TRANSACTION_COUNT_INVALID');
    const b = this.store.budget(kind, this.clock()),
      n = amount(principal),
      f = amount(fee);
    if (kind === 'claim') {
      const c = p.claims;
      if (
        n < amount(c.minGrossLamports) ||
        n > amount(c.maxGrossLamports) ||
        b.hourly + n > amount(c.maxHourlyGrossLamports) ||
        b.daily + n > amount(c.maxDailyGrossLamports) ||
        f > amount(c.maxFeeLamports) ||
        b.dailyFees + f > amount(c.maxDailyFeeLamports) ||
        b.hourTransactions >= c.maxTransactionsPerHour ||
        b.dayTransactions >= c.maxTransactionsPerDay
      )
        fail('CLAIM_POLICY_LIMIT');
    } else {
      const c = p.payouts;
      if (
        n > amount(c[channel].maxRoundLamports) ||
        b.daily + n > amount(c.maxDailyLamports) ||
        b.outstanding + n > amount(c.maxOutstandingLamports) ||
        f > amount(c.maxFeeLamports) * BigInt(transactionCount) ||
        b.dailyFees + f > amount(c.maxDailyFeeLamports) ||
        b.dayTransactions + transactionCount > c.maxTransactionsPerDay ||
        recipients.some((r) => amount(r.lamports) > amount(c.maxRecipientLamports))
      )
        fail('PAYOUT_POLICY_LIMIT');
    }
  }
  async run(id, channel, source) {
    if (this.busy) fail('BUSY');
    this.busy = true;
    try {
      const old = this.store.jobs().find((j) => j.id === id);
      if (old) return { duplicate: true, job: old };
      if (this.store.unresolved().length) fail('UNRESOLVED_EXECUTION_RECONCILE_FIRST');
      const p = await this.guard(channel),
        kind = channel === 'claims' ? 'claim' : 'payout';
      const prepared = await this.adapter.prepare(channel, source, p);
      const sealed = copy(prepared);
      this.checkBudget(
        p,
        kind,
        channel,
        sealed.principalLamports,
        sealed.maximumFeeLamports,
        sealed.recipients,
        sealed.transactionCount ?? 1,
      );
      const current = await this.guard(channel);
      if (sha(JSON.stringify(p)) !== sha(JSON.stringify(current))) fail('POLICY_CHANGED');
      const job = {
        id,
        kind,
        channel,
        source,
        policyId: p.id,
        policyHash: sha(JSON.stringify(p)),
        state: 'RESERVED',
        reserved: true,
        transactionCount: sealed.transactionCount ?? 1,
        principalLamports: sealed.principalLamports,
        maximumFeeLamports: sealed.maximumFeeLamports,
        budgetDay: iso(this.clock()).slice(0, 10),
        budgetHour: iso(this.clock()).slice(0, 13),
        prepared: sealed,
      };
      this.store.append('JOB', job, this.clock());
      if (kind === 'payout') {
        this.store.append('JOB', { id, state: 'PAYOUT_EXECUTION_PENDING' }, this.clock());
        await this.adapter.executePayout(sealed, p, () => this.guard(channel));
        return { pending: true, id };
      }
      await this.adapter.preflight(sealed, p);
      const check = await this.guard(channel);
      if (sha(JSON.stringify(p)) !== sha(JSON.stringify(check))) fail('POLICY_CHANGED');
      const signed = await this.adapter.sign(sealed, p, () => this.guard(channel));
      if (!signed.signature) fail('SIGNATURE_MISSING');
      this.store.append(
        'JOB',
        { id, state: 'SIGNED', signature: signed.signature, signedArtifact: signed.artifact },
        this.clock(),
      );
      const beforeSubmit = await this.guard(channel);
      if (sha(JSON.stringify(p)) !== sha(JSON.stringify(beforeSubmit))) fail('POLICY_CHANGED');
      this.store.append('JOB', { id, state: 'SUBMISSION_UNCERTAIN' }, this.clock());
      const acknowledgement = await this.adapter.submit(signed, sealed, p, () =>
        this.guard(channel),
      );
      if (acknowledgement !== signed.signature) fail('SUBMISSION_ACK_MISMATCH');
      this.store.append('JOB', { id, state: 'SUBMITTED' }, this.clock());
      return { submitted: true, signature: signed.signature };
    } catch (e) {
      const j = this.store.jobs().find((j) => j.id === id);
      if (j && j.state !== 'FINALIZED_VERIFIED')
        this.store.append('JOB', { id, error: safeError(e) }, this.clock());
      throw e;
    } finally {
      this.busy = false;
    }
  }
  async reconcile() {
    if (this.busy) return;
    this.busy = true;
    try {
      for (let job of this.store.unresolved()) {
        if (job.kind === 'payout') {
          try {
            const result = await this.adapter.reconcilePayout(job);
            if (result.finalized)
              this.store.append(
                'JOB',
                {
                  id: job.id,
                  state: result.success ? 'FINALIZED_VERIFIED' : 'FAILED_FINALIZED',
                  receipt: result,
                },
                this.clock(),
              );
            else if (result.neverSubmitted)
              this.store.append(
                'JOB',
                { id: job.id, state: 'ABORTED_NOT_SUBMITTED' },
                this.clock(),
              );
          } catch (e) {
            this.store.append('JOB', { id: job.id, error: safeError(e) }, this.clock());
          }
          continue;
        }
        if (!job.signature) {
          const recovered = await this.adapter.recoverSigned?.(job);
          if (recovered?.signature) {
            this.store.append(
              'JOB',
              {
                id: job.id,
                state: 'SIGNED',
                signature: recovered.signature,
                signedArtifact: recovered.artifact,
              },
              this.clock(),
            );
            job = { ...job, signature: recovered.signature };
          } else {
            this.store.append(
              'JOB',
              {
                id: job.id,
                state: recovered?.neverSubmitted ? 'ABORTED_NOT_SUBMITTED' : 'REVIEW',
                error: recovered?.neverSubmitted
                  ? 'AUTO_NO_SUBMISSION_PRESERVED'
                  : 'AUTO_NO_DURABLE_SIGNATURE_PRESERVE_RESERVATION',
              },
              this.clock(),
            );
            continue;
          }
        }
        try {
          const result = await this.adapter.reconcile(copy(job));
          if (result?.finalized === true) {
            this.store.append(
              'JOB',
              {
                id: job.id,
                state: result.success ? 'FINALIZED_VERIFIED' : 'FAILED_FINALIZED',
                receipt: result,
              },
              this.clock(),
            );
          } else if (result?.expiredAbsent === true)
            this.store.append(
              'JOB',
              {
                id: job.id,
                state: 'REVIEW',
                error: 'AUTO_EXPIRED_ABSENCE_REQUIRES_INDEPENDENT_RESOLUTION',
              },
              this.clock(),
            );
        } catch (e) {
          this.store.append('JOB', { id: job.id, error: safeError(e) }, this.clock());
        }
      }
    } finally {
      this.busy = false;
    }
  }
  async tick() {
    await this.reconcile();
    const now = this.clock(),
      s = this.store.settings(),
      due = dueClaim(now),
      key = 'claim:' + iso(due);
    const lastSchedule = this.store.events
      .filter((e) => e.type === 'SCHEDULE' && e.data.id === key)
      .at(-1);
    if (
      !lastSchedule ||
      (!['DISABLED', 'ATTEMPTED'].includes(lastSchedule.data.outcome) &&
        now - Date.parse(lastSchedule.at) >= 60000)
    ) {
      // Coalesce missed observations into one fresh attempt; never recreate an expired transaction.
      let outcome = 'DISABLED';
      if (s.claims) {
        try {
          await this.run(key, 'claims', { scheduledAt: iso(due) });
          outcome = 'ATTEMPTED';
        } catch (e) {
          outcome = safeError(e);
        }
      }
      this.store.append(
        'SCHEDULE',
        { id: key, outcome, scheduledAt: iso(due), observedAt: iso(now) },
        now,
      );
    }
    if (s.hourly || s.daily) {
      const queue = await this.adapter.queue();
      for (const plan of queue) {
        const channel = plan.type === 'HOURLY' ? 'hourly' : 'daily';
        if (!s[channel] || plan.qualified !== true || amount(plan.principalLamports) === 0n)
          continue;
        try {
          await this.run('payout:' + plan.id + ':' + plan.snapshotHash, channel, {
            planId: plan.id,
            snapshotHash: plan.snapshotHash,
          });
        } catch (e) {
          this.store.append('BLOCKED', { planId: plan.id, error: safeError(e) }, now);
          break;
        }
      }
    }
  }
  status() {
    const jobs = this.store.jobs(),
      s = this.store.settings();
    return {
      schema: 'paperfund-automation-status-v1',
      at: iso(this.clock()),
      processId: process.pid,
      settings: s,
      nextClaimAt: iso(nextClaim(this.clock())),
      claimSchedule: 'HH:59 UTC',
      dailyCutoff: '00:00 UTC; qualification and final reward freeze required',
      lastSuccessfulClaim:
        jobs.filter((j) => j.kind === 'claim' && j.state === 'FINALIZED_VERIFIED').at(-1) ?? null,
      jobs: jobs.map(({ prepared, signedArtifact, ...publicJob }) => publicJob),
      requests: this.store.events
        .filter((e) => e.type === 'REQUEST' || e.type === 'REQUEST_REJECTED')
        .slice(-30)
        .map((e) => ({ at: e.at, ...e.data })),
      unresolved: this.store.unresolved().length,
      auditHead: this.store.events.at(-1)?.hash ?? null,
    };
  }
}
