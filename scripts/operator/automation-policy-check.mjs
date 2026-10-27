import { validatePolicy } from './automation-core.mjs';
import { PublicKey } from '@solana/web3.js';
async function main() {
  let raw = '';
  for await (const b of process.stdin) {
    raw += b;
    if (raw.length > 16000) throw Error('POLICY_SIZE');
  }
  try {
    const p = validatePolicy(JSON.parse(raw));
    new PublicKey(p.wallet);
    new PublicKey(p.mint);
    console.log('VALID_PUBLIC_POLICY');
  } catch {
    console.error('AUTO_POLICY_VALIDATION_BLOCKED');
    process.exitCode = 1;
  }
}
main().catch(() => {
  console.error('AUTO_POLICY_VALIDATION_BLOCKED');
  process.exitCode = 1;
});
