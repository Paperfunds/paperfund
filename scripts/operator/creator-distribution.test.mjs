import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { verifyCreatorDistributions } from './creator-distribution.mjs';
import { WALLET } from './common.mjs';
const raw = JSON.parse(fs.readFileSync('docs/reward-distribution-20261026/chain.json', 'utf8'));
const claim = raw.claim.signature,
  transfer = raw.platform.signature,
  platform = raw.platform.destination;
const claimTx = JSON.parse(
  raw.captures.find((c) => c.request.method === 'getTransaction' && c.request.params[0] === claim)
    .raw,
).result;
const platformTx = JSON.parse(
  raw.captures.find(
    (c) => c.request.method === 'getTransaction' && c.request.params[0] === transfer,
  ).raw,
).result;
const statuses = JSON.parse(
  raw.captures.find((c) => c.request.method === 'getSignatureStatuses').raw,
).result.value;
function setup() {
  const a = (lamports) => [{ creatorFeeEventId: 'ISOLATED_EVENT_NOT_BOOKED', lamports }];
  // The historical player principal is still held at GHMG. This preverified receipt is
  // a unit-test dependency ONLY, not evidence of an actual reward-treasury transfer.
  const receipts = [
    {
      identity: 'ISOLATED_PREVERIFIED_REWARD_RECEIPT',
      kind: 'CREATOR_FEE',
      creatorFeeEventId: 'ISOLATED_EVENT_NOT_BOOKED',
      lamports: 10269321n,
      allocations: a(10269321n),
      finalizedSlot: BigInt(platformTx.slot),
    },
  ];
  const funding = {
    model: 'CREATOR_SPLIT_V1',
    throughSlot: String(platformTx.slot),
    platformWallet: platform,
    receipts: [{ identity: receipts[0].identity, source: WALLET }],
    creatorDistributions: [
      {
        claimSignature: claim,
        vault: '3swpgMo1CEeBvkfZMniPceRk1Km398SqjabJ7y1TAAF5',
        grossLamports: '11410357',
        allocations: a('11410357'),
        rewardReceiptIdentities: [receipts[0].identity],
        platformTransfers: [
          { signature: transfer, transferIndex: 0, lamports: '1131036', allocations: a('1131036') },
        ],
        costs: [
          { signature: claim, lamports: '5000', allocations: a('5000') },
          { signature: transfer, lamports: '5000', allocations: a('5000') },
        ],
      },
    ],
  };
  const txs = new Map([
    [claim, structuredClone(claimTx)],
    [transfer, structuredClone(platformTx)],
  ]);
  const rpc = async (method, params) => {
    if (method === 'getTransaction') return txs.get(params[0]);
    if (method === 'getSignatureStatuses')
      return { value: params[0].map((s) => (s === claim ? statuses[0] : statuses[1])) };
    throw Error('UNEXPECTED_READ');
  };
  return { funding, receipts, txs, rpc };
}
test('actual historical claim and external platform leg conserve gross, costs and protected player ownership without crediting production', async () => {
  const s = setup(),
    r = await verifyCreatorDistributions(
      s.rpc,
      s.funding,
      s.receipts,
      'FRESH_ISOLATED_TREASURY',
      platform,
    );
  assert.equal(r.creatorClaims[0].grossLamports, 11410357n);
  assert.equal(
    r.platformSettlements.reduce((n, p) => n + p.lamports, 0n),
    1141036n,
  );
  assert.equal(
    r.creatorClaims[0].grossLamports - r.platformSettlements.reduce((n, p) => n + p.lamports, 0n),
    10269321n,
  );
});
test('wrong destination, unsigned policy enrollment and altered finalized effects remain held', async () => {
  const s = setup();
  await assert.rejects(
    verifyCreatorDistributions(s.rpc, s.funding, s.receipts, 'FRESH', undefined),
    /CREATOR_SPLIT_POLICY_INVALID/,
  );
  await assert.rejects(
    verifyCreatorDistributions(s.rpc, s.funding, s.receipts, 'FRESH', 'wrong'),
    /CREATOR_SPLIT_POLICY_INVALID/,
  );
  s.txs.get(transfer).meta.fee++;
  await assert.rejects(
    verifyCreatorDistributions(s.rpc, s.funding, s.receipts, 'FRESH', platform),
    /CREATOR_SPLIT_TRANSFER_EFFECTS/,
  );
});
test('missing player funding, double claim credit, duplicate fee charges and invented transaction costs fail closed', async () => {
  for (const mutate of [
    (s)=>{s.txs.get(claim).transaction.signatures[0]='wrong-signature';},
    (s) => s.receipts[0].allocations[0].lamports--,
    (s) => s.funding.creatorDistributions.push(s.funding.creatorDistributions[0]),
    (s) => s.funding.creatorDistributions[0].costs.push(s.funding.creatorDistributions[0].costs[0]),
    (s) => (s.funding.creatorDistributions[0].costs[0].lamports = '4999'),
  ]) {
    const s = setup();
    mutate(s);
    await assert.rejects(
      verifyCreatorDistributions(s.rpc, s.funding, s.receipts, 'FRESH', platform),
    );
  }
});
test('legacy treasury profile is unchanged and split evidence cannot be silently omitted after persistence', async () => {
  assert.deepEqual(
    await verifyCreatorDistributions(
      () => {
        throw Error('NO_READ_EXPECTED');
      },
      {},
      [],
      'FRESH',
      undefined,
    ),
    {},
  );
});
