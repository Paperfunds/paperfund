/** Independent quote diagnostics, never a fee-exclusive spot authority or execution fallback. */
import { WRAPPED_SOL_MINT } from '@paperfund/protocols';
export interface JupiterQuote {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  swapMode: string;
  contextSlot: number;
  platformFee: { amount: string; feeBps: number } | null;
  routePlan: {
    percent?: number;
    bps?: number;
    swapInfo: {
      ammKey: string;
      label: string;
      inputMint: string;
      outputMint: string;
      inAmount: string;
      outAmount: string;
      feeAmount?: string;
      feeMint?: string;
    };
  }[];
}
let lastRequest = 0;
let queue: Promise<unknown> = Promise.resolve();
export async function jupiterRead(path: string): Promise<unknown> {
  const next = queue
    .catch(() => undefined)
    .then(async () => {
      await new Promise((resolve) =>
        setTimeout(resolve, Math.max(0, 2100 - (Date.now() - lastRequest))),
      );
      lastRequest = Date.now();
      const response = await fetch('https://api.jup.ag/' + path, {
        signal: AbortSignal.timeout(10000),
      });
      const body: unknown = await response.json();
      if (!response.ok)
        throw new Error('JUPITER_HTTP_' + response.status + ':' + JSON.stringify(body));
      return body;
    });
  queue = next;
  return next;
}
export async function jupiterQuote(
  mint: string,
  side: 'BUY' | 'SELL',
  input: bigint,
  onlyDirectRoutes = true,
): Promise<JupiterQuote> {
  const inputMint = side === 'BUY' ? WRAPPED_SOL_MINT : mint,
    outputMint = side === 'BUY' ? mint : WRAPPED_SOL_MINT;
  const body = await jupiterRead(
    'swap/v1/quote?' +
      new URLSearchParams({
        inputMint,
        outputMint,
        amount: input.toString(),
        onlyDirectRoutes: String(onlyDirectRoutes),
        swapMode: 'ExactIn',
        slippageBps: '0',
      }),
  );
  return verifyJupiter(body, inputMint, outputMint, input);
}
export function verifyJupiter(
  body: unknown,
  inputMint: string,
  outputMint: string,
  input: bigint,
): JupiterQuote {
  const q = body as JupiterQuote;
  if (
    !q ||
    q.inputMint !== inputMint ||
    q.outputMint !== outputMint ||
    q.inAmount !== input.toString() ||
    !/^\d+$/.test(q.outAmount) ||
    BigInt(q.outAmount) <= 0n ||
    q.swapMode !== 'ExactIn' ||
    !Number.isSafeInteger(q.contextSlot) ||
    q.contextSlot < 0 ||
    !Array.isArray(q.routePlan) ||
    q.routePlan.length === 0 ||
    (q.platformFee !== null && q.platformFee !== undefined && q.platformFee.amount !== '0')
  )
    throw new Error('INVALID_JUPITER_QUOTE');
  return q;
}
export async function blockTime(slot: number): Promise<number> {
  if (!Number.isSafeInteger(slot) || slot < 0) throw new Error('INVALID_QUOTE_SLOT');
  const response = await fetch('https://solana-rpc.publicnode.com', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getBlockTime', params: [slot] }),
    signal: AbortSignal.timeout(5000),
  });
  const body = (await response.json()) as { result?: number };
  if (!response.ok || !Number.isSafeInteger(body.result) || body.result! <= 0)
    throw new Error('QUOTE_BLOCK_TIME_UNAVAILABLE');
  return body.result! * 1000;
}
