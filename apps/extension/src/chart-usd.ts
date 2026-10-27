import { chartFxReference } from './chart-fx-reference.js';
import type { PaperfundMarker } from './chart-history.js';
import type { Position, Trade } from '@paperfund/shared/browser';
function decimal(value: bigint, scale = 27) {
  const digits = value.toString().padStart(scale + 1, '0');
  return `${digits.slice(0, -scale)}.${digits.slice(-scale)}`.replace(/0+$/, '').replace(/\.$/, '');
}
/** Chart-only USD basis replay; SOL accounting and persisted fills remain unchanged. */
export function usdAverageEntry(
  trades: readonly Trade[],
  position: Position,
  round: string,
  supply: string | undefined | null,
  supplyDecimals: number | undefined,
): NonNullable<PaperfundMarker['usdEntry']> {
  const fills = trades
    .filter((t) => t.mint_address === position.mint && t.hourly_round_id === round)
    .sort(
      (a, b) => Date.parse(a.executed_at) - Date.parse(b.executed_at) || a.id.localeCompare(b.id),
    );
  let quantity = 0n,
    solBasis = 0n,
    usdBasis: bigint | null = 0n,
    fxReason: string | null = null;
  const fxArchive = fills.filter(fill => fill.sol_usd_fx?.status === 'AVAILABLE');
  const evidence: Record<string, unknown>[] = [];
  let evidenceCount = 0;
  const rejected = (reason: string) => ({
    reason,
    details: {
      reason,
      fills: evidence,
      evidenceTruncated: evidenceCount > evidence.length,
      remainingUsdBasis: usdBasis === null ? null : decimal(usdBasis),
      tokenSupply: supply ?? null,
      quantityBaseUnits: quantity.toString(),
      solBasisLamports: solBasis.toString(),
    },
  });
  for (const fill of fills) {
    if (!/^[1-9]\d*$/.test(fill.base_quantity) || !Number.isFinite(Date.parse(fill.executed_at)))
      return rejected('INVALID_CHART_FILL_HISTORY');
    const amount = BigInt(fill.base_quantity);
    if (fill.side === 'BUY') {
      if (!fill.actual_input_lamports || !/^\d+$/.test(fill.actual_input_lamports))
        return rejected('ACTUAL_BUY_COST_UNAVAILABLE');
      const cost = BigInt(fill.actual_input_lamports);
      const reference = chartFxReference(fill, fxArchive);
      const item: Record<string, unknown> = {
        fillId: fill.id,
        fillTimestamp: fill.executed_at,
        actualSolCostLamports: cost.toString(),
      };
      if ('reason' in reference) {
        usdBasis = null;
        fxReason = reference.reason;
        item.reason = fxReason;
      } else {
        const fx = reference.fx, rate = reference.rateUnits;
        if (usdBasis !== null) usdBasis += cost * rate;
        Object.assign(item, {
          fxReference: reference.provenance,
          fxSource: fx.source,
          fxTimestamp: fx.fxAt,
          solUsd: fx.rate,
          fxVersion: fx.version,
          sourceObservationId: fx.sourceObservationId ?? null,
          usdAcquisitionCost: decimal(cost * rate),
          evidenceHash: fx.responseHash,
        });
      }
      quantity += amount;
      solBasis += cost;
      evidenceCount++;
      if (evidence.length < 100) evidence.push(item);
    } else {
      if (amount > quantity || quantity === 0n) return rejected('INCOMPLETE_POSITION_FILL_HISTORY');
      const removed = (solBasis * amount) / quantity;
      if (
        fill.cost_basis_lamports_removed !== undefined &&
        fill.cost_basis_lamports_removed !== removed.toString()
      )
        return rejected('CHART_SOL_BASIS_RECONCILIATION_FAILED');
      if (usdBasis !== null) usdBasis -= (usdBasis * amount) / quantity;
      solBasis -= removed;
      quantity -= amount;
      if (quantity === 0n) {
        usdBasis = 0n;
        solBasis = 0n;
        fxReason = null;
        evidence.length = 0;
        evidenceCount = 0;
      }
    }
  }
  if (quantity === 0n) return rejected('NO_OPEN_POSITION');
  if (
    quantity.toString() !== position.tokenQuantityBaseUnits ||
    solBasis.toString() !== position.costBasisPaperSolLamports
  )
    return rejected('POSITION_HISTORY_RECONCILIATION_PENDING');
  if (usdBasis === null) return rejected(fxReason ?? 'HISTORICAL_SOL_USD_UNAVAILABLE');
  if (!supply || !/^[1-9]\d*$/.test(supply)) return rejected('AUTHORITATIVE_SUPPLY_UNAVAILABLE');
  if (!Number.isInteger(supplyDecimals) || supplyDecimals !== position.tokenDecimals)
    return rejected('TOKEN_DECIMALS_MISMATCH');
  const cap = decimal((usdBasis * BigInt(supply)) / quantity);
  const price = decimal((usdBasis * 10n ** BigInt(position.tokenDecimals)) / quantity);
  return {
    marketCapUsd: cap,
    priceUsd: price,
    details: {
      fills: evidence,
      remainingUsdBasis: decimal(usdBasis),
      remainingSolBasisLamports: solBasis.toString(),
      remainingQuantityBaseUnits: quantity.toString(),
      tokenSupply: supply,
      tokenDecimals: position.tokenDecimals,
      marketCapUsd: cap,
    },
  };
}
