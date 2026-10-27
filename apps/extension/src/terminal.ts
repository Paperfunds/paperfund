const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export type TerminalId = 'AXIOM' | 'GMGN' | 'PADRE';

export function isSolanaAddress(value: string): boolean {
  if (!value || value.length > 44 || [...value].some((c) => !BASE58_ALPHABET.includes(c)))
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
  terminal: TerminalId;
  mint: string | null;
  status: 'SUPPORTED_ROUTE' | 'NO_MARKET' | 'DETECTION_UNAVAILABLE';
  url: string;
}

export function isActionableTerminal(
  state: TerminalTokenState | null,
): state is TerminalTokenState & { mint: string } {
  return state?.status === 'SUPPORTED_ROUTE' && state.mint !== null;
}

export interface TerminalAdapter {
  readonly id: TerminalId;
  matches(url: URL): boolean;
  detect(rawUrl: string): TerminalTokenState;
}

function state(
  terminal: TerminalId,
  rawUrl: string,
  status: TerminalTokenState['status'],
  mint: string | null = null,
): TerminalTokenState {
  return { terminal, mint, status, url: rawUrl };
}

function parseUrl(rawUrl: string): URL | null {
  try {
    return new URL(rawUrl);
  } catch {
    return null;
  }
}

export class AxiomTerminalAdapter implements TerminalAdapter {
  readonly id = 'AXIOM' as const;

  matches(url: URL): boolean {
    return url.protocol === 'https:' && url.hostname === 'axiom.trade';
  }

  detect(rawUrl: string): TerminalTokenState {
    const url = parseUrl(rawUrl);
    if (!url || !this.matches(url)) return state(this.id, rawUrl, 'DETECTION_UNAVAILABLE');
    const segments = url.pathname.split('/').filter(Boolean);
    if (segments[0] !== 'meme') return state(this.id, rawUrl, 'NO_MARKET');
    const mint = segments[1] ?? '';
    const routeShapeValid =
      segments.length === 2 || (segments.length === 3 && segments[2]?.startsWith('@'));
    const chain = url.searchParams.get('chain');
    if (!routeShapeValid || (chain !== null && chain !== 'sol') || !isSolanaAddress(mint))
      return state(this.id, rawUrl, 'DETECTION_UNAVAILABLE');
    return state(this.id, rawUrl, 'SUPPORTED_ROUTE', mint);
  }
}

export class GMGNTerminalAdapter implements TerminalAdapter {
  readonly id = 'GMGN' as const;

  matches(url: URL): boolean {
    return url.protocol === 'https:' && url.hostname === 'gmgn.ai';
  }

  detect(rawUrl: string): TerminalTokenState {
    const url = parseUrl(rawUrl);
    if (!url || !this.matches(url)) return state(this.id, rawUrl, 'DETECTION_UNAVAILABLE');
    const segments = url.pathname.split('/').filter(Boolean);
    if (segments.length === 0 || segments[0] !== 'sol') return state(this.id, rawUrl, 'NO_MARKET');
    if (segments[1] !== 'token') return state(this.id, rawUrl, 'NO_MARKET');
    const mint = segments[2] ?? '';
    if (segments.length !== 3 || !isSolanaAddress(mint))
      return state(this.id, rawUrl, 'DETECTION_UNAVAILABLE');
    return state(this.id, rawUrl, 'SUPPORTED_ROUTE', mint);
  }
}

export class PadreTerminalAdapter implements TerminalAdapter {
  readonly id = 'PADRE' as const;

  matches(url: URL): boolean {
    return url.protocol === 'https:' && url.hostname === 'trade.padre.gg';
  }

  detect(rawUrl: string): TerminalTokenState {
    const url = parseUrl(rawUrl);
    if (!url || !this.matches(url)) return state(this.id, rawUrl, 'DETECTION_UNAVAILABLE');
    const segments = url.pathname.split('/').filter(Boolean);
    if (segments[0] !== 'trade') return state(this.id, rawUrl, 'NO_MARKET');
    if (segments[1] !== 'solana') return state(this.id, rawUrl, 'NO_MARKET');
    const mint = segments[2] ?? '';
    if (segments.length !== 3 || !isSolanaAddress(mint))
      return state(this.id, rawUrl, 'DETECTION_UNAVAILABLE');
    return state(this.id, rawUrl, 'SUPPORTED_ROUTE', mint);
  }
}

export class TerminalAdapterRegistry {
  constructor(
    private readonly adapters: readonly TerminalAdapter[] = [
      new AxiomTerminalAdapter(),
      new GMGNTerminalAdapter(),
      new PadreTerminalAdapter(),
    ],
  ) {}

  resolve(rawUrl: string): TerminalAdapter | null {
    const url = parseUrl(rawUrl);
    if (!url) return null;
    const matches = this.adapters.filter((adapter) => adapter.matches(url));
    if (matches.length > 1) throw new Error(`Multiple terminal adapters matched ${url.origin}.`);
    return matches[0] ?? null;
  }

  detect(rawUrl: string): TerminalTokenState | null {
    return this.resolve(rawUrl)?.detect(rawUrl) ?? null;
  }

  observe(onChange: (state: TerminalTokenState | null) => void): () => void {
    let fingerprint = '';
    const publish = (rawUrl: string) => {
      const detected = this.detect(rawUrl);
      const nextFingerprint = detected
        ? `${detected.terminal}:${detected.status}:${detected.mint ?? ''}:${detected.url}`
        : `UNSUPPORTED:${rawUrl}`;
      if (nextFingerprint === fingerprint) return;
      fingerprint = nextFingerprint;
      onChange(detected);
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
    const nativeNavigation = () => publish(location.href);
    window.addEventListener('message', navigation);
    window.addEventListener('popstate', nativeNavigation);
    window.addEventListener('hashchange', nativeNavigation);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    publish(location.href);
    return () => {
      window.removeEventListener('message', navigation);
      window.removeEventListener('popstate', nativeNavigation);
      window.removeEventListener('hashchange', nativeNavigation);
      observer.disconnect();
    };
  }
}
