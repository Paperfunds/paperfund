import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { operatorServer, allowedRequest } from './server.mjs';
import { discover, prepareClaim, READ_METHODS } from './discovery.mjs';
import { derivePublic, encode58 } from './key-public.mjs';
import { identifyClaimReceipt } from './receipts.mjs';
import { uint, GENESIS, WALLET, ROOT } from './common.mjs';
import { generateKeyPairSync } from 'node:crypto';
const require = createRequire(import.meta.url),
  p = require('@pump-fun/pump-sdk');
test('unsafe RPC integers and every signing/broadcast RPC are excluded', () => {
  assert.throws(() => uint(Number.MAX_SAFE_INTEGER + 1));
  for (const m of ['sendTransaction', 'requestAirdrop', 'simulateTransaction'])
    assert.equal(READ_METHODS.has(m), false);
});
test('wallet import derives Ed25519 address and rejects forged public half without emitting secrets', () => {
  const key = generateKeyPairSync('ed25519'),
    seed = key.privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(-32),
    pub = key.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  const bytes = Buffer.concat([seed, pub]);
  assert.equal(derivePublic(JSON.stringify([...bytes])), encode58(pub));
  assert.equal(derivePublic(encode58(bytes)), encode58(pub));
  bytes[63] ^= 1;
  assert.throws(() => derivePublic(JSON.stringify([...bytes])), /KEY_EMBEDDED_PUBLIC_KEY_INCONSISTENT/);
  bytes.fill(0);
});
test('wrong genesis and invalid authority fail discovery before preparation', async () => {
  await assert.rejects(
    discover(async () => 'wrong'),
    /MAINNET_GENESIS_MISMATCH/,
  );
});
test('current archived account bytes reproduce rent-excluded claimable value and authority', async () => {
  const { readdir } = await import('node:fs/promises');
  const files = (await readdir(ROOT + '/artifacts/operator'))
    .filter((f) => f.startsWith('mainnet-discovery-') && !f.includes('failed'))
    .sort();
  const archive = JSON.parse(await readFile(ROOT + '/artifacts/operator/' + files[0], 'utf8'));
  let index = 0;
  const d = await discover(async (method) => {
    const c = archive.captures[index++];
    assert.equal(c.request.method, method);
    return JSON.parse(c.raw).result;
  });
  assert.equal(d.genesis, GENESIS);
  assert.equal(d.creator, WALLET);
  assert.equal(d.claimableBondingExcessLamports, '1');
  assert.equal(d.walletBalanceLamports, '0');
  let replayIndex = 0;
  await assert.rejects(
    discover(async (method) => {
      const c = archive.captures[replayIndex++];
      assert.equal(c.request.method, method);
      const r = JSON.parse(c.raw).result;
      if (method === 'getMultipleAccounts' && r.value.length === 7) {
        const bytes = Buffer.from(r.value[1].data[0], 'base64');
        const pub = new (require('@solana/web3.js').PublicKey)(WALLET).toBuffer();
        const offset = bytes.indexOf(pub);
        assert.ok(offset >= 0);
        bytes[offset] ^= 1;
        r.value[1].data[0] = bytes.toString('base64');
      }
      return r;
    }),
    /CREATOR_AUTHORITY_MISMATCH/,
  );

  const plan = await prepareClaim(d);
  assert.equal(plan.authorization, 'NONE');
  assert.equal(plan.recipient, WALLET);
  assert.equal(plan.instructions.length, 1);
  assert.equal(plan.broadcast, 'DISABLED');
  await assert.rejects(prepareClaim({ ...d, sharingExists: true }), /CLAIM_TOPOLOGY_REVIEW/);
});
test('simple finalized receipt requires official claim event, matching vault debit and exact wallet credit', () => {
  const vault = '3swpgMo1CEeBvkfZMniPceRk1Km398SqjabJ7y1TAAF5',
    program = p.PUMP_PROGRAM_ID.toBase58();
  const bs58 = require('bs58').default;
  const coder = p.PUMP_SDK.offlinePumpProgram.coder;
  const eventDef = p.PUMP_SDK.offlinePumpProgram.idl.events.find(
    (e) => e.name === 'collectCreatorFeeEvent',
  );
  const data = Buffer.concat([
    Buffer.from(eventDef.discriminator),
    Buffer.alloc(8),
    require('@solana/web3.js').PublicKey.prototype.toBuffer.call(
      new (require('@solana/web3.js').PublicKey)(WALLET),
    ),
    Buffer.alloc(8),
    new (require('@solana/web3.js').PublicKey)(
      'So11111111111111111111111111111111111111112',
    ).toBuffer(),
  ]);
  data.writeBigUInt64LE(25n, 48);
  assert.equal(coder.events.decode(data.toString('base64')).data.creatorFee.toString(), '25');
  const tx = {
    slot: 9,
    transaction: {
      message: {
        accountKeys: ['payer', WALLET, vault, program],
        instructions: [
          {
            programIdIndex: 3,
            accounts: [1, 2],
            data: bs58.encode(Buffer.from([20, 22, 86, 123, 198, 28, 219, 132])),
          },
        ],
      },
    },
    meta: {
      err: null,
      fee: 5,
      preBalances: [100, 10, 1000, 0],
      postBalances: [95, 35, 975, 0],
      logMessages: [
        'Program ' + program + ' invoke [1]',
        'Program data: ' + data.toString('base64'),
        'Program ' + program + ' success',
      ],
    },
  };
  const status = { confirmationStatus: 'finalized', err: null, slot: 9 };
  assert.equal(identifyClaimReceipt('fixture', tx, status, vault).lamports, '25');
  assert.equal(
    identifyClaimReceipt('fixture', tx, { ...status, confirmationStatus: 'confirmed' }, vault),
    null,
  );
  tx.meta.postBalances[1] = 36;
  assert.throws(() => identifyClaimReceipt('fixture', tx, status, vault), /CLAIM_BALANCE/);
});
test('forwarded, remote, DNS-rebinding and cross-origin requests fail the direct-loopback guard', () => {
  const base = { socket: { remoteAddress: '127.0.0.1' }, headers: { host: '127.0.0.1:3189' } };
  assert.equal(allowedRequest(base, 3189), true);
  for (const headers of [
    { host: 'evil.test:3189' },
    { origin: 'https://app.paperfund.app' },
    { forwarded: 'for=127.0.0.1' },
    { 'cf-connecting-ip': '127.0.0.1' },
    { 'sec-fetch-site': 'cross-site' },
  ])
    assert.equal(
      allowedRequest({ ...base, headers: { ...base.headers, ...headers } }, 3189),
      false,
    );
  assert.equal(allowedRequest({ ...base, socket: { remoteAddress: '192.168.1.2' } }, 3189), false);
});
test('HTTP session authenticates read/review while every local financial action remains blocked', async () => {
  let reads = 0;
  const { server } = operatorServer({
    port: 3189,
    token: 'a'.repeat(64),
    status: async () => ({ healthy: true, reads: ++reads }),
    review: async () => ({ recipient: WALLET, lamports: '7' }),
  });
  await new Promise((ok) => server.listen(3189, '127.0.0.1', ok));
  const base = 'http://127.0.0.1:3189';
  try {
    assert.equal((await fetch(base + '/api/status')).status, 401);
    assert.equal(
      (
        await fetch(base + '/session', {
          method: 'POST',
          headers: { origin: 'https://evil.test' },
          body: '{}',
        })
      ).status,
      403,
    );
    const r = await fetch(base + '/session', {
      method: 'POST',
      headers: { origin: base, 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'a'.repeat(64) }),
    });
    assert.equal(r.status, 200);
    const cookie = r.headers.get('set-cookie').split(';')[0];
    assert.match(r.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
    const headers = { cookie, origin: base, 'content-type': 'application/json' };
    assert.equal((await fetch(base + '/api/status', { headers })).status, 200);
    for (const action of ['approve', 'sign', 'broadcast', 'release'])
      assert.equal(
        (await fetch(base + '/api/' + action, { method: 'POST', headers, body: '{}' })).status,
        423,
      );
    assert.equal(
      (
        await fetch(base + '/api/status', {
          headers: { ...headers, 'x-forwarded-host': '127.0.0.1' },
        })
      ).status,
      403,
    );
    const html = await fetch(base + '/');
    assert.match(html.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  } finally {
    await new Promise((ok) => server.close(ok));
  }
});
