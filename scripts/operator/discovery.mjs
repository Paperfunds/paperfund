import { observeReceipts } from './receipts.mjs';
import { publicError } from './errors.mjs';
import { createRequire } from 'node:module';
import { PublicKey } from '@solana/web3.js';
import { MINT, WALLET, GENESIS, readSetting, hash, uint, saveEvidence } from './common.mjs';
const require = createRequire(import.meta.url),
  p = require('@pump-fun/pump-sdk'),
  s = require('@pump-fun/pump-swap-sdk'),
  BN = require('bn.js');
export const READ_METHODS = new Set([
  'getGenesisHash',
  'getMultipleAccounts',
  'getMinimumBalanceForRentExemption',
  'getSignaturesForAddress',
  'getTransaction',
  'getSignatureStatuses',
]);
export async function readonlyRpc(extraMethods = []) {
  if(extraMethods.some(m=>!['getLatestBlockhash','getBlockHeight','getFeeForMessage','simulateTransaction'].includes(m)))throw Error('RPC_METHOD_FORBIDDEN');
  const permitted=new Set([...READ_METHODS,...extraMethods]);
  const endpoint = (await readSetting('SOLANA_RPC_URL')) || 'https://api.mainnet-beta.solana.com';
  if (new URL(endpoint).protocol !== 'https:') throw Error('HTTPS_RPC_REQUIRED');
  const captures = [];
  let id = 0;
  async function attempt(method, params = []) {
    if (!permitted.has(method)) throw Error('RPC_METHOD_FORBIDDEN');
    const request = { jsonrpc: '2.0', id: ++id, method, params },
      requestedAt = new Date().toISOString();
    let response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw Error('RPC_UNAVAILABLE');
    }
    const raw = await response.text();
    captures.push({
      request,
      requestedAt,
      receivedAt: new Date().toISOString(),
      http: response.status,
      raw,
      sha256: hash(raw),
    });
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      throw Error('RPC_INVALID_RESPONSE');
    }
    if (!response.ok || body.error) {
      const code = Number.isInteger(body.error?.code) ? body.error.code : 0;
      throw Error('RPC_REJECTED:' + method + ':HTTP_' + response.status + ':CODE_' + code);
    }
    return body.result;
  }
  async function rpc(method, params = []) {
    for (let n = 0; ; n++) {
      try {
        return await attempt(method, params);
      } catch (e) {
        if (n >= (/CODE_-32016/.test(e.message)?4:2) || !/RPC_UNAVAILABLE|HTTP_(429|5\d\d)|CODE_-3200[459]|CODE_-32016/.test(e.message)) throw e;
        await new Promise((ok) => setTimeout(ok, 500 * 2 ** n));
      }
    }
  }
  return { rpc, captures };
}
function decode(a, owner, fn) {
  if (!a) return null;
  if (a.owner !== owner.toBase58() || a.executable) throw Error('ACCOUNT_OWNER_MISMATCH');
  return fn({ ...a, owner: new PublicKey(a.owner), data: Buffer.from(a.data[0], 'base64') });
}
export async function discover(rpc) {
  if ((await rpc('getGenesisHash')) !== GENESIS) throw Error('MAINNET_GENESIS_MISMATCH');
  const mint = new PublicKey(MINT),
    wallet = new PublicKey(WALLET);
  const keys = [
    mint,
    p.bondingCurvePda(mint),
    p.feeSharingConfigPda(mint),
    p.canonicalPumpPoolPda(mint),
    p.GLOBAL_PDA,
    p.PUMP_FEE_CONFIG_PDA,
    wallet,
  ];
  const batch = await rpc('getMultipleAccounts', [
    keys.map((k) => k.toBase58()),
    { encoding: 'base64', commitment: 'finalized' },
  ]);
  if (batch.value?.length !== keys.length || !Number.isSafeInteger(batch.context?.slot))
    throw Error('ACCOUNT_BATCH_INVALID');
  const [ma, ca, sharing, pa, ga, fa, wa] = batch.value;
  if (
    !ma ||
    ![
      'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
      'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
    ].includes(ma.owner)
  )
    throw Error('MINT_OWNER');
  const curve = decode(ca, p.PUMP_PROGRAM_ID, (a) => p.PUMP_SDK.decodeBondingCurve(a));
  if (!curve || !curve.creator.equals(wallet)) throw Error('CREATOR_AUTHORITY_MISMATCH');
  const global = decode(ga, p.PUMP_PROGRAM_ID, (a) => p.PUMP_SDK.decodeGlobal(a));
  const fee = decode(fa, p.PUMP_FEE_PROGRAM_ID, (a) => p.PUMP_SDK.decodeFeeConfig(a));
  const pool = decode(pa, p.PUMP_AMM_PROGRAM_ID, (a) => s.PUMP_AMM_SDK.decodePool(a));
  if (sharing) decode(sharing, p.PUMP_FEE_PROGRAM_ID, (a) => p.PUMP_SDK.decodeSharingConfig(a));
  const vault = p.creatorVaultPda(wallet),
    authority = s.coinCreatorVaultAuthorityPda(wallet);
  const wsol = new PublicKey('So11111111111111111111111111111111111111112'),
    token = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
    ata = s.coinCreatorVaultAtaPda(authority, wsol, token);
  const vb = await rpc('getMultipleAccounts', [
    [vault.toBase58(), ata.toBase58()],
    { encoding: 'base64', commitment: 'finalized', minContextSlot: batch.context.slot },
  ]);
  if (
    vb.value?.length !== 2 ||
    !Number.isSafeInteger(vb.context?.slot) ||
    vb.context.slot < batch.context.slot
  )
    throw Error('VAULT_BATCH_INVALID');
  const [v, a] = vb.value;
  if (
    v &&
    (v.owner !== '11111111111111111111111111111111' ||
      v.executable ||
      Buffer.from(v.data[0], 'base64').length !== 0)
  )
    throw Error('VAULT_OWNER');
  const rent = uint(
      await rpc('getMinimumBalanceForRentExemption', [0, { commitment: 'finalized' }]),
    ),
    balance = uint(v?.lamports ?? 0);
  let amm = 0n;
  if (a) {
    const data = Buffer.from(a.data[0], 'base64');
    if (
      a.owner !== token.toBase58() ||
      a.executable ||
      data.length < 165 ||
      !data.subarray(0, 32).equals(wsol.toBuffer()) ||
      !data.subarray(32, 64).equals(authority.toBuffer())
    )
      throw Error('AMM_VAULT_OWNER');
    amm = data.readBigUInt64LE(64);
  }
  const rates = p.computeFeesBps({
    global,
    feeConfig: fee,
    mintSupply: new BN(Buffer.from(ma.data[0], 'base64').readBigUInt64LE(36).toString()),
    virtualQuoteReserves: curve.virtualQuoteReserves,
    virtualTokenReserves: curve.virtualTokenReserves,
    quoteMint: curve.quoteMint,
    creatorFeeBps: curve.creatorFeeBps,
  });
  return {
    observedAt: new Date().toISOString(),
    network: 'mainnet-beta',
    genesis: GENESIS,
    commitment: 'finalized',
    slot: batch.context.slot,
    vaultSlot: vb.context.slot,
    mint: MINT,
    creator: WALLET,
    selectedTreasury: WALLET,
    authorityMatches: true,
    market: curve.complete ? 'MIGRATED' : 'ACTIVE_PUMP_CURVE',
    curve: keys[1].toBase58(),
    sharingExists: !!sharing,
    canonicalPumpSwapExists: !!pool,
    vault: vault.toBase58(),
    ammVault: ata.toBase58(),
    vaultLamports: balance.toString(),
    rentLamports: rent.toString(),
    claimableBondingExcessLamports: (balance > rent ? balance - rent : 0n).toString(),
    claimableAmmWsolLamports: amm.toString(),
    walletBalanceLamports: uint(wa?.lamports ?? 0).toString(),
    creatorFeeBps: rates.creatorFeeBps.toString(),
    protocolFeeBps: rates.protocolFeeBps.toString(),
    scope: 'CREATOR_AGGREGATE_VAULT_NOT_TOKEN_SPECIFIC_RECEIVED_CAPITAL',
    providerQualification: 'UNQUALIFIED',
    claimReady: false,
  };
}
export async function prepareClaim(d) {
  if (
    !d.authorityMatches ||
    d.sharingExists ||
    d.market !== 'ACTIVE_PUMP_CURVE' ||
    d.claimableAmmWsolLamports !== '0'
  )
    throw Error('CLAIM_TOPOLOGY_REVIEW');
  const ix = await p.PUMP_SDK.offlinePumpProgram.methods
    .collectCreatorFeeV2()
    .accountsPartial({
      creator: new PublicKey(WALLET),
      quoteMint: new PublicKey('So11111111111111111111111111111111111111112'),
      quoteTokenProgram: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
      creatorVault: p.creatorVaultPda(new PublicKey(WALLET)),
    })
    .instruction();
  const ixs = Array.isArray(ix) ? ix : [ix];
  return {
    type: 'UNSIGNED_MAINNET_CLAIM_REVIEW_ONLY',
    signer: WALLET,
    recipient: WALLET,
    network: 'mainnet-beta',
    mint: MINT,
    expectedMaximumLamports: d.claimableBondingExcessLamports,
    discoveryHash: hash(JSON.stringify(d)),
    instructions: ixs.map((i) => ({
      programId: i.programId.toBase58(),
      keys: i.keys.map((k) => ({
        address: k.pubkey.toBase58(),
        signer: k.isSigner,
        writable: k.isWritable,
      })),
      dataBase64: i.data.toString('base64'),
    })),
    authorization: 'NONE',
    broadcast: 'DISABLED',
  };
}
export async function captureDiscovery() {
  const { rpc, captures } = await readonlyRpc();
  try {
    const d = await discover(rpc);
    let received;
    try {
      received = await observeReceipts(rpc, d.vault);
    } catch (e) {
      received = {
        historyCoverage: 'UNAVAILABLE',
        recognizedCreatorAggregateReceivedLamports: null,
        tokenAttributedPayoutCapitalLamports: '0',
        fundingState: 'REVIEW',
        error: publicError(e),
      };
    }
    return {
      ...d,
      received,
      evidence: await saveEvidence('mainnet-discovery', { discovery: d, received, captures }),
    };
  } catch (e) {
    await saveEvidence('mainnet-discovery-failed', {
      checkedAt: new Date().toISOString(),
      error: publicError(e),
      captures,
    });
    throw e;
  }
}
