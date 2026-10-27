import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { identifyClaimReceipt } from './receipts.mjs';
const captured = JSON.parse(
  fs.readFileSync(new URL('./fixtures/native-sol-claim-receipt.json', import.meta.url)),
);
const vault = '3swpgMo1CEeBvkfZMniPceRk1Km398SqjabJ7y1TAAF5';
test('actual finalized native SOL claim reconciles gross without crediting reward capital', () => {
  const r = identifyClaimReceipt(captured.signature, captured.tx, captured.status, vault);
  assert.equal(r.lamports, '11410357');
  assert.equal(
    r.classification,
    'FINALIZED_CREATOR_AGGREGATE_RECEIPT_TOKEN_ATTRIBUTION_REQUIRES_REVIEW',
  );
  assert.equal(r.finalizedSlot, '459356594');
});
test('native SOL compatibility still rejects wrong authority, vault, finality and amount', () => {
  assert.equal(
    identifyClaimReceipt(
      captured.signature,
      captured.tx,
      { ...captured.status, confirmationStatus: 'confirmed' },
      vault,
    ),
    null,
  );
  assert.equal(
    identifyClaimReceipt(
      captured.signature,
      captured.tx,
      captured.status,
      '11111111111111111111111111111111',
    ),
    null,
  );
  const tx = structuredClone(captured.tx);
  const i = tx.transaction.message.accountKeys.indexOf(vault);
  tx.meta.postBalances[i]++;
  assert.throws(
    () => identifyClaimReceipt(captured.signature, tx, captured.status, vault),
    /BALANCE_RECONCILIATION/,
  );
  const wrong = structuredClone(captured.tx);
  wrong.transaction.message.accountKeys[
    wrong.transaction.message.accountKeys.indexOf('GHMGUyYpdaC4TfUTwHEWBeZHPYq6csJDP1iVuYCjyQyW')
  ] = '11111111111111111111111111111111';
  assert.equal(identifyClaimReceipt(captured.signature, wrong, captured.status, vault), null);
});
test('missing or foreign-program event cannot be accepted through native SOL compatibility', () => {
  for (const logs of [
    [],
    captured.tx.meta.logMessages.map((l) =>
      l.replace(
        'Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P invoke',
        'Program 11111111111111111111111111111111 invoke',
      ),
    ),
  ]) {
    const tx = structuredClone(captured.tx);
    tx.meta.logMessages = logs;
    assert.throws(
      () => identifyClaimReceipt(captured.signature, tx, captured.status, vault),
      /EVENT_RECONCILIATION/,
    );
  }
});
