import 'dotenv/config';
import { LaunchpadPool, LAUNCHPAD_PROGRAM, LAUNCHPAD_PLATFORM } from '@raydium-io/raydium-sdk-v2';
import { PublicKey } from '@solana/web3.js';
import { writeFileSync } from 'node:fs';
// One narrowly filtered, read-only discovery request. Hints still require full route validation.
const response = await fetch(
  process.env['SOLANA_RPC_URL'] ?? 'https://api.mainnet-beta.solana.com',
  {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    signal: AbortSignal.timeout(15000),
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getProgramAccounts',
      params: [
        LAUNCHPAD_PROGRAM.toBase58(),
        {
          encoding: 'base64',
          commitment: 'confirmed',
          filters: [
            { dataSize: LaunchpadPool.span },
            {
              memcmp: {
                offset: LaunchpadPool.offsetOf('platformId'),
                bytes: LAUNCHPAD_PLATFORM.toBase58(),
              },
            },
            { memcmp: { offset: LaunchpadPool.offsetOf('status'), bytes: '1' } },
          ],
          dataSlice: { offset: LaunchpadPool.offsetOf('mintA'), length: 32 },
        },
      ],
    }),
  },
);
const body = (await response.json()) as {
  result?: Array<{ pubkey: string; account: { data: [string, string] } }>;
  error?: { code: number };
};
if (!response.ok || !Array.isArray(body.result))
  throw Error(
    `Filtered comparison discovery failed: HTTP ${response.status}, RPC ${body.error?.code ?? 'missing'}`,
  );
const selected = body.result
  .slice(0, 8)
  .map((row) => ({
    pool: row.pubkey,
    mint: new PublicKey(Buffer.from(row.account.data[0], 'base64')).toBase58(),
  }));
writeFileSync('docs/launchlab-normal-candidates.json', JSON.stringify(selected, null, 2) + '\n');
console.log(JSON.stringify({ count: body.result.length, selected }));
