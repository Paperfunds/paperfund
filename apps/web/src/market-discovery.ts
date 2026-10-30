/* Display-only market discovery. All paper fills remain server-authoritative. */
export const SOLANA_MINT_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function validMint(mint: string): string | null {
  const candidate = mint.trim();
  return SOLANA_MINT_PATTERN.test(candidate) ? candidate : null;
}

export function mintFromSearch(search: string): string | null {
  return validMint(new URLSearchParams(search).get('mint') ?? '');
}

export interface DiscoveredPair {
  chainId?: string;
  pairAddress?: string;
  dexId?: string;
  baseToken?: { address?: string; name?: string; symbol?: string };
  quoteToken?: { address?: string; name?: string; symbol?: string };
  liquidity?: { usd?: number };
  priceUsd?: string;
}

export function choosePair(pairs: unknown, mint: string): DiscoveredPair | null {
  if (!validMint(mint) || !Array.isArray(pairs)) return null;
  const matches: DiscoveredPair[] = pairs.filter((item): item is DiscoveredPair => {
    if (!item || typeof item !== 'object') return false;
    const pair = item as DiscoveredPair;
    return pair.chainId === 'solana' &&
      typeof pair.pairAddress === 'string' && validMint(pair.pairAddress) !== null &&
      (pair.baseToken?.address === mint || pair.quoteToken?.address === mint);
  });
  return matches.sort((a,b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0] ?? null;
}

export function dexscreenerEmbed(pair: DiscoveredPair): string | null {
  if (pair.chainId !== 'solana' || !pair.pairAddress || !validMint(pair.pairAddress)) return null;
  const flags = new URLSearchParams({
    embed: '1', loadChartSettings: '0', trades: '0', info: '0',
    chartLeftToolbar: '0', chartTheme: 'dark', theme: 'dark',
    chartStyle: '1', chartType: 'price', interval: '15',
  });
  return 'https://dexscreener.com/solana/' + pair.pairAddress + '?' + flags.toString();
}

export function dexscreenerTokenUrl(mint: string): string | null {
  const accepted = validMint(mint);
  return accepted ? 'https://dexscreener.com/solana/' + accepted : null;
}

/* This informational source is NEVER used as input for paper-trading quotes or P&L. */
export async function loadPublicPairs(mint: string): Promise<DiscoveredPair[]> {
  if (!validMint(mint)) return [];
  const response = await fetch('https://api.dexscreener.com/token-pairs/v1/solana/' + mint, {
    credentials: 'omit', headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error('Chart metadata unavailable');
  const payload: unknown = await response.json();
  return Array.isArray(payload) ? payload as DiscoveredPair[] : [];
}

export async function searchPublicPairs(term: string): Promise<DiscoveredPair[]> {
  if (term.trim().length < 3 || term.trim().length > 80) return [];
  const response = await fetch(
    'https://api.dexscreener.com/latest/dex/search?q=' + encodeURIComponent(term.trim()),
    { credentials: 'omit', headers: { Accept: 'application/json' } },
  );
  if (!response.ok) throw new Error('Token search unavailable');
  const payload: unknown = await response.json();
  if (!payload || typeof payload !== 'object') return [];
  const pairs = (payload as { pairs?: unknown }).pairs;
  if (!Array.isArray(pairs)) return [];
  return pairs.filter((x) => x && typeof x === 'object' && (x as DiscoveredPair).chainId === 'solana')
    .slice(0, 40) as DiscoveredPair[];
}
