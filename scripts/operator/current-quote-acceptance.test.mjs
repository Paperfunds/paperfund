import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { verifyFinancialAcceptance } from './mainnet-evidence.mjs';
import { assertCurrentQuoteSourceScope } from './current-quote-acceptance.mjs';
import { MAINNET } from './automation-core.mjs';
const root = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }),
  certificate = root.publicKey.export({ type: 'spki', format: 'pem' });
function fixture() {
  const from = '2047-01-01T00:00:00.000Z',
    to = '2047-01-01T01:00:00.000Z',
    route = 'a'.repeat(64),
    cutoff = 'b'.repeat(64),
    evidence = 'c'.repeat(64);
  return {
    schema: 'paperfund-mainnet-financial-acceptance-v1',
    profile: 'MAINNET_FINALIZED_V1',
    executionModel: 'CURRENT_NATIVE_CUTOFF_V1',
    settlementPolicyId: 'isolated-future-policy',
    network: 'mainnet-beta',
    genesis: MAINNET,
    wallet: '7Q1KVJb7mTEdoxSwqGoPH6q6YehHHXqacSNkAxessNUm',
    mint: '3JVd8Z3kEEXBaBoZo9rcWk4MHJPSUAf6zAjvAF5spump',
    issuedAt: to,
    expiresAt: '2047-01-02T00:00:00.000Z',
    hours: [
      {
        roundId: 'hour',
        startsAt: from,
        endsAt: to,
        structuralHash: 'd'.repeat(64),
        routeEvidenceHash: route,
        cutoffEvidenceHash: cutoff,
      },
    ],
    utc: {
      method: 'NTS_BOUNDED',
      maxUncertaintyMs: 100,
      sourceUncertaintyMs: 1,
      asymmetryBoundMs: 1,
      holdoverBoundMs: 1,
      hostDbBoundMs: 1,
      evidenceHashes: [evidence],
      coveredFrom: from,
      coveredThrough: to,
    },
    provider: {
      network: 'mainnet-beta',
      genesis: MAINNET,
      scope: 'ACTUALLY_USED_ROUTES_V1',
      identities: ['isolated-provider-a', 'isolated-provider-b'],
      evidenceHashes: [evidence],
      coveredFrom: from,
      coveredThrough: to,
      routeCoverage: [
        {
          roundId: 'hour',
          routeCount: 1,
          routeEvidenceHash: route,
          cutoffEvidenceHash: cutoff,
          settlementKind: 'FLAT_AT_CUTOFF',
        },
      ],
    },
    funding: {
      historyComplete: true,
      openingBalanceLamports: '0',
      openingSlot: '0',
      throughSlot: '1',
      historySignatures: [],
      receipts: [{ fixture: true }],
      evidenceHash: evidence,
    },
  };
}
function verify(p) {
  const bytes = Buffer.from(JSON.stringify(p)),
    envelope = {
      payloadBase64: bytes.toString('base64'),
      signatureBase64: sign('sha256', bytes, root.privateKey).toString('base64'),
    };
  return verifyFinancialAcceptance(envelope, certificate, [], Date.parse(p.issuedAt) + 1);
}
test('signed current-model flat source scopes evidence to actual routes without inventing a cutoff exit or all-market universe', () => {
  const p = verify(fixture());
  assert.equal(p.executionModel, 'CURRENT_NATIVE_CUTOFF_V1');
});
test('current-model scope cannot waive UTC, independent providers, fresh custody or hash binding', () => {
  for (const change of [
    (p) => (p.utc.maxUncertaintyMs = 101),
    (p) => (p.provider.identities = ['one']),
    (p) => (p.wallet = 'GHMGUyYpdaC4TfUTwHEWBeZHPYq6csJDP1iVuYCjyQyW'),
    (p) => (p.hours[0].routeEvidenceHash = 'e'.repeat(64)),
    (p) => (p.executionModel = 'UNKNOWN'),
    (p) => (p.provider.scope = 'UNIVERSE_WAIVER'),
  ]) {
    const p = fixture();
    change(p);
    assert.throws(() => verify(p));
  }
});
test('forced current-model exits require an archived capture hash; legacy profile retains its original universe guard', () => {
  const p = fixture();
  p.provider.routeCoverage[0].settlementKind = 'PINNED_CUTOFF_EXITS';
  assert.throws(() => verify(p), /CURRENT_SOURCE_EVIDENCE/);
  p.hours[0].preCutoffCaptureHash = p.provider.evidenceHashes[0];
  verify(p);
  const old = fixture();
  delete old.executionModel;
  assert.throws(() => verify(old), /PROVIDER_ACCEPTANCE/);
});
test('publication/runtime rechecks policy and exact database scope, without granting financial authority', async () => {
  const p = fixture(),
    h = p.hours[0],
    row = { ...p.provider.routeCoverage[0], qualified: true };
  await assertCurrentQuoteSourceScope({ query: async () => ({ rows: [{ proof: row }] }) }, p, h);
  for (const bad of [
    { ...row, qualified: false },
    { ...row, routeCount: 2 },
    { ...row, cutoffEvidenceHash: 'e'.repeat(64) },
  ])
    await assert.rejects(
      assertCurrentQuoteSourceScope({ query: async () => ({ rows: [{ proof: bad }] }) }, p, h),
      /CURRENT_SOURCE_SCOPE/,
    );
});
