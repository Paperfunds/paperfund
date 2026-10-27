import { X509Certificate, createPublicKey, verify } from 'node:crypto';
import { PublicKey, SystemInstruction, SystemProgram, Transaction } from '@solana/web3.js';
import { encode58 } from './key-public.mjs';
import { MAINNET, COMPROMISED, amount, sha, fail } from './automation-core.mjs';
import {currentQuoteAcceptance} from './current-quote-acceptance.mjs';
import {verifyCreatorDistributions} from './creator-distribution.mjs';
export function verifyFinancialAcceptance(envelope, certificate, revoked = [], now = Date.now()) {
  const bytes = Buffer.from(envelope?.payloadBase64 ?? '', 'base64');
  let key;
  try {
    key = new X509Certificate(certificate).publicKey;
  } catch {
    key = createPublicKey(certificate);
  }
  if (!verify('sha256', bytes, key, Buffer.from(envelope?.signatureBase64 ?? '', 'base64')))
    fail('FINANCIAL_ACCEPTANCE_SIGNATURE_INVALID');
  const p = JSON.parse(bytes),
    digest = sha(bytes);
  if (
    p.schema !== 'paperfund-mainnet-financial-acceptance-v1' ||
    p.profile !== 'MAINNET_FINALIZED_V1' ||
    p.network !== 'mainnet-beta' ||
    p.genesis !== MAINNET ||
    revoked.includes(digest)
  )
    fail('FINANCIAL_ACCEPTANCE_INVALID_OR_REVOKED');
  if (
    !Number.isFinite(Date.parse(p.issuedAt)) ||
    Date.parse(p.issuedAt) > now ||
    Date.parse(p.expiresAt) <= now ||
    !Number.isFinite(Date.parse(p.expiresAt)) ||
    Date.parse(p.expiresAt) - Date.parse(p.issuedAt) > 7 * 86400000
  )
    fail('FINANCIAL_ACCEPTANCE_EXPIRED');
  if (
    p.wallet === COMPROMISED ||
    new PublicKey(p.wallet).toBase58() !== p.wallet ||
    new PublicKey(p.mint).toBase58() !== p.mint
  )
    fail('FRESH_CUSTODY_REQUIRED');
  if (
    !Array.isArray(p.hours) ||
    !p.hours.length ||
    new Set(p.hours.map((h) => h.roundId)).size !== p.hours.length ||
    p.hours.some(
      (h) =>
        !h.roundId ||
        !/^[a-f0-9]{64}$/.test(h.structuralHash) ||
        !Number.isFinite(Date.parse(h.startsAt)) ||
        Date.parse(h.endsAt) - Date.parse(h.startsAt) !== 3600000,
    )
  )
    fail('SOURCE_ACCEPTANCE_INVALID');
  const u = p.utc;
  if (
    !u ||
    !['NTS_BOUNDED', 'NTP_ROOT_DISTANCE_BOUNDED'].includes(u.method) ||
    !Number.isFinite(u.maxUncertaintyMs) ||
    u.maxUncertaintyMs <= 0 ||
    u.maxUncertaintyMs > 100 ||
    !['sourceUncertaintyMs', 'asymmetryBoundMs', 'holdoverBoundMs', 'hostDbBoundMs'].every(
      (k) => Number.isFinite(u[k]) && u[k] >= 0,
    ) ||
    u.sourceUncertaintyMs + u.asymmetryBoundMs + u.holdoverBoundMs + u.hostDbBoundMs >
      u.maxUncertaintyMs ||
    !Array.isArray(u.evidenceHashes) ||
    !u.evidenceHashes.length ||
    u.evidenceHashes.some((h) => !/^[a-f0-9]{64}$/.test(h))
  )
    fail('UTC_ACCEPTANCE_INVALID');
  const v = p.provider;
  const currentModel=currentQuoteAcceptance(p);
  if (
    !v ||
    v.network !== p.network ||
    v.genesis !== MAINNET ||
    (!currentModel&&v.universeComplete !== true) ||
    !Array.isArray(v.identities) ||
    new Set(v.identities).size < 2 ||
    !Array.isArray(v.evidenceHashes) ||
    !v.evidenceHashes.length ||
    v.evidenceHashes.some((h) => !/^[a-f0-9]{64}$/.test(h))
  )
    fail('PROVIDER_ACCEPTANCE_INVALID');
  if (
    ![u.coveredFrom, u.coveredThrough, v.coveredFrom, v.coveredThrough].every((t) =>
      Number.isFinite(Date.parse(t)),
    )
  )
    fail('SOURCE_CUTOFF_COVERAGE_MISSING');
  for (const h of p.hours)
    if (
      Date.parse(u.coveredFrom) > Date.parse(h.startsAt) ||
      Date.parse(u.coveredThrough) < Date.parse(h.endsAt) ||
      Date.parse(v.coveredFrom) > Date.parse(h.startsAt) ||
      Date.parse(v.coveredThrough) < Date.parse(h.endsAt) ||
      (!currentModel&&(!h.preCutoffCaptureHash || !v.evidenceHashes.includes(h.preCutoffCaptureHash)))
    )
      fail('SOURCE_CUTOFF_COVERAGE_MISSING');
  if (
    p.funding?.historyComplete !== true ||
    p.funding.openingBalanceLamports !== '0' ||
    !Array.isArray(p.funding.historySignatures) ||
    !Array.isArray(p.funding.receipts) ||
    !/^[a-f0-9]{64}$/.test(p.funding.evidenceHash ?? '') ||
    !p.funding.receipts.length
  )
    fail('FUNDING_ACCEPTANCE_INCOMPLETE');
  amount(p.funding.throughSlot);
  amount(p.funding.openingSlot);
  return { ...p, acceptanceHash: digest };
}
function exact(n) {
  if (!Number.isSafeInteger(n) || n < 0) fail('RPC_AMOUNT_UNSAFE');
  return BigInt(n);
}
export class MainnetPayoutRpc {
  constructor(rpc, beforeSend = async () => {}) {
    this.rpc = rpc;
    this.beforeSend = beforeSend;
  }
  async assertNetwork(n) {
    if (n !== 'mainnet-beta' || (await this.rpc('getGenesisHash')) !== MAINNET)
      fail('NETWORK_MISMATCH');
  }
  async getBalance(address) {
    const a = await this.rpc('getMultipleAccounts', [
      [address],
      { encoding: 'base64', commitment: 'finalized' },
    ]);
    const x = a.value?.[0];
    if (
      !x ||
      x.owner !== SystemProgram.programId.toBase58() ||
      x.executable ||
      Buffer.from(x.data[0], 'base64').length
    )
      fail('TREASURY_ACCOUNT_INVALID');
    return exact(x.lamports);
  }
  async prepareTransaction(treasury, recipients) {
    await this.assertNetwork('mainnet-beta');
    if (!recipients.length || recipients.length > 8) fail('PAYOUT_BATCH_LIMIT');
    const b = await this.rpc('getLatestBlockhash', [{ commitment: 'finalized' }]),
      tx = new Transaction({
        feePayer: new PublicKey(treasury),
        recentBlockhash: b.value.blockhash,
      });
    for (const r of recipients) {
      if (typeof r.lamports !== 'bigint' || r.lamports <= 0n) fail('INVALID_LAMPORTS');
      tx.add(
        SystemProgram.transfer({
          fromPubkey: new PublicKey(treasury),
          toPubkey: new PublicKey(r.destination),
          lamports: r.lamports,
        }),
      );
    }
    const unsignedTransaction = tx.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    });
    const fee = await this.rpc('getFeeForMessage', [
      tx.serializeMessage().toString('base64'),
      { commitment: 'finalized', minContextSlot: b.context.slot },
    ]);
    const simulation = await this.rpc('simulateTransaction', [
      unsignedTransaction.toString('base64'),
      {
        encoding: 'base64',
        sigVerify: false,
        commitment: 'finalized',
        minContextSlot: b.context.slot,
        replaceRecentBlockhash: false,
      },
    ]);
    if (simulation.value?.err || !simulation.value) fail('PAYOUT_SIMULATION_FAILED');
    return {
      unsignedTransaction,
      feeLamports: exact(fee.value),
      recentBlockhash: b.value.blockhash,
      lastValidBlockHeight: exact(b.value.lastValidBlockHeight),
    };
  }
  async sendSignedTransaction(bytes) {
    await this.beforeSend();
    return this.rpc('sendTransaction', [
      Buffer.from(bytes).toString('base64'),
      { encoding: 'base64', skipPreflight: false, maxRetries: 0, preflightCommitment: 'finalized' },
    ]);
  }
  async getBlockHeight() {
    return exact(await this.rpc('getBlockHeight', [{ commitment: 'finalized' }]));
  }
  async getSignatureStatus(signature) {
    const r = (
      await this.rpc('getSignatureStatuses', [[signature], { searchTransactionHistory: true }])
    ).value?.[0];
    return r
      ? { confirmationStatus: r.confirmationStatus, error: r.err, slot: exact(r.slot) }
      : null;
  }
  async transaction(signature) {
    const t = await this.rpc('getTransaction', [
      signature,
      { encoding: 'base64', commitment: 'finalized', maxSupportedTransactionVersion: 0 },
    ]);
    if (!t) return null;
    const tx = Transaction.from(Buffer.from(t.transaction[0], 'base64'));
    if (tx.signature === null || encode58(tx.signature) !== signature || !tx.verifySignatures())
      fail('FINALIZED_TRANSACTION_SIGNATURE_INVALID');
    return { raw: t, tx };
  }
  async getFinalizedTransfers(signature) {
    const result = await this.transaction(signature);
    if (!result) return null;
    const { raw: t, tx } = result;
    const transfers = [];
    if (t.meta.err === null)
      for (const ix of tx.instructions) {
        if (
          !ix.programId.equals(SystemProgram.programId) ||
          SystemInstruction.decodeInstructionType(ix) !== 'Transfer'
        )
          fail('PAYOUT_RECEIPT_INSTRUCTION_INVALID');
        const r = SystemInstruction.decodeTransfer(ix);
        transfers.push({
          source: r.fromPubkey.toBase58(),
          destination: r.toPubkey.toBase58(),
          lamports: BigInt(r.lamports),
        });
      }
    return { error: t.meta.err, slot: exact(t.slot), transfers, feeLamports: exact(t.meta.fee) };
  }
}
export async function verifyTreasuryHistory(rpc, p, expectedPlatform) {
  if ((await rpc('getGenesisHash')) !== MAINNET) fail('NETWORK_MISMATCH');
  const current = await rpc('getMultipleAccounts', [
      [p.wallet],
      { encoding: 'base64', commitment: 'finalized' },
    ]),
    a = current.value?.[0];
  if (
    !a ||
    a.owner !== SystemProgram.programId.toBase58() ||
    a.executable ||
    Buffer.from(a.data[0], 'base64').length
  )
    fail('TREASURY_ACCOUNT_INVALID');
  const finalSlot = exact(current.context.slot),
    through = amount(p.funding.throughSlot);
  if (finalSlot < through) fail('FUNDING_CONTEXT_BEHIND');
  // Traverse to account creation; absence of an archive page is never assumed complete.
  const history = [];
  let before;
  for (let page = 0; page < 100; page++) {
    const rows = await rpc('getSignaturesForAddress', [
      p.wallet,
      { commitment: 'finalized', limit: 1000, ...(before ? { before } : {}) },
    ]);
    if (!Array.isArray(rows)) fail('TREASURY_HISTORY_UNAVAILABLE');
    history.push(...rows.filter((r) => exact(r.slot) <= finalSlot));
    if (rows.length < 1000) {
      before = null;
      break;
    }
    before = rows.at(-1).signature;
  }
  if (before) fail('TREASURY_HISTORY_TRUNCATED');
  if (history.some((r) => exact(r.slot) < amount(p.funding.openingSlot)))
    fail('TREASURY_OPENING_HISTORY_MISMATCH');
  const accepted = new Set(p.funding.historySignatures);
  const observed = history.filter((r) => exact(r.slot) <= through).map((r) => r.signature);
  if (
    accepted.size !== p.funding.historySignatures.length ||
    observed.length !== accepted.size ||
    observed.some((s) => !accepted.has(s))
  )
    fail('TREASURY_ACCEPTED_HISTORY_MISMATCH');
  let balance = 0n;
  const transactions = new Map();
  for (const row of history) {
    const t = await rpc('getTransaction', [
      row.signature,
      { encoding: 'jsonParsed', commitment: 'finalized', maxSupportedTransactionVersion: 0 },
    ]);
    if (
      !t?.meta ||
      t.transaction?.signatures?.[0] !== row.signature ||
      exact(t.slot) !== exact(row.slot)
    )
      fail('TREASURY_HISTORY_UNAVAILABLE');
    const keys = t.transaction.message.accountKeys.map((k) =>
        typeof k === 'string' ? k : k.pubkey,
      ),
      i = keys.indexOf(p.wallet);
    if (i < 0 || !Array.isArray(t.meta.preBalances) || !Array.isArray(t.meta.postBalances))
      fail('TREASURY_HISTORY_INVALID');
    balance += exact(t.meta.postBalances[i]) - exact(t.meta.preBalances[i]);
    transactions.set(row.signature, t);
  }
  if (balance !== exact(a.lamports)) fail('TREASURY_HISTORY_BALANCE_MISMATCH');
  const receipts = [],
    identities = new Set();
  for (const r of p.funding.receipts) {
    if (
      identities.has(r.identity) ||
      !accepted.has(r.signature) ||
      !['CREATOR_FEE', 'NETWORK_FEES'].includes(r.kind)
    )
      fail('TREASURY_RECEIPT_INVALID');
    identities.add(r.identity);
    const t = transactions.get(r.signature);
    if (t?.meta?.err !== null) fail('TREASURY_RECEIPT_FAILED');
    const instructions = [
      ...t.transaction.message.instructions,
      ...(t.meta.innerInstructions ?? []).flatMap((g) => g.instructions),
    ];
    const ix = instructions[r.transferIndex],
      info = ix?.parsed?.info;
    if (
      ix?.program !== 'system' ||
      ix.parsed.type !== 'transfer' ||
      info.destination !== p.wallet ||
      info.source !== r.source ||
      exact(info.lamports) !== amount(r.lamports) ||
      r.identity !== r.signature + ':' + r.transferIndex
    )
      fail('TREASURY_RECEIPT_TRANSFER_MISMATCH');
    const allocations = (r.allocations ?? []).map((x) => ({
      creatorFeeEventId: x.creatorFeeEventId,
      lamports: amount(x.lamports),
    }));
    if (
      r.kind === 'CREATOR_FEE' &&
      (!allocations.length ||
        allocations.reduce((n, x) => n + x.lamports, 0n) !== amount(r.lamports))
    )
      fail('TOKEN_ATTRIBUTION_REQUIRED');
    if (r.kind === 'NETWORK_FEES' && (allocations.length || r.creatorFeeEventId !== null))
      fail('TREASURY_RECEIPT_INVALID');
    receipts.push({
      identity: r.identity,
      kind: r.kind,
      creatorFeeEventId: r.creatorFeeEventId,
      allocations,
      lamports: amount(r.lamports),
      finalizedSlot: exact(t.slot),
      evidenceHash: sha(JSON.stringify(t)),
    });
  }
  const split=await verifyCreatorDistributions(rpc,p.funding,receipts,p.wallet,expectedPlatform);
  return { finalizedSlot: finalSlot, balance, receipts, ...split };
}
