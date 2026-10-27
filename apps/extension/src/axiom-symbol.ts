import type { AxiomChartData, AxiomNativeChart } from './axiom-native.js';

const symbolFields = [
  'ticker',
  'name',
  'description',
  'full_name',
  'exchange',
  'listed_exchange',
  'pairAddress',
  'tokenAddress',
  'selectedCurrency',
  'currency_code',
  'unit_id',
] as const;
export interface AxiomSymbolSnapshot {
  identifier: string | null;
  rawSymbol: string | null;
  metadata: Partial<Record<(typeof symbolFields)[number], string>>;
  availableFields: string[];
  readErrors: string[];
}
export function readAxiomSymbol(
  chart: Pick<AxiomNativeChart, 'symbolExt' | 'symbol'>,
): AxiomSymbolSnapshot {
  const result: AxiomSymbolSnapshot = {
    identifier: null,
    rawSymbol: null,
    metadata: {},
    availableFields: [],
    readErrors: [],
  };
  try {
    const info = chart.symbolExt();
    if (info && typeof info === 'object') {
      result.availableFields = Object.keys(info).slice(0, 40);
      for (const key of symbolFields) {
        const value = info[key];
        // Only public symbol fields; never dump custom metadata or host objects.
        if (typeof value === 'string' && value.length <= 512) result.metadata[key] = value;
      }
    }
  } catch {
    result.readErrors.push('SYMBOL_EXT_READ_FAILED');
  }
  try {
    const value = chart.symbol?.();
    if (typeof value === 'string' && value.length <= 512) result.rawSymbol = value;
  } catch {
    result.readErrors.push('SYMBOL_READ_FAILED');
  }
  result.identifier = result.metadata.ticker || result.rawSymbol;
  return result;
}
export function symbolSnapshotKey(snapshot: AxiomSymbolSnapshot) {
  const m = snapshot.metadata;
  return JSON.stringify([
    snapshot.identifier,
    snapshot.rawSymbol,
    m.pairAddress,
    m.tokenAddress,
    m.selectedCurrency,
    m.currency_code,
    m.unit_id,
  ]);
}
function parseIdentifier(identifier: string | null) {
  if (!identifier) return null;
  if (identifier.startsWith('axiom-chart-v1|')) {
    const p = identifier.split('|');
    if (
      p.length !== 7 ||
      p[1] !== 'pair' ||
      p[2] !== 'sol' ||
      !/^(SOL|USD)$/.test(p[3]!) ||
      !/^\d+$/.test(p[4]!) ||
      !Number.isSafeInteger(Number(p[4]))
    )
      return null;
    try {
      const pair = decodeURIComponent(p[5]!);
      const mint = decodeURIComponent(p[6]!);
      return pair
        ? { pair, mint: mint || null, currency: p[3] as 'SOL' | 'USD', format: 'VERSIONED_PAIR' }
        : null;
    } catch {
      return null;
    }
  }
  return null;
}
export function verifyAxiomSymbol(snapshot: AxiomSymbolSnapshot, data: AxiomChartData) {
  const parsed = parseIdentifier(snapshot.identifier);
  const details = {
    expectedMint: data.mint,
    expectedContext: data.context,
    rawIdentifier: snapshot.identifier,
    rawSymbol: snapshot.rawSymbol,
    metadata: snapshot.metadata,
    availableFields: snapshot.availableFields,
    readErrors: snapshot.readErrors,
    chartMarket: parsed?.pair ?? null,
    resolvedChartMint: null as string | null,
    matchingMethod: null as string | null,
  };
  const rejected = (reason: string, status: 'FAIL' | 'UNAVAILABLE' = 'UNAVAILABLE') => ({
    reason,
    status,
    details,
    identity: null,
  });
  if (!parsed) return rejected('UNRESOLVED_CHART_SYMBOL_FORMAT');
  if (!data.mint) return rejected('EXPECTED_MINT_PENDING_BACKEND_RESOLUTION');
  const m = snapshot.metadata;
  // A resolved ticker and current symbol must not identify different series during SPA changes.
  const rawParsed = parseIdentifier(snapshot.rawSymbol);
  if (rawParsed && snapshot.rawSymbol !== snapshot.identifier)
    return rejected('CHART_SYMBOL_RESOLUTION_PENDING');
  if (
    (m.pairAddress && m.pairAddress !== parsed.pair) ||
    (m.selectedCurrency && m.selectedCurrency !== parsed.currency) ||
    (m.currency_code && m.currency_code !== parsed.currency)
  )
    return rejected('CHART_SYMBOL_METADATA_CONFLICT', 'FAIL');
  if (
    (parsed.mint && parsed.mint !== data.mint) ||
    (m.tokenAddress && m.tokenAddress !== data.mint)
  )
    return rejected('CHART_TOKEN_MINT_MISMATCH', 'FAIL');
  let method: string;
  if (parsed.mint) {
    if (parsed.pair !== data.context && data.context !== data.mint)
      return rejected('CHART_MARKET_CONTEXT_MISMATCH', 'FAIL');
    method = 'VERSIONED_EXACT_MINT_AND_CONTEXT';
  } else {
    const binding = data.marketBinding;
    if (!binding || binding.requestedContext !== data.context || binding.mint !== data.mint)
      return rejected('BACKEND_MARKET_MINT_BINDING_UNAVAILABLE');
    if (parsed.pair !== binding.requestedContext && parsed.pair !== binding.marketId)
      return rejected('CHART_MARKET_CONTEXT_MISMATCH', 'FAIL');
    method = 'VERSIONED_PAIR_BACKEND_MINT_BINDING';
  }
  details.resolvedChartMint = data.mint;
  details.matchingMethod = method;
  return {
    status: 'PASS' as const,
    reason: 'EXACT_CHART_IDENTITY_VERIFIED',
    details,
    identity: {
      ticker: snapshot.identifier!,
      currency: parsed.currency,
      pair: parsed.pair,
      mint: data.mint,
      symbolKey: symbolSnapshotKey(snapshot),
      method,
    },
  };
}
