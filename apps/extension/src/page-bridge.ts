import type { PageBridgeRequest, PageBridgeResponse } from './messages.js';
import { isPaperfundAuthMessage } from './wallet-message.js';

const PAGE_CHANNEL = 'paperfund:page-bridge:v1' as const;

interface WalletProvider {
  publicKey?: { toString(): string };
  connect(): Promise<{ publicKey: { toString(): string } }>;
  signMessage(message: Uint8Array, encoding?: string): Promise<{ signature: Uint8Array }>;
}

type PageWindow = Window &
  typeof globalThis & {
    solana?: WalletProvider;
    phantom?: { solana?: WalletProvider };
  };

function provider(): WalletProvider | null {
  const page = window as PageWindow;
  return page.phantom?.solana ?? page.solana ?? null;
}

function encodeBase58(bytes: Uint8Array): string {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let value = 0n;
  for (const byte of bytes) value = value * 256n + BigInt(byte);
  let result = '';
  while (value > 0n) {
    result = alphabet[Number(value % 58n)] + result;
    value /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    result = `1${result}`;
  }
  return result || '1';
}

function navigation(): void {
  window.postMessage(
    { channel: PAGE_CHANNEL, direction: 'NAVIGATION', url: location.href },
    location.origin,
  );
}

const originalPushState = history.pushState.bind(history);
history.pushState = (data: unknown, unused: string, url?: string | URL | null) => {
  originalPushState(data, unused, url);
  navigation();
};
const originalReplaceState = history.replaceState.bind(history);
history.replaceState = (data: unknown, unused: string, url?: string | URL | null) => {
  originalReplaceState(data, unused, url);
  navigation();
};
window.addEventListener('popstate', navigation);
window.addEventListener('hashchange', navigation);
navigation();

window.addEventListener('message', (event: MessageEvent) => {
  if (
    event.source !== window ||
    event.origin !== location.origin ||
    !event.data ||
    typeof event.data !== 'object'
  )
    return;
  const request = event.data as Partial<PageBridgeRequest>;
  if (
    request.channel !== PAGE_CHANNEL ||
    request.direction !== 'REQUEST' ||
    typeof request.requestId !== 'string'
  )
    return;
  if (!['GET_PUBLIC_KEY', 'CONNECT', 'SIGN_AUTH_MESSAGE'].includes(request.operation ?? '')) return;
  const requestId = request.requestId;
  void (async () => {
    const wallet = provider();
    if (!wallet) throw new Error('No compatible Solana wallet was found.');
    if (request.operation === 'GET_PUBLIC_KEY')
      return wallet.publicKey ? { walletAddress: wallet.publicKey.toString() } : {};
    if (request.operation === 'CONNECT')
      return { walletAddress: (await wallet.connect()).publicKey.toString() };
    if (typeof request.message !== 'string') throw new Error('Authentication message is invalid.');
    const walletAddress = wallet.publicKey?.toString();
    if (!walletAddress) throw new Error('Connect the wallet before signing in.');
    if (!isPaperfundAuthMessage(request.message, walletAddress)) {
      throw new Error('Only a valid Paperfund authentication message can be signed.');
    }
    const signed = await wallet.signMessage(new TextEncoder().encode(request.message), 'utf8');
    return { walletAddress, signature: encodeBase58(signed.signature) };
  })().then(
    (result) =>
      window.postMessage(
        {
          channel: PAGE_CHANNEL,
          direction: 'RESPONSE',
          requestId,
          ok: true,
          ...result,
        } satisfies PageBridgeResponse,
        location.origin,
      ),
    (error: unknown) =>
      window.postMessage(
        {
          channel: PAGE_CHANNEL,
          direction: 'RESPONSE',
          requestId,
          ok: false,
          error: error instanceof Error ? error.message : 'Wallet request failed.',
        } satisfies PageBridgeResponse,
        location.origin,
      ),
  );
});
