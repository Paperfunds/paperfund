// Runs only as the dedicated signer. Creates a disposable key; never asks for a user key.
import {
  generateKeyPairSync,
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
  randomBytes,
  createHash,
} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { derivePublic, encode58 } from './key-public.mjs';
const installation = path.dirname(fileURLToPath(import.meta.url));
if (
  installation.toLowerCase() !==
  path.join(process.env.ProgramFiles, 'PaperfundSigner').toLowerCase()
)
  throw Error('PROTECTED_INSTALLATION_REQUIRED');
const folder = path.join(process.env.LOCALAPPDATA, 'PaperfundSigner', 'disposable-proof');
fs.mkdirSync(folder, { recursive: true });
const sid = execFileSync(
  'powershell.exe',
  ['-NoProfile', '-Command', '[Security.Principal.WindowsIdentity]::GetCurrent().User.Value'],
  { encoding: 'utf8', windowsHide: true },
).trim();
execFileSync(
  'icacls.exe',
  [folder, '/inheritance:r', '/grant:r', '*' + sid + ':(OI)(CI)F', '*S-1-5-18:(OI)(CI)F'],
  { stdio: 'pipe', windowsHide: true },
);
const key = generateKeyPairSync('ed25519'),
  recipient = generateKeyPairSync('ed25519')
    .publicKey.export({ format: 'der', type: 'spki' })
    .subarray(-32);
const seed = key.privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(-32),
  pub = key.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
const secret = Buffer.concat([seed, pub]),
  address = encode58(pub),
  name = Date.now().toString();
const record = path.join(folder, name + '.dpapi'),
  backup = path.join(folder, name + '.backup.dpapi');
const tool = path.join(installation, 'disposable-dpapi.ps1');
try {
  const protectedResult = execFileSync(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'RemoteSigned', '-File', tool, '-Mode', 'Protect', '-Record', record],
    { input: JSON.stringify([...secret]), encoding: 'utf8', windowsHide: true },
  );
  if (protectedResult !== 'PROTECTED') throw Error('PROTECTION_FAILED');
  fs.copyFileSync(record, backup, fs.constants.COPYFILE_EXCL);
  fs.unlinkSync(record);
  // Restoring in a fresh PowerShell process proves same-profile CurrentUser DPAPI recovery.
  let restored = execFileSync(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'RemoteSigned', '-File', tool, '-Mode', 'Restore', '-Record', backup],
    { input: '', encoding: 'utf8', windowsHide: true },
  );
  if (derivePublic(restored) !== address) throw Error('RESTORED_IDENTITY_MISMATCH');
  const bytes = Buffer.from(JSON.parse(restored));
  restored = '';
  const der = Buffer.concat([
    Buffer.from('302e020100300506032b657004220420', 'hex'),
    bytes.subarray(0, 32),
  ]);
  try {
    const crossUserProbeFile = path.join(
      process.env.ProgramData,
      'PaperfundSignerAcceptance',
      name + '.disposable-ciphertext.dpapi',
    );
    fs.copyFileSync(backup, crossUserProbeFile, fs.constants.COPYFILE_EXCL);
    const restoredKey = createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
    const amount = Buffer.alloc(12);
    amount.writeUInt32LE(2);
    amount.writeBigUInt64LE(1n, 4);
    const blockhash = randomBytes(32); // Deliberately random, never fetched from any chain.
    const message = Buffer.concat([
      Buffer.from([1, 0, 1, 3]),
      pub,
      recipient,
      Buffer.alloc(32),
      blockhash,
      Buffer.from([1, 2, 2, 0, 1, 12]),
      amount,
    ]);
    const signature = sign(null, message, restoredKey);
    if (!verify(null, message, createPublicKey(restoredKey), signature))
      throw Error('SIGNATURE_FAILED');
    const transaction = Buffer.concat([Buffer.from([1]), signature, message]);
    const proof = {
      version: 1,
      passed: true,
      signerSid: sid,
      publicAddress: address,
      recipient: encode58(recipient),
      lamports: '1',
      network: 'OFFLINE_RANDOM_BLOCKHASH_NO_RPC_NO_BROADCAST',
      messageSha256: createHash('sha256').update(message).digest('hex'),
      signature: encode58(signature),
      signedTransactionBase64: transaction.toString('base64'),
      encryptedBackup: backup,
      crossUserProbeFile,
      restoredInFreshProcess: true,
      restorationScope: 'SAME_WINDOWS_ACCOUNT_AND_PROFILE_ONLY',
      authorization: 'DISPOSABLE_TEST_ONLY',
      createdAt: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(folder, 'proof.public.json'), JSON.stringify(proof, null, 2));
    console.log(JSON.stringify(proof));
  } finally {
    bytes.fill(0);
    der.fill(0);
  }
} finally {
  secret.fill(0);
  seed.fill(0);
}
