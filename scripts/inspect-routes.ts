import 'dotenv/config';
import { SolanaRpcClient } from '../packages/protocols/src/pump-fun.js';
import { CpmmPoolInfoLayout, CpmmConfigInfoLayout } from '@raydium-io/raydium-sdk-v2';
import { cpAmmCoder, type PoolState } from '@meteora-ag/cp-amm-sdk';
const rpc = new SolanaRpcClient({
  url: process.env['SOLANA_RPC_URL'] ?? 'https://api.mainnet-beta.solana.com',
  timeoutMs: 15000,
});
for (const mint of process.argv.slice(2)) {
  const pairs = (await fetch(`https://api.dexscreener.com/token-pairs/v1/solana/${mint}`).then(
    (r) => r.json(),
  )) as Array<{
    pairAddress: string;
    baseToken: { address: string };
    quoteToken: { address: string };
  }>;
  const selected = pairs.slice(0, 12);
  const data = await rpc.getMultipleAccounts(selected.map((p) => p.pairAddress));
  for (const [i, p] of selected.entries()) {
    const a = data.value[i];
    if (!a) continue;
    const b = Buffer.from(a.data[0], 'base64');
    let detail: unknown;
    if (a.owner.startsWith('CPMM')) {
      const d = CpmmPoolInfoLayout.decode(b);
      const c = await rpc.getMultipleAccounts([d.configId.toBase58()]);
      detail = {
        mintA: d.mintA.toBase58(),
        mintB: d.mintB.toBase58(),
        status: d.status,
        feeOn: d.feeOn,
        enableCreatorFee: d.enableCreatorFee,
        config: c.value[0]
          ? CpmmConfigInfoLayout.decode(Buffer.from(c.value[0].data[0], 'base64'))
          : null,
      };
    }
    if (a.owner.startsWith('cpam')) {
      const d = cpAmmCoder.accounts.decode<PoolState>('Pool', b);
      detail = d;
    }
    console.log(
      JSON.stringify({
        mint,
        pool: p.pairAddress,
        owner: a.owner,
        quote: p.quoteToken.address,
        detail,
      }),
    );
  }
}
