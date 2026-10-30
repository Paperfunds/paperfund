import { useEffect, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  choosePair, dexscreenerEmbed, dexscreenerTokenUrl,
  loadPublicPairs, searchPublicPairs, validMint,
} from './market-discovery.js';

export function WebsiteMarketPicker({
  selectedMint, onSelect,
}: {
  selectedMint: string;
  onSelect(mint: string): void;
}) {
  const [term, setTerm] = useState(selectedMint);
  const [debounced, setDebounced] = useState('');
  const [error, setError] = useState('');
  useEffect(() => setTerm(selectedMint), [selectedMint]);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(term.trim()), 400);
    return () => window.clearTimeout(timer);
  }, [term]);
  const mintQuery = Boolean(validMint(debounced));
  const search = useQuery({
    queryKey: ['public-token-search', debounced],
    queryFn: () => searchPublicPairs(debounced),
    enabled: debounced.length >= 3 && !mintQuery,
    retry: false,
    staleTime: 60_000,
  });
  const uniqueTokens = new Set<string>();
  const results = (search.data ?? []).filter((pair) => {
    const mint = pair.baseToken?.address;
    if (!mint || !validMint(mint) || uniqueTokens.has(mint)) return false;
    uniqueTokens.add(mint);
    return true;
  }).slice(0, 6);
  function handleSearch(event: FormEvent) {
    event.preventDefault();
    const mint = validMint(term);
    if (!mint) {
      setError('Enter a valid Solana token address, or choose a token from the search results.');
      return;
    }
    setError('');
    onSelect(mint);
  }
  return (
    <section className="pf-website-picker" aria-label="Find a token to paper trade">
      <div className="pf-website-picker-heading">
        <div>
          <span className="eyebrow">LIVE MARKET DISCOVERY</span>
          <h2>Find a token. Trade with Paper SOL.</h2>
        </div>
        <span className="pf-web-label">No extension required</span>
      </div>
      <form className="pf-web-search" onSubmit={handleSearch}>
        <label htmlFor="pf-web-mint-search" className="sr-only">Token symbol, name or mint address</label>
        <input
          id="pf-web-mint-search"
          autoComplete="off"
          value={term}
          maxLength={80}
          onChange={(event) => { setTerm(event.target.value); setError(''); }}
          placeholder="Search token name, symbol, or paste CA"
        />
        <button type="submit" className="button primary" disabled={!term.trim()}>Open token</button>
      </form>
      {error && <p role="alert" className="pf-web-picker-alert">{error}</p>}
      {search.isFetching && <p className="pf-web-picker-note">Searching public Solana market listings…</p>}
      {search.isError && <p className="pf-web-picker-note">External search unavailable. Paste a mint address to trade directly.</p>}
      {debounced.length >= 3 && !mintQuery && search.isSuccess && results.length === 0 && (
        <p className="pf-web-picker-note">No indexed matches. You can still paste a token mint directly.</p>
      )}
      {results.length > 0 && !mintQuery && (
        <div className="pf-web-search-results" aria-label="External token search results">
          {results.map((pair) => (
            <button
              key={pair.baseToken!.address}
              type="button"
              onClick={() => { setTerm(pair.baseToken!.address!); setError(''); onSelect(pair.baseToken!.address!); }}
            >
              <span><strong>{pair.baseToken?.symbol || 'Token'}</strong> <small>{pair.baseToken?.name || 'Solana market'}</small></span>
              <small className="pf-web-result-mint">{pair.baseToken?.address?.slice(0, 5)}…{pair.baseToken?.address?.slice(-5)}</small>
            </button>
          ))}
        </div>
      )}
      <p className="pf-web-picker-note">Search and charts are external market information, not execution quotes. Paperfund independently verifies the mint and prices each trade.</p>
    </section>
  );
}

export function WebsiteMarketChart({ mint }: { mint: string }) {
  const acceptedMint = validMint(mint);
  const query = useQuery({
    queryKey: ['public-chart-pairs', acceptedMint],
    queryFn: () => loadPublicPairs(acceptedMint!),
    enabled: Boolean(acceptedMint),
    retry: false,
    staleTime: 60_000,
  });
  const pair = acceptedMint ? choosePair(query.data, acceptedMint) : null;
  const embedUrl = pair ? dexscreenerEmbed(pair) : null;
  const outsideUrl = acceptedMint ? dexscreenerTokenUrl(acceptedMint) : null;
  return (
    <section className="pf-web-chart" aria-label="Informational market chart">
      <header className="pf-web-chart-head">
        <div>
          <span className="eyebrow">MARKET CHART</span>
          <h2>{acceptedMint ? acceptedMint.slice(0, 6) + '…' + acceptedMint.slice(-6) : 'Select a Solana token'}</h2>
        </div>
        {outsideUrl && <a href={outsideUrl} target="_blank" rel="noopener noreferrer">Open chart ↗</a>}
      </header>
      {embedUrl ? (
        <iframe
          title="DexScreener informational chart"
          src={embedUrl}
          loading="lazy"
          referrerPolicy="no-referrer"
          sandbox="allow-scripts allow-same-origin allow-popups"
          className="pf-web-chart-frame"
        />
      ) : (
        <div className="pf-web-chart-placeholder">
          {query.isFetching ? (
            <p>Resolving the public market chart…</p>
          ) : !acceptedMint ? (
            <p>Choose a token above to display its chart and inspect a paper-trading route.</p>
          ) : (
            <p>Chart not available from this market-data provider. You can still inspect the token's Paperfund execution route.</p>
          )}
        </div>
      )}
      <p className="pf-web-chart-disclosure">
        Market chart by DexScreener · Informational only. All PAPER order limits, fees, and fills are calculated independently by Paperfund.
      </p>
    </section>
  );
}
