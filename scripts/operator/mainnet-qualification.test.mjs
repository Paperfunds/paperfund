import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeNtp, assessUtc } from './financial-qualification.mjs';
import { standingPayoutAuthority } from './automation-mainnet.mjs';
import { generateKeyPairSync } from 'node:crypto';
test('actual Windows UTC evidence above 100ms remains unqualified even when database clock agrees', () => {
  const r = assessUtc('Root Delay: 0.021s\nRoot Dispersion: 0.176s\nPhase Offset: 0.116s', [], {
    conservativeBoundMs: 2,
  });
  assert.equal(r.qualification, 'UNQUALIFIED');
  assert.ok(r.windows.rootDistanceMs > 186);
  assert.ok(r.reasons.includes('WINDOWS_ROOT_DISTANCE_EXCEEDS_100MS'));
});
test('NTP rejects replayed origins, unsynchronized server and host clock discontinuity', () => {
  const req = Buffer.alloc(48),
    res = Buffer.alloc(48);
  req.fill(7, 40, 48);
  res[0] = 0x24;
  res[1] = 2;
  req.copy(res, 24, 40, 48);
  assert.throws(
    () => decodeNtp(res, req, { startWall: 0, endWall: 200, elapsedMs: 1 }),
    /DISCONTINUITY/,
  );
  res[24] ^= 1;
  assert.throws(() => decodeNtp(res, req, { startWall: 0, endWall: 1, elapsedMs: 1 }), /INVALID/);
  res[0] = 0xe4;
  assert.throws(() => decodeNtp(res, req, { startWall: 0, endWall: 1, elapsedMs: 1 }), /INVALID/);
});
test('standing approval is bound to the operator delegation and execution to isolated signer; STOP/release cannot be delegated', async () => {
  let revoked = false;
  const p = {
    id: 'disposable-policy-000001',
    operator: 'TEST_OPERATOR',
    wallet: '11111111111111111111111111111112',
    financialStopGeneration: '4',
    expiresAt: new Date(Date.now() + 60000).toISOString(),
  };
  const a = standingPayoutAuthority({
    loadPolicy: () => {
      if (revoked) throw Error('AUTO_POLICY_REVOKED');
      return p;
    },
    requestKey: generateKeyPairSync('ed25519').privateKey,
    signerSid: 'TEST_SID',
  });
  const approval = await a.authorize('APPROVE', 'PINNED_PLAN', 'a'.repeat(64), p),
    execution = await a.authorize('EXECUTE', 'PINNED_PLAN', 'a'.repeat(64), p);
  assert.notEqual(approval.subject, execution.subject);
  assert.deepEqual((await a.verifier.verify(approval.request)).permissions, ['APPROVE']);
  await assert.rejects(a.authorize('RELEASE', '*', 'a'.repeat(64), p), /SCOPE/);
  await assert.rejects(
    a.verifier.verify({ ...execution.request, snapshotHash: 'b'.repeat(64) }),
    /SIGNATURE/,
  );
  revoked = true;
  await assert.rejects(a.verifier.verify(execution.request), /REVOKED/);
});
