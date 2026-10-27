import { encode58 } from './key-public.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { Transaction, PublicKey, ComputeBudgetProgram } from '@solana/web3.js';
import { keyHandle } from './claim-runtime.mjs';
import { sha, amount, MAINNET, fail } from './automation-core.mjs';
const pump = createRequire(import.meta.url)('@pump-fun/pump-sdk'),
  SYSTEM = '11111111111111111111111111111111';
export function protectedRpc(endpoint) {
  if (new URL(endpoint).protocol !== 'https:') fail('HTTPS_RPC_REQUIRED');
  return async (method, params = []) => {
    if (
      ![
        'getGenesisHash',
        'getSignaturesForAddress',
        'getMultipleAccounts',
        'getMinimumBalanceForRentExemption',
        'getLatestBlockhash',
        'getBlockHeight',
        'getFeeForMessage',
        'simulateTransaction',
        'sendTransaction',
        'getSignatureStatuses',
        'getTransaction',
      ].includes(method)
    )
      fail('RPC_METHOD_FORBIDDEN');
    let result;
    try {
      const r = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: AbortSignal.timeout(15000),
      });
      if (!r.ok) fail('RPC_UNAVAILABLE');
      result = await r.json();
    } catch {
      fail('RPC_UNAVAILABLE');
    }
    if (result.error) fail('RPC_REJECTED');
    return result.result;
  };
}
export class AutomatedClaimAdapter {
  constructor({ rpc, root, openKey }) {
    Object.assign(this, { rpc, root, openKey });
    fs.mkdirSync(root, { recursive: true });
  }
  async transaction(blockhash, p) {
    const ix = await pump.PUMP_SDK.offlinePumpProgram.methods
      .collectCreatorFeeV2()
      .accountsPartial({
        creator: new PublicKey(p.wallet),
        quoteMint: new PublicKey('So11111111111111111111111111111111111111112'),
        quoteTokenProgram: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
      })
      .instruction();
    return new Transaction({ feePayer: new PublicKey(p.wallet), recentBlockhash: blockhash }).add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 50000 }),
      ix,
    );
  }
  async canonical(prepared, p) {
    const tx = Transaction.from(Buffer.from(prepared.unsignedBase64, 'base64')),
      expected = await this.transaction(prepared.blockhash, p);
    if (
      !tx.serializeMessage().equals(expected.serializeMessage()) ||
      sha(tx.serializeMessage()) !== prepared.messageSha256 ||
      tx.signatures.length !== 1 ||
      tx.signatures[0].signature !== null
    )
      fail('CLAIM_MESSAGE_CHANGED');
    return tx;
  }
  async prepare(channel, source, p) {
    if (channel !== 'claims') fail('PAYOUT_ADAPTER_REQUIRED');
    if ((await this.rpc('getGenesisHash')) !== MAINNET) fail('NETWORK_MISMATCH');
    const wallet = new PublicKey(p.wallet),
      mint = new PublicKey(p.mint),
      vault = pump.creatorVaultPda(wallet).toBase58(),
      curve = pump.bondingCurvePda(mint).toBase58();
    const a = await this.rpc('getMultipleAccounts', [
      [curve, pump.feeSharingConfigPda(mint).toBase58(), vault, p.wallet],
      { encoding: 'base64', commitment: 'finalized' },
    ]);
    const [c, sharing, v, w] = a.value ?? [];
    if (!c || c.owner !== pump.PUMP_PROGRAM_ID.toBase58() || sharing) fail('CLAIM_TOPOLOGY_REVIEW');
    const decoded = pump.PUMP_SDK.decodeBondingCurve({
      ...c,
      owner: new PublicKey(c.owner),
      data: Buffer.from(c.data[0], 'base64'),
    });
    if (decoded.complete || decoded.creator.toBase58() !== p.wallet)
      fail('CLAIM_CREATOR_OR_MARKET_MISMATCH');
    if (
      !v ||
      v.owner !== SYSTEM ||
      v.executable ||
      Buffer.from(v.data[0], 'base64').length ||
      !w ||
      w.owner !== SYSTEM ||
      w.executable ||
      ![v.lamports, w.lamports].every(Number.isSafeInteger)
    )
      fail('CLAIM_ACCOUNTS_INVALID');
    const rent = await this.rpc('getMinimumBalanceForRentExemption', [
      0,
      { commitment: 'finalized' },
    ]);
    if (!Number.isSafeInteger(rent)) fail('RENT_UNAVAILABLE');
    const gross = BigInt(v.lamports) - BigInt(rent);
    if (gross <= amount(p.claims.maxFeeLamports) || gross < amount(p.claims.minGrossLamports))
      fail('CLAIM_BELOW_MINIMUM');
    if (BigInt(w.lamports) < amount(p.claims.maxFeeLamports)) fail('PAYER_UNFUNDED');
    const b = await this.rpc('getLatestBlockhash', [
        { commitment: 'finalized', minContextSlot: a.context.slot },
      ]),
      tx = await this.transaction(b.value.blockhash, p),
      unsigned = tx.serialize({ requireAllSignatures: false, verifySignatures: false }),
      fee = await this.rpc('getFeeForMessage', [
        tx.serializeMessage().toString('base64'),
        { commitment: 'finalized', minContextSlot: b.context.slot },
      ]);
    if (
      !Number.isSafeInteger(fee.value) ||
      fee.value < 0 ||
      BigInt(fee.value) > amount(p.claims.maxFeeLamports)
    )
      fail('FEE_LIMIT');
    const prepared = {
      channel,
      network: 'mainnet-beta',
      wallet: p.wallet,
      mint: p.mint,
      vault,
      slot: b.context.slot,
      walletBeforeLamports: String(w.lamports),
      vaultBeforeLamports: String(v.lamports),
      rentLamports: String(rent),
      principalLamports: String(gross),
      maximumFeeLamports: p.claims.maxFeeLamports,
      feeLamports: String(fee.value),
      unsignedBase64: unsigned.toString('base64'),
      messageSha256: sha(tx.serializeMessage()),
      blockhash: b.value.blockhash,
      lastValidBlockHeight: b.value.lastValidBlockHeight,
      expiresAt: new Date(Date.now() + 60000).toISOString(),
      capitalClassification: 'CREATOR_AGGREGATE_REVIEW_NO_TOKEN_CREDIT',
    };
    await this.preflight(prepared, p);
    return prepared;
  }
  async preflight(r, p) {
    const tx = await this.canonical(r, p);
    if (
      Date.now() >= Date.parse(r.expiresAt) ||
      (await this.rpc('getBlockHeight', [{ commitment: 'confirmed' }])) > r.lastValidBlockHeight - 5
    )
      fail('TRANSACTION_EXPIRED_REPREPARE_BEFORE_RESERVATION');
    if ((await this.rpc('getGenesisHash')) !== MAINNET) fail('NETWORK_MISMATCH');
    const current = await this.rpc('getMultipleAccounts', [
      [p.wallet, r.vault],
      { encoding: 'base64', commitment: 'finalized', minContextSlot: r.slot },
    ]);
    const [w, v] = current.value ?? [];
    if (
      !w ||
      !v ||
      w.owner !== SYSTEM ||
      v.owner !== SYSTEM ||
      ![w.lamports, v.lamports].every(Number.isSafeInteger) ||
      String(v.lamports) !== r.vaultBeforeLamports ||
      BigInt(w.lamports) < amount(r.maximumFeeLamports)
    )
      fail('CLAIM_STATE_CHANGED');
    const fee = await this.rpc('getFeeForMessage', [
      tx.serializeMessage().toString('base64'),
      { commitment: 'finalized' },
    ]);
    if (
      !Number.isSafeInteger(fee.value) ||
      fee.value < 0 ||
      String(fee.value) !== r.feeLamports ||
      BigInt(fee.value) > amount(r.maximumFeeLamports)
    )
      fail('FEE_CHANGED');
    const s = await this.rpc('simulateTransaction', [
      r.unsignedBase64,
      {
        encoding: 'base64',
        commitment: 'finalized',
        sigVerify: false,
        replaceRecentBlockhash: false,
        minContextSlot: current.context.slot,
        accounts: { encoding: 'base64', addresses: [p.wallet, r.vault] },
      },
    ]);
    const [wp, vp] = s.value.accounts ?? [];
    if (
      s.value.err !== null ||
      !wp ||
      !vp ||
      ![wp.lamports, vp.lamports].every(Number.isSafeInteger) ||
      String(vp.lamports) !== r.rentLamports ||
      BigInt(wp.lamports) !== BigInt(w.lamports) + amount(r.principalLamports) - BigInt(fee.value)
    )
      fail('CLAIM_SIMULATION_FAILED');
    return s.context.slot;
  }
  artifact(r) {
    if (!/^[a-f0-9]{64}$/.test(r.messageSha256)) fail('ARTIFACT_PATH_INVALID');
    return path.join(this.root, r.messageSha256 + '.signed.json');
  }
  async sign(r, p, guard = async () => p) {
    await this.canonical(r, p);
    const handle = await this.openKey(p.wallet);
    if (handle.publicKey !== p.wallet) fail('KEY_IDENTITY_MISMATCH');
    if (sha(JSON.stringify(await guard())) !== sha(JSON.stringify(p))) fail('POLICY_CHANGED');
    if (r.expiresAt && Date.now() >= Date.parse(r.expiresAt))
      fail('TRANSACTION_EXPIRED_BEFORE_SIGNING');
    const signed = handle.signTransaction(Buffer.from(r.unsignedBase64, 'base64')),
      tx = Transaction.from(signed.signedTransaction);
    if (
      !tx.verifySignatures() ||
      encode58(tx.signature) !== signed.signature ||
      sha(tx.serializeMessage()) !== r.messageSha256
    )
      fail('SIGNED_MESSAGE_MISMATCH');
    const artifact = this.artifact(r),
      fd = fs.openSync(artifact, 'wx');
    try {
      fs.writeSync(
        fd,
        JSON.stringify({
          signature: signed.signature,
          signedBase64: Buffer.from(signed.signedTransaction).toString('base64'),
          messageSha256: r.messageSha256,
        }),
      );
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    return { signature: signed.signature, artifact };
  }
  async submit(s, r, p, guard = async () => p) {
    await this.canonical(r, p);
    const saved = JSON.parse(fs.readFileSync(this.artifact(r), 'utf8'));
    const tx = Transaction.from(Buffer.from(saved.signedBase64, 'base64'));
    if (
      saved.signature !== s.signature ||
      saved.messageSha256 !== r.messageSha256 ||
      !tx.verifySignatures() ||
      encode58(tx.signature) !== s.signature ||
      sha(tx.serializeMessage()) !== r.messageSha256
    )
      fail('SIGNED_ARTIFACT_CHANGED');
    if (sha(JSON.stringify(await guard())) !== sha(JSON.stringify(p))) fail('POLICY_CHANGED');
    return this.rpc('sendTransaction', [
      saved.signedBase64,
      {
        encoding: 'base64',
        skipPreflight: false,
        preflightCommitment: 'finalized',
        maxRetries: 0,
        minContextSlot: r.slot,
      },
    ]);
  }
  async recoverSigned(job) {
    const artifact = this.artifact(job.prepared);
    if (!fs.existsSync(artifact)) return { neverSubmitted: job.state === 'RESERVED' };
    const saved = JSON.parse(fs.readFileSync(artifact, 'utf8'));
    const tx = Transaction.from(Buffer.from(saved.signedBase64, 'base64'));
    if (
      !tx.verifySignatures() ||
      encode58(tx.signature) !== saved.signature ||
      sha(tx.serializeMessage()) !== job.prepared.messageSha256
    )
      fail('SIGNED_ARTIFACT_CHANGED');
    return { signature: saved.signature, artifact };
  }
  async reconcile(job) {
    const r = job.prepared;
    if ((await this.rpc('getGenesisHash')) !== MAINNET) fail('NETWORK_MISMATCH');
    const status = (
      await this.rpc('getSignatureStatuses', [[job.signature], { searchTransactionHistory: true }])
    ).value?.[0];
    if (!status)
      return {
        finalized: false,
        expiredAbsent:
          (await this.rpc('getBlockHeight', [{ commitment: 'confirmed' }])) >
          r.lastValidBlockHeight,
      };
    if (status.confirmationStatus !== 'finalized') return { finalized: false };
    const result = await this.rpc('getTransaction', [
      job.signature,
      { encoding: 'base64', commitment: 'finalized', maxSupportedTransactionVersion: 0 },
    ]);
    if (!result) return { finalized: false };
    if (result.version !== undefined && result.version !== 'legacy')
      fail('FINALIZED_VERSION_INVALID');
    const tx = Transaction.from(Buffer.from(result.transaction[0], 'base64')),
      meta = result.meta,
      keys = tx.compileMessage().accountKeys.map((k) => k.toBase58());
    if (
      !tx.verifySignatures() ||
      encode58(tx.signature) !== job.signature ||
      sha(tx.serializeMessage()) !== r.messageSha256 ||
      result.slot !== status.slot ||
      !meta ||
      ![...meta.preBalances, ...meta.postBalances, meta.fee].every(Number.isSafeInteger)
    )
      fail('FINALIZED_MESSAGE_OR_BALANCES_INVALID');
    const wi = keys.indexOf(r.wallet),
      vi = keys.indexOf(r.vault);
    if (wi < 0 || vi < 0 || BigInt(meta.fee) > amount(r.maximumFeeLamports))
      fail('FINALIZED_FEE_OR_ACCOUNTS_INVALID');
    if (meta.err || status.err)
      return {
        finalized: true,
        success: false,
        signature: job.signature,
        slot: result.slot,
        feeLamports: String(meta.fee),
      };
    const gross = BigInt(meta.preBalances[vi]) - BigInt(meta.postBalances[vi]),
      net = BigInt(meta.postBalances[wi]) - BigInt(meta.preBalances[wi]);
    if (
      gross !== amount(r.principalLamports) ||
      net !== gross - BigInt(meta.fee) ||
      BigInt(meta.postBalances[vi]) !== amount(r.rentLamports)
    )
      fail('FINALIZED_AMOUNT_REVIEW_REQUIRED');
    return {
      finalized: true,
      success: true,
      signature: job.signature,
      slot: result.slot,
      grossLamports: String(gross),
      feeLamports: String(meta.fee),
      netLamports: String(net),
      walletPostLamports: String(meta.postBalances[wi]),
      vaultPostLamports: String(meta.postBalances[vi]),
      capitalClassification: 'CREATOR_AGGREGATE_REVIEW_NO_TOKEN_CREDIT',
      databaseCredited: false,
    };
  }
}
