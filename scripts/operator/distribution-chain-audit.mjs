import fs from 'node:fs';
import { readonlyRpc } from './discovery.mjs';
import { identifyClaimReceipt } from './receipts.mjs';
import { WALLET, GENESIS } from './common.mjs';
import { PublicKey, SystemInstruction, SystemProgram, Transaction } from '@solana/web3.js';
const claim =
  '2R9LJiad5GXZ4dajxAYAERsrqCMQfB2A8dhnRTabcSNyNLDHiGn4prz48gEpdVXJLcMMRsnyyJEr9z5ggz9uFsfv';
const transfer =
  '5bXpGR5X38Coa3FxnVN6ZruARsLuo7Xq7mk6sCeCRH3iUKU2KFzLV8qkm8DFQynwn9SntLRUNSbt6gdeTRLXQqJP';
const destination = '53sJCZ59TSkVynoD9SfaAXZMKyZtvRgN9QZTrzqRXrbx';
const { rpc, captures } = await readonlyRpc();
if ((await rpc('getGenesisHash')) !== GENESIS) throw Error('GENESIS_MISMATCH');
const statuses = await rpc('getSignatureStatuses', [
  [claim, transfer],
  { searchTransactionHistory: true },
]);
const tx = await rpc('getTransaction', [
  claim,
  { encoding: 'json', commitment: 'finalized', maxSupportedTransactionVersion: 0 },
]);
const receipt = identifyClaimReceipt(
  claim,
  tx,
  statuses.value[0],
  '3swpgMo1CEeBvkfZMniPceRk1Km398SqjabJ7y1TAAF5',
);
if (receipt?.lamports !== '11410357' || tx.meta.fee !== 5000) throw Error('CLAIM_MISMATCH');
const paid = await rpc('getTransaction', [
  transfer,
  { encoding: 'base64', commitment: 'finalized', maxSupportedTransactionVersion: 0 },
]);
const decoded = Transaction.from(Buffer.from(paid.transaction[0], 'base64'));
if (
  statuses.value[1]?.confirmationStatus !== 'finalized' ||
  statuses.value[1]?.err !== null ||
  statuses.value[1].slot !== paid.slot ||
  paid.meta.err !== null ||
  !decoded.verifySignatures() ||
  decoded.instructions.length !== 1 ||
  !decoded.instructions[0].programId.equals(SystemProgram.programId)
)
  throw Error('TRANSFER_FINALITY_OR_MESSAGE');
const instruction = SystemInstruction.decodeTransfer(decoded.instructions[0]);
const keys = decoded.compileMessage().accountKeys.map((k) => k.toBase58());
const i = keys.indexOf(WALLET),
  j = keys.indexOf(destination);
if (
  instruction.fromPubkey.toBase58() !== WALLET ||
  instruction.toPubkey.toBase58() !== destination ||
  BigInt(instruction.lamports) !== 1131036n ||
  paid.meta.fee !== 5000 ||
  BigInt(paid.meta.preBalances[i]) - BigInt(paid.meta.postBalances[i]) !== 1136036n ||
  BigInt(paid.meta.postBalances[j]) - BigInt(paid.meta.preBalances[j]) !== 1131036n
)
  throw Error('TRANSFER_DELTAS');
const invites = [
  '7Q1KVJb7mTEdoxSwqGoPH6q6YehHHXqacSNkAxessNUm',
  '4kTiGiy9GfNkgNwgLS9LR28V6n12CwvBnVRNYWRW5KAi',
];
const accounts = await rpc('getMultipleAccounts', [
  invites,
  { commitment: 'finalized', encoding: 'base64' },
]);
const out = {
  at: new Date().toISOString(),
  readOnly: true,
  claim: receipt,
  claimFeeLamports: '5000',
  platform: {
    signature: transfer,
    destination,
    creditLamports: '1131036',
    feeLamports: '5000',
    debitLamports: '1136036',
    status: 'FINALIZED_VERIFIED',
  },
  playerPrincipalLamports: '10269321',
  platformGrossAllocationLamports: '1141036',
  platformBudgetConserved: 1141036n === 1131036n + 5000n + 5000n,
  recipients: invites.map((wallet, i) => ({
    wallet,
    onCurve: PublicKey.isOnCurve(new PublicKey(wallet).toBytes()),
    accountExists: !!accounts.value[i],
    balanceLamports: String(accounts.value[i]?.lamports ?? 0),
    ownershipConfirmed: false,
  })),
  captures,
};
fs.writeFileSync(
  'docs/reward-distribution-20261026/chain.json',
  JSON.stringify(out, null, 2) + '\n',
);
console.log(JSON.stringify({ ...out, captures: undefined }, null, 2));
