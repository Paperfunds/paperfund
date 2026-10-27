import { generateKeyPairSync } from 'node:crypto';
import bs58 from 'bs58';

// The Playwright config initializes these before spawning its server/workers.
// Only ephemeral test-process environment receives the signing key.
if (!process.env['PAPERFUND_E2E_PRIVATE_KEY']) {
  const pair = generateKeyPairSync('ed25519');
  process.env['PAPERFUND_E2E_PRIVATE_KEY'] = pair.privateKey
    .export({ type: 'pkcs8', format: 'der' }).toString('base64');
  process.env['PAPERFUND_E2E_PUBLIC_KEY'] = bs58.encode(
    pair.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32),
  );
}
export const testWalletAddress = process.env['PAPERFUND_E2E_PUBLIC_KEY']!;
export const testWalletPrivateKey = process.env['PAPERFUND_E2E_PRIVATE_KEY']!;
