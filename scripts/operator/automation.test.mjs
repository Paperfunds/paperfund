import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateKeyPairSync, sign } from 'node:crypto';
import {
  AutomationEngine,
  EventStore,
  validatePolicy,
  verifyMandate,
  COMPROMISED,
  MAINNET,
  nextClaim,
  dueClaim,
} from './automation-core.mjs';
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'paperfund-automation-test-')),
    keys = generateKeyPairSync('ed25519');
  let now = Date.parse('2026-10-20T12:59:00Z'),
    stopped = false,
    finalized = false,
    failSend = false,
    signs = 0,
    sends = 0,
    prepareError = false;
  const policy = {
    schema: 'paperfund-standing-automation-v1',
    id: 'disposable-policy-00000001',
    operator: 'DISPOSABLE_OFFLINE_TEST',
    generation: 0,
    financialStopGeneration: '0',
    issuedAt: new Date(now - 1000).toISOString(),
    expiresAt: new Date(now + 3600000).toISOString(),
    network: 'mainnet-beta',
    genesis: MAINNET,
    wallet: '11111111111111111111111111111112',
    mint: '11111111111111111111111111111113',
    custody: {
      rotationConfirmed: true,
      wallet: '11111111111111111111111111111112',
      mode: 'DPAPI_CURRENT_USER_ISOLATED',
    },
    claims: {
      enabled: true,
      instruction: 'collect_creator_fee_v2',
      minGrossLamports: '10000',
      maxGrossLamports: '50000',
      maxHourlyGrossLamports: '50000',
      maxDailyGrossLamports: '100000',
      maxFeeLamports: '5000',
      maxDailyFeeLamports: '20000',
      maxTransactionsPerHour: 2,
      maxTransactionsPerDay: 4,
    },
    payouts: {
      recipients: 'IMMUTABLE_QUALIFIED_EXISTING_PLANS',
      maxRecipientLamports: '10000',
      maxDailyLamports: '50000',
      maxOutstandingLamports: '50000',
      maxFeeLamports: '5000',
      maxDailyFeeLamports: '20000',
      maxTransactionsPerDay: 4,
      hourly: { enabled: true, maxRoundLamports: '10000' },
      daily: { enabled: true, maxRoundLamports: '20000' },
    },
  };
  const store = new EventStore(root, keys.privateKey, keys.publicKey);
  const adapter = {
    prepare: async () => {
      if (prepareError) throw Error('AUTO_RPC_UNAVAILABLE');
      return {
        principalLamports: '20000',
        maximumFeeLamports: '5000',
        unsigned: 'PUBLIC_SIMULATED_TEST_ONLY',
      };
    },
    preflight: async () => {},
    sign: async () => {
      signs++;
      return { signature: 'SYNTHETIC_UNIT_TEST_NOT_ON_CHAIN', artifact: 'MEMORY_ONLY_TEST' };
    },
    submit: async () => {
      sends++;
      if (failSend) throw Error('AUTO_RPC_UNAVAILABLE');
      return 'SYNTHETIC_UNIT_TEST_NOT_ON_CHAIN';
    },
    reconcile: async () => ({
      finalized,
      success: true,
      signature: 'SYNTHETIC_UNIT_TEST_NOT_ON_CHAIN',
    }),
    recoverSigned: async () => ({ neverSubmitted: true }),
    queue: async () => [],
  };
  const gate = async () => ({
    healthy: true,
    stopped,
    stopGeneration: '0',
    provider: 'UNQUALIFIED',
    utc: 'UNQUALIFIED',
    mainnetPayoutAccepted: false,
  });
  const loadPolicy = () => validatePolicy(structuredClone(policy), now);
  const create = (s = store) =>
    new AutomationEngine({ store: s, loadPolicy, gate, adapter, clock: () => now });
  return {
    root,
    keys,
    store,
    policy,
    adapter,
    create,
    engine: create(),
    get signs() {
      return signs;
    },
    get sends() {
      return sends;
    },
    set now(n) {
      now = n;
    },
    get now() {
      return now;
    },
    set stopped(v) {
      stopped = v;
    },
    set finalized(v) {
      finalized = v;
    },
    set failSend(v) {
      failSend = v;
    },
    set prepareError(v) {
      prepareError = v;
    },
    cleanup() {
      const resolved = path.resolve(root);
      assert(
        resolved.startsWith(path.resolve(os.tmpdir()) + path.sep + 'paperfund-automation-test-'),
      );
      fs.rmSync(resolved, { recursive: true });
    },
  };
}
test('UTC HH:59 boundaries and missed-run coalescing do not depend on local timezone', () => {
  assert.equal(
    new Date(nextClaim(Date.parse('2026-10-20T12:58:59.999Z'))).toISOString(),
    '2026-10-20T12:59:00.000Z',
  );
  assert.equal(
    new Date(nextClaim(Date.parse('2026-10-20T12:59:00Z'))).toISOString(),
    '2026-10-20T13:59:00.000Z',
  );
  assert.equal(
    new Date(dueClaim(Date.parse('2026-10-21T00:01:00Z'))).toISOString(),
    '2026-10-20T23:59:00.000Z',
  );
});
test('standing mandate signature, expiry, revocation and compromised-custody exclusion', () => {
  const f = fixture();
  try {
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 }),
      bytes = Buffer.from(JSON.stringify(f.policy)),
      envelope = {
        payloadBase64: bytes.toString('base64'),
        signatureBase64: sign('sha256', bytes, rsa.privateKey).toString('base64'),
      },
      publicKey = rsa.publicKey.export({ type: 'spki', format: 'pem' });
    assert.equal(verifyMandate(envelope, publicKey, [], f.now).id, f.policy.id);
    assert.throws(() => verifyMandate(envelope, publicKey, [f.policy.id], f.now), /REVOKED/);
    assert.throws(
      () =>
        verifyMandate(
          {
            ...envelope,
            payloadBase64: Buffer.from(
              JSON.stringify({ ...f.policy, operator: 'TAMPERED' }),
            ).toString('base64'),
          },
          publicKey,
          [],
          f.now,
        ),
      /SIGNATURE_INVALID/,
    );
    assert.throws(
      () => validatePolicy({ ...f.policy, wallet: COMPROMISED }, f.now),
      /FRESH_CUSTODY/,
    );
    assert.throws(() => validatePolicy(f.policy, f.now + 3600001), /EXPIRED/);
  } finally {
    f.cleanup();
  }
});
test('unconfigured and STOP-controlled channels cannot be enabled or sign', async () => {
  const f = fixture();
  try {
    f.stopped = true;
    await assert.rejects(f.engine.control('claims:on'), /STOP/);
    await assert.rejects(f.engine.run('job', 'claims', {}), /STOP/);
    assert.equal(f.signs, 0);
    assert.equal(f.sends, 0);
    f.stopped = false;
    await assert.rejects(f.engine.control('hourly:on'), /QUALIFICATION/);
    await assert.rejects(f.engine.control('daily:on'), /QUALIFICATION/);
  } finally {
    f.cleanup();
  }
});
test('lost acknowledgement survives restart; reconciliation never rebroadcasts and finality is idempotent', async () => {
  const f = fixture();
  try {
    f.failSend = true;
    await assert.rejects(f.engine.run('one', 'claims', {}), /RPC_UNAVAILABLE/);
    assert.equal(f.signs, 1);
    assert.equal(f.sends, 1);
    assert.equal(f.store.jobs()[0].state, 'SUBMISSION_UNCERTAIN');
    const restarted = new EventStore(f.root, f.keys.privateKey, f.keys.publicKey),
      engine = f.create(restarted);
    await engine.reconcile();
    await assert.rejects(engine.run('two', 'claims', {}), /UNRESOLVED/);
    assert.equal(f.sends, 1);
    f.finalized = true;
    await engine.reconcile();
    await engine.reconcile();
    assert.equal(restarted.jobs()[0].state, 'FINALIZED_VERIFIED');
    assert.equal(f.sends, 1);
    assert.equal((await engine.run('one', 'claims', {})).duplicate, true);
  } finally {
    f.cleanup();
  }
});
test('policy cap rejects a second payment before signing and aggregate daily spending is reserved', async () => {
  const f = fixture();
  try {
    await f.engine.run('one', 'claims', {});
    f.finalized = true;
    await f.engine.reconcile();
    await f.engine.run('two', 'claims', {});
    await f.engine.reconcile();
    await assert.rejects(f.engine.run('three', 'claims', {}), /CLAIM_POLICY_LIMIT/);
    assert.equal(f.signs, 2);
    assert.equal(f.store.budget('claim', f.now).daily, 40000n);
    assert.equal(f.store.budget('claim', f.now).dailyFees, 10000n);
  } finally {
    f.cleanup();
  }
});
test('STOP observed after signing prevents submission and preserves the signature', async () => {
  const f = fixture();
  try {
    const original = f.adapter.sign;
    f.adapter.sign = async () => {
      const result = await original();
      f.stopped = true;
      return result;
    };
    await assert.rejects(f.engine.run('one', 'claims', {}), /STOP/);
    assert.equal(f.signs, 1);
    assert.equal(f.sends, 0);
    assert.equal(f.store.jobs()[0].state, 'SIGNED');
    assert.equal(f.store.jobs()[0].signature, 'SYNTHETIC_UNIT_TEST_NOT_ON_CHAIN');
  } finally {
    f.cleanup();
  }
});
test('expiry during public preflight prevents signing; reservation is preserved as conclusively unsubmitted', async () => {
  const f = fixture();
  try {
    f.adapter.preflight = async () => {
      f.now += 3600001;
    };
    await assert.rejects(f.engine.run('one', 'claims', {}), /EXPIRED/);
    assert.equal(f.signs, 0);
    await f.engine.reconcile();
    assert.equal(f.store.jobs()[0].state, 'ABORTED_NOT_SUBMITTED');
  } finally {
    f.cleanup();
  }
});
test('tampered audit event or truncated tail fails closed on restart', () => {
  const f = fixture();
  try {
    f.store.append('TEST', { value: 1 });
    const event = path.join(f.root, '000000000001.event.json'),
      raw = fs.readFileSync(event, 'utf8');
    fs.writeFileSync(event, raw.replace('"value":1', '"value":2'));
    assert.throws(
      () => new EventStore(f.root, f.keys.privateKey, f.keys.publicKey),
      /AUDIT_TAMPERED/,
    );
    fs.writeFileSync(event, raw);
    fs.unlinkSync(event);
    assert.throws(
      () => new EventStore(f.root, f.keys.privateKey, f.keys.publicKey),
      /AUDIT_TAMPERED/,
    );
  } finally {
    f.cleanup();
  }
});
test('dashboard retries and disabled restart ticks cannot duplicate effects', async () => {
  const f = fixture();
  try {
    await f.engine.control('claims:off', 'request-1');
    assert.equal((await f.engine.control('claims:on', 'request-1')).duplicate, true);
    await f.engine.tick();
    const count = f.store.events.filter((e) => e.type === 'SCHEDULE').length;
    await f.create(new EventStore(f.root, f.keys.privateKey, f.keys.publicKey)).tick();
    assert.equal(f.store.events.filter((e) => e.type === 'SCHEDULE').length, count);
    assert.equal(f.signs, 0);
  } finally {
    f.cleanup();
  }
});
test('a provider outage before reservation retries with a fresh prepare after backoff, never a stale signed candidate', async () => {
  const f = fixture();
  try {
    await f.engine.control('claims:on');
    f.prepareError = true;
    await f.engine.tick();
    assert.equal(f.signs, 0);
    f.prepareError = false;
    f.now += 60001;
    await f.engine.tick();
    assert.equal(f.signs, 1);
    assert.equal(f.sends, 1);
    await f.engine.tick();
    assert.equal(f.sends, 1);
  } finally {
    f.cleanup();
  }
});
test('payout caps apply across hourly and daily channels; recipient overrides are not an action', async () => {
  const f = fixture();
  try {
    assert.throws(
      () =>
        f.engine.checkBudget(f.policy, 'payout', 'hourly', '10001', '5000', [
          { lamports: '10001' },
        ]),
      /PAYOUT_POLICY_LIMIT/,
    );
    assert.throws(
      () => f.engine.checkBudget(f.policy, 'payout', 'daily', '20001', '5000', []),
      /PAYOUT_POLICY_LIMIT/,
    );
    await assert.rejects(f.engine.control('transfer:anywhere'), /CONTROL_INVALID/);
    assert.equal(f.sends, 0);
  } finally {
    f.cleanup();
  }
});
