import { createRequire } from 'node:module';
import { PublicKey } from '@solana/web3.js';
import { readonlyRpc } from './discovery.mjs';
import { MINT, GENESIS, WALLET, saveEvidence } from './common.mjs';
const pump = createRequire(import.meta.url)('@pump-fun/pump-sdk');
export async function inspectCreatorAuthority(rpc, mint = MINT, newWallet = null) {
  if (newWallet) new PublicKey(newWallet);
  if ((await rpc('getGenesisHash')) !== GENESIS) throw Error('MAINNET_GENESIS_MISMATCH');
  const m = new PublicKey(mint),
    keys = [
      pump.bondingCurvePda(m),
      pump.feeSharingConfigPda(m),
      pump.GLOBAL_PDA,
      pump.canonicalPumpPoolPda(m),
    ];
  const batch = await rpc('getMultipleAccounts', [
    keys.map((k) => k.toBase58()),
    { encoding: 'base64', commitment: 'finalized' },
  ]);
  const decode = (a, owner, fn) => {
    if (!a || a.owner !== owner.toBase58() || a.executable)
      throw Error('AUTHORITY_ACCOUNT_INVALID');
    return fn({ ...a, data: Buffer.from(a.data[0], 'base64') });
  };
  const curve = decode(batch.value[0], pump.PUMP_PROGRAM_ID, (a) =>
    pump.PUMP_SDK.decodeBondingCurve(a),
  );
  const global = decode(batch.value[2], pump.PUMP_PROGRAM_ID, (a) => pump.PUMP_SDK.decodeGlobal(a));
  const sharing = batch.value[1]
    ? decode(batch.value[1], pump.PUMP_FEE_PROGRAM_ID, (a) => pump.PUMP_SDK.decodeSharingConfig(a))
    : null;
  const creator = curve.creator.toBase58(),
    oldVault = pump.creatorVaultPda(new PublicKey(WALLET)).toBase58();
  const vaults = [oldVault, pump.creatorVaultPda(curve.creator).toBase58()];
  const result = await rpc('getMultipleAccounts', [
    vaults,
    { encoding: 'base64', commitment: 'finalized', minContextSlot: batch.context.slot },
  ]);
  return {
    at: new Date().toISOString(),
    network: 'mainnet-beta',
    genesis: GENESIS,
    commitment: 'finalized',
    slot: batch.context.slot,
    mint,
    curve: keys[0].toBase58(),
    creator,
    claimAuthority: sharing ? 'SHARING_CONFIG_SHAREHOLDERS' : creator,
    sharingConfig: sharing
      ? {
          address: keys[1].toBase58(),
          admin: sharing.admin?.toBase58(),
          adminRevoked: sharing.adminRevoked,
          shareholders: sharing.shareholders.map((s) => ({
            address: s.address.toBase58(),
            shareBps: s.shareBps,
          })),
        }
      : null,
    graduated: !!curve.complete,
    canonicalPoolExists: !!batch.value[3],
    protocolSetCreatorAuthority: global.setCreatorAuthority.toBase58(),
    protocolAdminSetCreatorAuthority: global.adminSetCreatorAuthority.toBase58(),
    oldVault,
    oldVaultLamports: result.value[0] ? String(result.value[0].lamports) : '0',
    currentCreatorVault: vaults[1],
    currentCreatorVaultLamports: result.value[1] ? String(result.value[1].lamports) : '0',
    freshWallet: newWallet,
    freshWalletMatchesDirectCreator: newWallet === creator && !sharing,
    directRotation: {
      requiresProtocolSetCreatorAuthority: true,
      selfServiceWalletTransfer: false,
      existingFees:
        'A creator-field change does not transfer old creator-vault balances. The old creator key remains required for its old vault. Obtain a separately approved controlled recovery before retiring that key.',
    },
    sharingAlternative: {
      separateReviewRequired: true,
      changesClaimInstruction: true,
      irreversibleFinalShares: true,
      pendingFees:
        'Do not assume old aggregate vault fees migrate. Review the exact create/update/distribution instructions and destination deltas before any approval.',
    },
    financialAuthority: 'NONE',
    signed: false,
    broadcast: false,
  };
}
if (process.argv[1]?.endsWith('inspect-creator-authority.mjs')) {
  const { rpc, captures } = await readonlyRpc(),
    r = await inspectCreatorAuthority(rpc, MINT, process.argv[2] ?? null),
    e = await saveEvidence('creator-authority-onboarding', { ...r, captures });
  console.log(JSON.stringify({ ...r, evidence: e }, null, 2));
}
