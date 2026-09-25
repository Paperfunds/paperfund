const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function isSolanaAddress(value: string): boolean {
  if (
    !value ||
    value.length > 44 ||
    [...value].some((character) => !BASE58_ALPHABET.includes(character))
  )
    return false;
  let number = 0n;
  for (const character of value) number = number * 58n + BigInt(BASE58_ALPHABET.indexOf(character));
  const bytes: number[] = [];
  while (number > 0n) {
    bytes.push(Number(number % 256n));
    number /= 256n;
  }
  let leadingZeroes = 0;
  for (const character of value) {
    if (character !== '1') break;
    leadingZeroes += 1;
  }
  return bytes.length + leadingZeroes === 32;
}

export interface TerminalTokenState {
  terminal: 'AXIOM';
  mint: string | null;
  status: 'SUPPORTED_ROUTE' | 'NO_MARKET' | 'DETECTION_UNAVAILABLE';
  url: string;
}

export interface TerminalAdapter {
  readonly id: 'AXIOM';
  detect(url: string): TerminalTokenState;
  observe(onChange: (state: TerminalTokenState) => void): () => void;
}

export class AxiomTerminalAdapter implements TerminalAdapter {
  readonly id = 'AXIOM' as const;
  private currentUrl = '';

  detect(rawUrl: string): TerminalTokenState {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      return { terminal: this.id, mint: null, status: 'DETECTION_UNAVAILABLE', url: rawUrl };
    }
    if (url.protocol !== 'https:' || url.hostname !== 'axiom.trade') {
      return { terminal: this.id, mint: null, status: 'DETECTION_UNAVAILABLE', url: rawUrl };
    }
    const segments = url.pathname.split('/').filter(Boolean);
    if (segments[0] !== 'meme') {
      return { terminal: this.id, mint: null, status: 'NO_MARKET', url: rawUrl };
    }
    const mint = segments[1] ?? '';
    const routeShapeValid =
      segments.length === 2 || (segments.length === 3 && segments[2]?.startsWith('@'));
    const chain = url.searchParams.get('chain');
    if (!routeShapeValid || (chain !== null && chain !== 'sol') || !isSolanaAddress(mint)) {
      return { terminal: this.id, mint: null, status: 'DETECTION_UNAVAILABLE', url: rawUrl };
    }
    return { terminal: this.id, mint, status: 'SUPPORTED_ROUTE', url: rawUrl };
  }

  observe(onChange: (state: TerminalTokenState) => void): () => void {
    const publish = (url: string) => {
      if (url === this.currentUrl) return;
      this.currentUrl = url;
      onChange(this.detect(url));
    };
    const navigation = (event: MessageEvent) => {
      if (event.source !== window || !event.data || typeof event.data !== 'object') return;
      const data = event.data as { channel?: unknown; direction?: unknown; url?: unknown };
      if (
        data.channel === 'paperfund:page-bridge:v1' &&
        data.direction === 'NAVIGATION' &&
        typeof data.url === 'string'
      )
        publish(data.url);
    };
    let queued = false;
    const observer = new MutationObserver(() => {
      if (queued) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        publish(location.href);
      });
    });
    window.addEventListener('message', navigation);
    window.addEventListener('popstate', () => publish(location.href));
    observer.observe(document.documentElement, { childList: true, subtree: true });
    publish(location.href);
    return () => {
      window.removeEventListener('message', navigation);
      observer.disconnect();
    };
  }
}
