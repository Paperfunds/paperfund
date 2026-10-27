import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconcileObservation, failedObservation } from './monitor.mjs';
import { publicError } from './errors.mjs';
import { identifyClaimReceipt, observeReceipts } from './receipts.mjs';
import { operatorServer } from './server.mjs';
test('version 1 history is read but never granted financial credit', async () => {
  assert.equal(identifyClaimReceipt('sig', { version: 1 }, null, 'vault'), null);
  let requests = 0;
  const r = await observeReceipts(async (method, params) => {
    if (method === 'getSignaturesForAddress') return [{ signature: 'sig' }];
    if (method === 'getTransaction') {
      requests++;
      assert.equal(params[1].maxSupportedTransactionVersion, 1);
      return { version: 1 };
    }
    if (method === 'getSignatureStatuses') return { value: [{ confirmationStatus: 'finalized' }] };
    throw Error('Unexpected method');
  }, 'vault');
  assert.equal(requests, 1);
  assert.equal(r.recognizedCreatorAggregateReceivedLamports, '0');
  assert.match(r.unrelated[0].classification, /VERSION_1_REQUIRES_REVIEW/);
});
test('restart state retains schedule, deduplicates receipts and fails conflicts', () => {
  const observation = {
    observedAt: '2026-10-19T20:00:00.000Z',
    received: { receipts: [{ identity: 'sig:outer:0', lamports: '10' }] },
  };
  const first = reconcileObservation({}, observation, observation.observedAt);
  const restarted = JSON.parse(JSON.stringify(first));
  assert.equal(restarted.nextObservationAt, '2026-10-19T21:00:00.000Z');
  const second = reconcileObservation(restarted, observation, observation.observedAt);
  assert.equal(second.newReceipts, 0);
  assert.equal(second.fundingLedgerCredit, '0');
  assert.throws(
    () =>
      reconcileObservation(second, {
        ...observation,
        received: { receipts: [{ identity: 'sig:outer:0', lamports: '11' }] },
      }),
    /RECEIPT_IDENTITY_CONFLICT/,
  );
  const failed = failedObservation(second, Error('RPC_UNAVAILABLE'), observation.observedAt);
  assert.equal(failed.nextObservationAt, '2026-10-19T20:01:00.000Z');
  assert.deepEqual(failed.lastSuccessfulObservation, observation);
});
test('errors expose a specific RPC code and never credentials', () => {
  assert.equal(
    publicError(Error('RPC_REJECTED:getTransaction:HTTP_200:CODE_-32015')).code,
    'RPC_REJECTED:getTransaction:HTTP_200:CODE_-32015',
  );
  assert.equal(
    publicError(Error('fetch https://secret.provider/?api-key=secret')).code,
    'OPERATOR_INTERNAL_ERROR',
  );
});
test('authenticated HTTP failure retains actionable evidence without leaking exception', async () => {
  const base = 'http://127.0.0.1:3199';
  const { server, token } = operatorServer({
    port: 3199,
    status: async () => {
      throw Error('RPC_UNAVAILABLE');
    },
  });
  await new Promise((ok) => server.listen(3199, '127.0.0.1', ok));
  try {
    const auth = await fetch(base + '/session', {
      method: 'POST',
      headers: { origin: base, 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    const response = await fetch(base + '/api/status', {
      headers: { cookie: auth.headers.get('set-cookie').split(';')[0] },
    });
    const data = await response.json();
    assert.equal(response.status, 503);
    assert.equal(data.error, 'RPC_UNAVAILABLE');
    assert.ok(data.action);
    assert.match(data.evidence.file, /operation-error/);
  } finally {
    await new Promise((ok) => server.close(ok));
  }
});
