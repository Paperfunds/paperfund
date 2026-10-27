import type { Trade, Position } from '@paperfund/shared/browser';

export function tokenTradeSummary(
  trades: readonly Trade[],
  mint: string,
  roundId: string,
  position?: Position,
) {
  const fills = trades.filter((t) => t.mint_address === mint && t.hourly_round_id === roundId);
  const buys = fills.filter((t) => t.side === 'BUY');
  const bought = buys.every(
    (t) => typeof t.actual_input_lamports === 'string' && /^\d+$/.test(t.actual_input_lamports),
  )
    ? buys.reduce((sum, t) => sum + BigInt(t.actual_input_lamports!), 0n)
    : null;
  const sells = fills.filter((t) => t.side === 'SELL');
  const sold = sells.every(
    (t) => typeof t.actual_output_lamports === 'string' && /^\d+$/.test(t.actual_output_lamports),
  )
    ? sells.reduce((sum, t) => sum + BigInt(t.actual_output_lamports!), 0n)
    : null;
  const realized =
    position && /^-?\d+$/.test(position.realizedPnlLamports)
      ? BigInt(position.realizedPnlLamports)
      : fills.every(
            (t) =>
              typeof t.realized_pnl_lamports === 'string' &&
              /^-?\d+$/.test(t.realized_pnl_lamports),
          )
        ? fills.reduce((sum, t) => sum + BigInt(t.realized_pnl_lamports), 0n)
        : null;
  const unrealized = position
    ? position.valuation.status === 'AVAILABLE'
      ? BigInt(position.valuation.unrealizedPnlLamports)
      : null
    : 0n;
  return {
    bought,
    sold,
    holdingValue: position
      ? position.valuation.status === 'AVAILABLE'
        ? BigInt(position.valuation.executablePaperSolLamports)
        : null
      : 0n,
    pnl: unrealized === null || realized === null ? null : realized + unrealized,
  };
}

export interface PaperfundMarker {
  id: string;
  kind: 'AVERAGE' | 'BUY' | 'SELL';
  priceSol: string;
  marketCapSol?: string | undefined;
  solUsd?: string | undefined;
  usdEntry?: {
    marketCapUsd?: string;
    priceUsd?: string;
    reason?: string;
    details: Record<string, unknown>;
  };
  time: number;
}

/** Display price only: exact persisted net fill amounts, never a host price. */
export function fillMarkers(trades: readonly Trade[]): PaperfundMarker[] {
  return trades.flatMap((trade) => {
    if (
      !Number.isInteger(trade.token_decimals) ||
      trade.token_decimals! < 0 ||
      trade.token_decimals! > 18
    )
      return [];
    const sol = trade.side === 'BUY' ? trade.actual_input_lamports : trade.actual_output_lamports;
    if (!sol || !/^[0-9]+$/.test(sol) || !/^[1-9][0-9]*$/.test(trade.base_quantity)) return [];
    const scaled =
      (BigInt(sol) * 10n ** BigInt(trade.token_decimals!) * 10n ** 30n) /
      (BigInt(trade.base_quantity) * 1_000_000_000n);
    if (scaled <= 0n) return [];
    const time = Date.parse(trade.executed_at) / 1000;
    if (!Number.isFinite(time)) return [];
    const digits = scaled.toString().padStart(31, '0');
    return [
      {
        id: trade.id,
        kind: trade.side,
        priceSol: `${digits.slice(0, -30)}.${digits.slice(-30)}`
          .replace(/0+$/, '')
          .replace(/\.$/, ''),
        ...(trade.token_supply_base_units
          ? {
              marketCapSol:
                marketCapSol(
                  `${digits.slice(0, -30)}.${digits.slice(-30)}`,
                  trade.token_supply_base_units,
                  trade.token_decimals!,
                ) ?? undefined,
            }
          : {}),
        time,
        ...(trade.sol_usd_at_execution ? { solUsd: trade.sol_usd_at_execution } : {}),
      },
    ];
  });
}

export function marketCapSol(priceSol: string, supply: string, decimals: number): string | null {
  if (
    !/^\d+(\.\d+)?$/.test(priceSol) ||
    !/^[1-9]\d*$/.test(supply) ||
    !Number.isInteger(decimals) ||
    decimals < 0 ||
    decimals > 18
  )
    return null;
  const [whole = '0', fraction = ''] = priceSol.split('.');
  const precision = fraction.length + decimals;
  const value = (BigInt(whole + fraction) * BigInt(supply)).toString().padStart(precision + 1, '0');
  return precision
    ? `${value.slice(0, -precision)}.${value.slice(-precision)}`
        .replace(/0+$/, '')
        .replace(/\.$/, '')
    : value;
}

/** Remaining USD cost/SOL cost ratio, with proportional basis-removal semantics. */
export function averageEntryFx(
  trades: readonly Trade[],
  mint: string,
  round: string,
): string | undefined {
  let quantity = 0n,
    solCost = 0n,
    usdCost = 0n;
  const fills = trades
    .filter((t) => t.mint_address === mint && t.hourly_round_id === round)
    .sort(
      (a, b) => Date.parse(a.executed_at) - Date.parse(b.executed_at) || a.id.localeCompare(b.id),
    );
  for (const fill of fills) {
    const amount = BigInt(fill.base_quantity);
    if (fill.side === 'BUY') {
      const fx = fill.sol_usd_at_execution;
      if (!fx || !/^\d+(\.\d+)?$/.test(fx) || !fill.actual_input_lamports) return undefined;
      const [whole = '0', fraction = ''] = fx.split('.');
      const rate = BigInt(whole) * 10n ** 18n + BigInt(fraction.slice(0, 18).padEnd(18, '0'));
      const cost = BigInt(fill.actual_input_lamports);
      solCost += cost;
      usdCost += cost * rate;
      quantity += amount;
    } else {
      if (amount > quantity || quantity === 0n) return undefined;
      solCost -= (solCost * amount) / quantity;
      usdCost -= (usdCost * amount) / quantity;
      quantity -= amount;
    }
  }
  if (solCost <= 0n || quantity <= 0n) return undefined;
  const digits = (usdCost / solCost).toString().padStart(19, '0');
  return `${digits.slice(0, -18)}.${digits.slice(-18)}`;
}
