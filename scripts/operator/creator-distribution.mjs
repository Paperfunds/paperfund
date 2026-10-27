// Read-only verification of an external creator-claim split. No signer or sender.
import { Transaction, SystemProgram, SystemInstruction } from '@solana/web3.js';
import { identifyClaimReceipt } from './receipts.mjs';
import { WALLET } from './common.mjs';
import { encode58 } from './key-public.mjs';
import { amount, sha, fail } from './automation-core.mjs';
const exact = (v) => {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0) fail('SPLIT_RPC_INTEGER_INVALID');
  return BigInt(v);
};
const parts = (v) => {
  if (
    !Array.isArray(v) ||
    !v.length ||
    new Set(v.map((a) => a.creatorFeeEventId)).size !== v.length
  )
    fail('SPLIT_ALLOCATION_INVALID');
  return v
    .map((a) => {
      if (
        typeof a.creatorFeeEventId !== 'string' ||
        !a.creatorFeeEventId ||
        amount(a.lamports) <= 0n
      )
        fail('SPLIT_ALLOCATION_INVALID');
      return { creatorFeeEventId: a.creatorFeeEventId, lamports: amount(a.lamports) };
    })
    .sort((a, b) => a.creatorFeeEventId.localeCompare(b.creatorFeeEventId));
};
const sum = (v) => v.reduce((n, a) => n + a.lamports, 0n);
export async function verifyCreatorDistributions(
  rpc,
  funding,
  receipts,
  treasury,
  expectedPlatform,
) {
  const distributions = funding.creatorDistributions;
  if (distributions === undefined) {
    if (funding.model !== undefined) fail('CREATOR_SPLIT_EVIDENCE_REQUIRED');
    return {};
  }
  if (
    funding.model !== 'CREATOR_SPLIT_V1' ||
    !Array.isArray(distributions) ||
    !distributions.length ||
    !expectedPlatform ||
    funding.platformWallet !== expectedPlatform ||
    expectedPlatform === treasury ||
    expectedPlatform === WALLET
  )
    fail('CREATOR_SPLIT_POLICY_INVALID');
  const claims = [],
    platformSettlements = [],
    used = new Set(),
    assigned = new Set(),
    events = new Set();
  if (funding.receipts.some((r) => r.kind === 'NETWORK_FEES' && r.source === WALLET))
    fail('CREATOR_SPLIT_FEE_CAPITAL_SOURCE_UNQUALIFIED');
  for (const d of distributions) {
    if (used.has(d.claimSignature)) fail('CREATOR_SPLIT_DUPLICATE');
    used.add(d.claimSignature);
    const status = (
      await rpc('getSignatureStatuses', [[d.claimSignature], { searchTransactionHistory: true }])
    ).value?.[0];
    const claimTx = await rpc('getTransaction', [
      d.claimSignature,
      { encoding: 'json', commitment: 'finalized', maxSupportedTransactionVersion: 0 },
    ]);
    const claim = identifyClaimReceipt(d.claimSignature, claimTx, status, d.vault);
    if (
      !claim ||
      claimTx.transaction?.signatures?.[0]!==d.claimSignature ||
      claim.treasury !== WALLET ||
      BigInt(claim.finalizedSlot) > amount(funding.throughSlot) ||
      amount(claim.lamports) !== amount(d.grossLamports)
    )
      fail('CREATOR_SPLIT_CLAIM_UNVERIFIED');
    const allocations = parts(d.allocations),
      gross = sum(allocations),
      credited = new Map(allocations.map((a) => [a.creatorFeeEventId, 0n]));
    if (gross !== amount(claim.lamports)) fail('CREATOR_SPLIT_ATTRIBUTION_INCOMPLETE');
    for (const a of allocations) {
      if (events.has(a.creatorFeeEventId)) fail('CREATOR_SPLIT_DUPLICATE_EVENT');
      events.add(a.creatorFeeEventId);
    }
    const add = (values) => {
      for (const a of values) {
        const old = credited.get(a.creatorFeeEventId);
        if (old === undefined) fail('CREATOR_SPLIT_EVENT_MISMATCH');
        credited.set(a.creatorFeeEventId, old + a.lamports);
      }
    };
    if (!Array.isArray(d.rewardReceiptIdentities)) fail('CREATOR_SPLIT_REWARD_RECEIPTS_REQUIRED');
    for (const id of d.rewardReceiptIdentities) {
      const r = receipts.find((r) => r.identity === id),
        input = funding.receipts.find((r) => r.identity === id);
      if (
        assigned.has(id) ||
        !r ||
        r.kind !== 'CREATOR_FEE' ||
        input.source !== WALLET ||
        r.finalizedSlot < BigInt(claim.finalizedSlot)
      )
        fail('CREATOR_SPLIT_REWARD_RECEIPT_INVALID');
      assigned.add(id);
      add(r.allocations);
    }
    const transactions = new Map([
      [
        d.claimSignature,
        {
          slot: exact(claimTx.slot),
          fee: exact(claimTx.meta.fee),
          hash: sha(JSON.stringify(claimTx)),
        },
      ],
    ]);
    for (const transfer of d.platformTransfers ?? []) {
      const identity = transfer.signature + ':' + transfer.transferIndex;
      if (
        assigned.has(identity) ||
        !Number.isSafeInteger(transfer.transferIndex) ||
        transfer.transferIndex < 0
      )
        fail('CREATOR_SPLIT_DUPLICATE');
      assigned.add(identity);
      const status = (
        await rpc('getSignatureStatuses', [
          [transfer.signature],
          { searchTransactionHistory: true },
        ])
      ).value?.[0];
      const raw = await rpc('getTransaction', [
        transfer.signature,
        { encoding: 'base64', commitment: 'finalized', maxSupportedTransactionVersion: 0 },
      ]);
      if (
        !raw ||
        raw.meta?.err !== null ||
        status?.confirmationStatus !== 'finalized' ||
        status.err !== null ||
        status.slot !== raw.slot ||
        raw.slot < claimTx.slot ||
        exact(raw.slot) > amount(funding.throughSlot)
      )
        fail('CREATOR_SPLIT_TRANSFER_NOT_FINAL');
      const tx = Transaction.from(Buffer.from(raw.transaction[0], 'base64'));
      if (
        !tx.verifySignatures() ||
        tx.signature === null ||
        encode58(tx.signature) !== transfer.signature ||
        tx.signatures[0].publicKey.toBase58() !== WALLET
      )
        fail('CREATOR_SPLIT_TRANSFER_SIGNATURE');
      // Restrict this path to independently reviewable simple external platform transfers.
      if (
        tx.instructions.length !== 1 ||
        transfer.transferIndex !== 0 ||
        !tx.instructions[0].programId.equals(SystemProgram.programId)
      )
        fail('CREATOR_SPLIT_TRANSFER_COMPLEX');
      const ix = SystemInstruction.decodeTransfer(tx.instructions[0]),
        principal = BigInt(ix.lamports),
        keys = tx.compileMessage().accountKeys.map((k) => k.toBase58());
      const source = keys.indexOf(WALLET),
        destination = keys.indexOf(expectedPlatform),
        fee = exact(raw.meta.fee);
      if (
        ix.fromPubkey.toBase58() !== WALLET ||
        ix.toPubkey.toBase58() !== expectedPlatform ||
        principal !== amount(transfer.lamports) ||
        source < 0 ||
        destination < 0 ||
        exact(raw.meta.preBalances[source]) - exact(raw.meta.postBalances[source]) !==
          principal + fee ||
        exact(raw.meta.postBalances[destination]) - exact(raw.meta.preBalances[destination]) !==
          principal
      )
        fail('CREATOR_SPLIT_TRANSFER_EFFECTS');
      const a = parts(transfer.allocations);
      if (sum(a) !== principal) fail('CREATOR_SPLIT_ALLOCATION_INVALID');
      add(a);
      const evidenceHash = sha(JSON.stringify(raw));
      transactions.set(transfer.signature, { slot: exact(raw.slot), fee, hash: evidenceHash });
      platformSettlements.push({
        identity,
        claimIdentity: claim.identity,
        kind: 'TRANSFER',
        destination: expectedPlatform,
        lamports: principal,
        allocations: a,
        finalizedSlot: exact(raw.slot),
        evidenceHash,
      });
    }
    for (const cost of d.costs ?? []) {
      const identity = cost.signature + ':fee';
      if (assigned.has(identity)) fail('CREATOR_SPLIT_DUPLICATE');
      assigned.add(identity);
      const tx = transactions.get(cost.signature);
      if (!tx || tx.fee !== amount(cost.lamports)) fail('CREATOR_SPLIT_COST_UNVERIFIED');
      const a = parts(cost.allocations);
      if (sum(a) !== tx.fee) fail('CREATOR_SPLIT_ALLOCATION_INVALID');
      add(a);
      platformSettlements.push({
        identity,
        claimIdentity: claim.identity,
        kind: 'COST',
        destination: 'NETWORK_FEE',
        lamports: tx.fee,
        allocations: a,
        finalizedSlot: tx.slot,
        evidenceHash: tx.hash,
      });
    }
    if (allocations.some((a) => credited.get(a.creatorFeeEventId) !== a.lamports))
      fail('CREATOR_SPLIT_PARTITION_INCOMPLETE');
    claims.push({
      identity: claim.identity,
      grossLamports: gross,
      allocations,
      finalizedSlot: BigInt(claim.finalizedSlot),
      evidenceHash: claim.evidenceHash,
    });
  }
  if (receipts.some((r) => r.kind === 'CREATOR_FEE' && !assigned.has(r.identity)))
    fail('CREATOR_SPLIT_UNASSIGNED_RECEIPT');
  return { creatorClaims: claims, platformSettlements };
}
