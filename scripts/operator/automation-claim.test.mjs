import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Keypair, Transaction } from '@solana/web3.js';
import { AutomatedClaimAdapter } from './automation-claim.mjs';
import { keyHandle } from './claim-runtime.mjs';
import { sha, MAINNET } from './automation-core.mjs';
async function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'paperfund-auto-claim-test-')),
    key = Keypair.generate(),
    wallet = key.publicKey.toBase58(),
    p = { wallet, mint: Keypair.generate().publicKey.toBase58() },
    calls = [];
  const a = new AutomatedClaimAdapter({
    root,
    openKey: async (expected) => keyHandle(JSON.stringify([...key.secretKey]), expected),
    rpc: async (m, params) => {
      calls.push(m);
      if (m === 'getGenesisHash') return MAINNET;
      if (m === 'getSignatureStatuses')
        return { value: [{ confirmationStatus: 'finalized', err: null, slot: 22 }] };
      if (m === 'getTransaction') {
        const saved = JSON.parse(fs.readFileSync(a.artifact(r), 'utf8')),
          tx = Transaction.from(Buffer.from(saved.signedBase64, 'base64')),
          keys = tx.compileMessage().accountKeys.map((k) => k.toBase58()),
          pre = keys.map(() => 0),
          post = keys.map(() => 0);
        pre[keys.indexOf(wallet)] = 1000000;
        post[keys.indexOf(wallet)] = 1015000;
        pre[keys.indexOf(r.vault)] = 670240;
        post[keys.indexOf(r.vault)] = 650240;
        return {
          version: 'legacy',
          slot: 22,
          transaction: [saved.signedBase64, 'base64'],
          meta: { err: null, fee: 5000, preBalances: pre, postBalances: post },
        };
      }
      throw Error('NO_OTHER_RPC_IN_TEST');
    },
  });
  const tx = await a.transaction(Keypair.generate().publicKey.toBase58(), p),
    r = {
      wallet: p.wallet,
      mint: p.mint,
      vault: tx.instructions[1].keys[2].pubkey.toBase58(),
      unsignedBase64: tx
        .serialize({ requireAllSignatures: false, verifySignatures: false })
        .toString('base64'),
      messageSha256: sha(tx.serializeMessage()),
      blockhash: tx.recentBlockhash,
      principalLamports: '20000',
      maximumFeeLamports: '5000',
      feeLamports: '5000',
      rentLamports: '650240',
      slot: 20,
      lastValidBlockHeight: 100,
    };
  return {
    a,
    p,
    r,
    key,
    calls,
    root,
    cleanup() {
      key.secretKey.fill(0);
      const resolved = path.resolve(root);
      assert(
        resolved.startsWith(path.resolve(os.tmpdir()) + path.sep + 'paperfund-auto-claim-test-'),
      );
      fs.rmSync(resolved, { recursive: true });
    },
  };
}
test('only a disposable key signs the canonical claim; signed artifact precedes submission and recovers across interruption', async () => {
  const f = await fixture();
  try {
    const signed = await f.a.sign(f.r, f.p);
    assert.equal(f.calls.length, 0);
    assert(fs.existsSync(signed.artifact));
    const recovered = await f.a.recoverSigned({ state: 'RESERVED', prepared: f.r });
    assert.equal(recovered.signature, signed.signature);
    const result = await f.a.reconcile({ signature: signed.signature, prepared: f.r });
    assert.equal(result.finalized, true);
    assert.equal(result.success, true);
    assert.equal(result.grossLamports, '20000');
    assert.equal(result.netLamports, '15000');
    assert.equal(result.databaseCredited, false);
    assert.equal(result.capitalClassification, 'CREATOR_AGGREGATE_REVIEW_NO_TOKEN_CREDIT');
    assert(!f.calls.includes('sendTransaction'));
  } finally {
    f.cleanup();
  }
});
test('a tampered signed artifact is rejected before an RPC broadcast', async () => {
  const f = await fixture();
  try {
    const signed = await f.a.sign(f.r, f.p),
      saved = JSON.parse(fs.readFileSync(signed.artifact, 'utf8'));
    saved.signedBase64 = f.r.unsignedBase64;
    fs.writeFileSync(signed.artifact, JSON.stringify(saved));
    await assert.rejects(f.a.submit(signed, f.r, f.p), /SIGNED_ARTIFACT_CHANGED/);
    assert.equal(f.calls.length, 0);
  } finally {
    f.cleanup();
  }
});
test('changed finalized receipt amounts never become verified capital', async () => {
  const f = await fixture();
  try {
    const signed = await f.a.sign(f.r, f.p),
      original = f.a.rpc;
    f.a.rpc = async (m, p) => {
      const result = await original(m, p);
      if (m === 'getTransaction') result.meta.postBalances[0]++;
      return result;
    };
    await assert.rejects(
      f.a.reconcile({ signature: signed.signature, prepared: f.r }),
      /FINALIZED_AMOUNT_REVIEW_REQUIRED/,
    );
  } finally {
    f.cleanup();
  }
});
test('no artifact is conclusively unsubmitted only while still reserved; an existing missing signature stays review', async () => {
  const f = await fixture();
  try {
    assert.equal(
      (await f.a.recoverSigned({ state: 'RESERVED', prepared: f.r })).neverSubmitted,
      true,
    );
    assert.equal(
      (await f.a.recoverSigned({ state: 'REVIEW', prepared: f.r })).neverSubmitted,
      false,
    );
  } finally {
    f.cleanup();
  }
});
