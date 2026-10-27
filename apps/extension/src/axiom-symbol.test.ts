import { describe, expect, it } from 'vitest';
import { readAxiomSymbol, verifyAxiomSymbol } from './axiom-symbol.js';
import type { AxiomChartData } from './axiom-native.js';
const pair = 'HTFaPY9rYmFiSfLVUXVjqmTs5KYTtqWjoABHJjxNAtMX';
const mint = '8Wtg9wQCuDVLrQqH8pw2yKyvurmrjEeFcp9ysdDKpump';
const liveTicker = `axiom-chart-v1|pair|sol|USD|1|${pair}|`;
const data: AxiomChartData = {
  url: `https://axiom.trade/meme/${pair}`,
  context: pair,
  mint,
  markers: [],
  marketBinding: { requestedContext: pair, mint },
};
function snapshot(ticker = liveTicker, extra: Record<string, unknown> = {}, symbol?: string) {
  return readAxiomSymbol({
    symbolExt: () => ({ ticker, ...extra }),
    symbol: () => symbol ?? 'Minestocks ' + pair,
  });
}
describe('operator-captured Axiom versioned pair identity', () => {
  it('verifies the exact live empty-mint ticker using its existing backend pair-to-mint binding', () => {
    const result = verifyAxiomSymbol(snapshot(), data);
    expect(result.status).toBe('PASS');
    expect(result.identity).toMatchObject({
      pair,
      mint,
      currency: 'USD',
      method: 'VERSIONED_PAIR_BACKEND_MINT_BINDING',
    });
    expect(result.details).toMatchObject({
      rawIdentifier: liveTicker,
      resolvedChartMint: mint,
      matchingMethod: 'VERSIONED_PAIR_BACKEND_MINT_BINDING',
    });
  });
  it('requires the binding and rejects stale/different pair or explicit mint conflicts', () => {
    expect(
      verifyAxiomSymbol(snapshot(), {
        url: data.url,
        context: data.context,
        mint: data.mint,
        markers: [],
      }).reason,
    ).toBe('BACKEND_MARKET_MINT_BINDING_UNAVAILABLE');
    expect(
      verifyAxiomSymbol(snapshot(), { ...data, marketBinding: { requestedContext: 'other', mint } })
        .identity,
    ).toBeNull();
    expect(verifyAxiomSymbol(snapshot(liveTicker.replace(pair, mint)), data).reason).toBe(
      'CHART_MARKET_CONTEXT_MISMATCH',
    );
    expect(verifyAxiomSymbol(snapshot(liveTicker + pair), data).reason).toBe(
      'CHART_TOKEN_MINT_MISMATCH',
    );
    expect(verifyAxiomSymbol(snapshot(liveTicker, { tokenAddress: pair }), data).reason).toBe(
      'CHART_TOKEN_MINT_MISMATCH',
    );
  });
  it('does not let raw symbol, pool metadata or currency contradict the resolved ticker', () => {
    expect(verifyAxiomSymbol(snapshot(liveTicker, { pairAddress: mint }), data).reason).toBe(
      'CHART_SYMBOL_METADATA_CONFLICT',
    );
    expect(
      verifyAxiomSymbol(snapshot(liveTicker, { selectedCurrency: 'SOL' }), data).identity,
    ).toBeNull();
    expect(
      verifyAxiomSymbol(snapshot(liveTicker, {}, liveTicker.replace('|USD|', '|SOL|')), data)
        .reason,
    ).toBe('CHART_SYMBOL_RESOLUTION_PENDING');
  });
  it('never maps a visible name, substring or unsupported symbol format to a mint', () => {
    for (const identifier of [
      mint,
      'Minestocks ' + pair,
      'PREFIX:' + liveTicker,
      `${pair}-SOL-123`,
      liveTicker.replace('|1|', '|-1|'),
    ])
      expect(verifyAxiomSymbol(snapshot(identifier), data).identity).toBeNull();
  });
  it('reads a documented raw symbol fallback and whitelists public metadata without custom secrets', () => {
    const result = readAxiomSymbol({
      symbolExt: () => ({ name: 'Minestocks', library_custom_fields: { auth: 'do-not-log' } }),
      symbol: () => liveTicker,
    });
    expect(verifyAxiomSymbol(result, data).status).toBe('PASS');
    expect(JSON.stringify(result)).not.toContain('do-not-log');
  });
});
