import { createRequire } from 'node:module';
import bs58 from 'bs58';
import { WALLET, uint, hash, json } from './common.mjs';
const p = createRequire(import.meta.url)('@pump-fun/pump-sdk');
const program = p.PUMP_PROGRAM_ID.toBase58();
const idl = p.PUMP_SDK.offlinePumpProgram.idl;
const claimDefs = idl.instructions.filter((i) =>
  ['collectCreatorFee', 'collectCreatorFeeV2'].includes(i.name),
);
export function identifyClaimReceipt(signature, tx, status, vault) {
  // Version-1 semantics are not qualified to credit funding.
  if (tx?.version !== undefined && !['legacy', 0].includes(tx.version)) return null;
  if (
    !tx ||
    tx.meta?.err !== null ||
    status?.confirmationStatus !== 'finalized' ||
    status.err !== null ||
    status.slot !== tx.slot
  )
    return null;
  const keys = [
    ...tx.transaction.message.accountKeys,
    ...(tx.meta.loadedAddresses?.writable ?? []),
    ...(tx.meta.loadedAddresses?.readonly ?? []),
  ];
  if (keys.some((k) => typeof k !== 'string')) throw Error('UNSUPPORTED_TRANSACTION_ENCODING');
  const outer = tx.transaction.message.instructions;
  let claim = null;
  for (const [index, ix] of outer.entries()) {
    const pid = keys[ix.programIdIndex];
    if (pid === 'ComputeBudget111111111111111111111111111111') continue;
    if (pid !== program) return null; // Complex mixed transactions require independent review.
    const data = Buffer.from(bs58.decode(ix.data));
    const definition = claimDefs.find((d) => data.equals(Buffer.from(d.discriminator)));
    if (!definition || claim) return null;
    if (definition.name === 'collectCreatorFeeV2') {
      const qi = definition.accounts.findIndex((a) => a.name === 'quoteMint'),
        ti = definition.accounts.findIndex((a) => a.name === 'quoteTokenProgram');
      if (
        keys[ix.accounts[qi]] !== 'So11111111111111111111111111111111111111112' ||
        keys[ix.accounts[ti]] !== 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
      )
        return null;
    }
    const ci = definition.accounts.findIndex((a) => a.name === 'creator'),
      vi = definition.accounts.findIndex((a) => a.name === 'creatorVault');
    if (keys[ix.accounts[ci]] !== WALLET || keys[ix.accounts[vi]] !== vault) return null;
    claim = { index, name: definition.name };
  }
  if (!claim) return null;
  const wi = keys.indexOf(WALLET),
    vi = keys.indexOf(vault);
  if (wi < 0 || vi < 0) return null;
  const vaultDebit = uint(tx.meta.preBalances[vi]) - uint(tx.meta.postBalances[vi]);
  const walletCredit =
    uint(tx.meta.postBalances[wi]) -
    uint(tx.meta.preBalances[wi]) +
    (wi === 0 ? uint(tx.meta.fee) : 0n);
  if (vaultDebit <= 0n || walletCredit !== vaultDebit) throw Error('CLAIM_BALANCE_RECONCILIATION');
  // Require an authentic Pump log invocation and matching official event, not arbitrary program data.
  const stack = [];
  let matched = 0;
  for (const log of tx.meta.logMessages ?? []) {
    const invoke = /^Program (\w+) invoke \[\d+\]$/.exec(log);
    if (invoke) {
      stack.push(invoke[1]);
      continue;
    }
    if (/^Program \w+ (success|failed:)/.test(log)) {
      stack.pop();
      continue;
    }
    if (stack.at(-1) !== program || !log.startsWith('Program data: ')) continue;
    let event;
    try {
      event = p.PUMP_SDK.offlinePumpProgram.coder.events.decode(log.slice(14));
    } catch {
      continue;
    }
    if (
      event?.name === 'collectCreatorFeeEvent' &&
      event.data.creator.toBase58() === WALLET &&
      // Pump's native-SOL collection event uses the default pubkey even though
      // collectCreatorFeeV2 takes the wrapped-SOL mint. The instruction above
      // independently pins WSOL/token program, creator and vault; exact balance
      // conservation below/above remains mandatory. Never count this as earnings.
      ['So11111111111111111111111111111111111111112',
        ...(claim.name === 'collectCreatorFeeV2' ? ['11111111111111111111111111111111'] : [])
      ].includes(event.data.quoteMint?.toBase58()) &&
      event.data.creatorFee.toString() === vaultDebit.toString()
    )
      matched++;
  }
  if (matched !== 1) throw Error('CLAIM_EVENT_RECONCILIATION');
  return {
    identity: signature + ':outer:' + claim.index,
    signature,
    instruction: claim.name,
    network: 'mainnet-beta',
    treasury: WALLET,
    lamports: vaultDebit.toString(),
    finalizedSlot: String(tx.slot),
    evidenceHash: hash(json({ signature, tx, status })),
    classification: 'FINALIZED_CREATOR_AGGREGATE_RECEIPT_TOKEN_ATTRIBUTION_REQUIRES_REVIEW',
  };
}
export async function observeReceipts(rpc, vault) {
  const histories = await Promise.all(
    [WALLET, vault].map((address) =>
      rpc('getSignaturesForAddress', [address, { limit: 100, commitment: 'finalized' }]),
    ),
  );
  const complete = histories.every((h) => Array.isArray(h) && h.length < 100);
  const signatures = [...new Set(histories.flat().map((h) => h.signature))];
  const receipts = [],
    unrelated = [];
  for (const signature of signatures) {
    const tx = await rpc('getTransaction', [
      signature,
      { encoding: 'json', commitment: 'finalized', maxSupportedTransactionVersion: 1 },
    ]);
    const statuses = await rpc('getSignatureStatuses', [
      [signature],
      { searchTransactionHistory: true },
    ]);
    if (!tx || !statuses?.value?.[0]) throw Error('RECEIPT_HISTORY_UNAVAILABLE');
    const receipt = identifyClaimReceipt(signature, tx, statuses.value[0], vault);
    if (receipt) receipts.push(receipt);
    else
      unrelated.push({
        signature,
        classification:
          tx.version === 1
            ? 'VERSION_1_REQUIRES_REVIEW_NO_FUNDING_CREDIT'
            : 'NOT_A_SIMPLE_VERIFIED_CREATOR_CLAIM',
      });
  }
  return {
    historyCoverage: complete
      ? 'RPC_REPORTED_EXHAUSTED_NOT_PROVIDER_QUALIFIED'
      : 'INCOMPLETE_REVIEW',
    receipts,
    unrelated,
    recognizedCreatorAggregateReceivedLamports: receipts
      .reduce((n, r) => n + BigInt(r.lamports), 0n)
      .toString(),
    tokenAttributedPayoutCapitalLamports: '0',
    fundingState: 'REVIEW',
    reason: 'TOKEN_EVENT_RECEIPT_PARTITION_AND_QUALIFIED_PROVIDER_REQUIRED',
  };
}
