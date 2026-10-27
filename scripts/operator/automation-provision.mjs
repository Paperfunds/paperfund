import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Keypair } from '@solana/web3.js';
async function main() {
  const key = Keypair.generate(),
    wallet = key.publicKey.toBase58(),
    target = path.join(process.env.ProgramFiles, 'PaperfundSigner');
  try {
    execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'RemoteSigned',
        '-File',
        path.join(target, 'automation-dpapi.ps1'),
        '-Mode',
        'WriteWallet',
      ],
      {
        input: JSON.stringify({ wallet, key: JSON.stringify([...key.secretKey]) }),
        encoding: 'utf8',
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    const report = {
      schema: 'paperfund-automation-custody-v1',
      wallet,
      compromised: false,
      mode: 'DPAPI_CURRENT_USER_ISOLATED',
      encryptedBackup: true,
      transactionAuthority: 'NONE',
      createdAt: new Date().toISOString(),
    };
    fs.writeFileSync(
      path.join(process.env.ProgramData, 'PaperfundAutomation/public/custody-' + wallet + '.json'),
      JSON.stringify(report, null, 2),
      { flag: 'wx' },
    );
    console.log(JSON.stringify(report, null, 2));
  } finally {
    key.secretKey.fill(0);
  }
}
main().catch(() => {
  console.error('AUTO_CUSTODY_PROVISION_BLOCKED');
  process.exitCode = 1;
});
