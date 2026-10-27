import { chartFxReference, type ChartFxReference } from './chart-fx-reference.js';
import type { Trade } from '@paperfund/shared/browser';
export interface HistoricalDrawing {
  id: string;
  ownerId: string;
  accountId: string;
  roundId: string;
  mint: string;
  cycleId: string;
  kind: 'BUY_AVG' | 'SELL_AVG' | 'BUY' | 'SELL';
  levelUsd: string;
  time: number;
  label: string;
}
export interface UnavailableHistoricalDrawing {
  fillId: string;
  side: string;
  accountId: string | null;
  roundId: string;
  executedAt: string;
  cycleId?: string;
  kind: HistoricalDrawing['kind'];
  reason: string;
}
export interface TradeHistoryPlan {
  ownerId: string;
  mint: string;
  visible: boolean;
  drawings: HistoricalDrawing[];
  diagnostics: {
    metadataReason?: string;
    executionSupported?: boolean;
    supplyConvention?: 'EXECUTION_TIME_QUANTITY_WEIGHTED_CAP';
    fills: number;
    cycles: number;
    displayedCycles: number;
    omittedMarkers: number;
    unavailable: string[];
    unavailableDrawings?: UnavailableHistoricalDrawing[];
    tokenSupplyBaseUnits?: string | null;
    tokenDecimals?: number;
    fxReferences?: ChartFxReference['provenance'][];
    averages?: {
      cycleId: string;
      roundId: string;
      accountId: string;
      side: string;
      usdAmount: string;
      quantity: string;
      levelUsd: string;
    }[];
  };
}
function decimal(n: bigint) {
  const s = n.toString().padStart(28, '0');
  return `${s.slice(0, -27)}.${s.slice(-27)}`.replace(/0+$/, '').replace(/\.$/, '');
}
function usdCost(fill: Trade, archive: readonly Trade[]) {
  const reference = chartFxReference(fill, archive);
  if ('reason' in reference) return reference;
  const amount = fill.side === 'BUY' ? fill.actual_input_lamports : fill.actual_output_lamports;
  if (!amount || !/^\d+$/.test(amount) || BigInt(amount) <= 0n)
    return { reason: 'ACTUAL_FILL_SOL_AMOUNT_UNAVAILABLE' };
  return { cost: BigInt(amount) * reference.rateUnits, provenance: reference.provenance };
}
/** Read-only, quantity-based cycles. No synthetic fills or mutable cycle table. */
export function historicalTrades(
  trades: readonly Trade[],
  ownerId: string,
  mint: string,
  supply: string | null | undefined,
  decimals: number | undefined,
  visible = true,
): TradeHistoryPlan {
  const plan: TradeHistoryPlan = {
    ownerId,
    mint,
    visible,
    drawings: [],
    diagnostics: {
      supplyConvention: 'EXECUTION_TIME_QUANTITY_WEIGHTED_CAP',
      fills: 0,
      cycles: 0,
      displayedCycles: 0,
      omittedMarkers: 0,
      unavailable: [],
      unavailableDrawings: [],
      averages: [],
      fxReferences: [],
    },
  };
  const unavailable = new Set<string>();
  const report = (fills: readonly Trade[], reason: string, cycleId?: string) => {
    unavailable.add(reason);
    for (const f of fills)
      for (const kind of [f.side, f.side + '_AVG'] as HistoricalDrawing['kind'][]) {
        plan.diagnostics.unavailableDrawings!.push({
          fillId: f.id,
          side: f.side,
          accountId: f.competition_account_id ?? null,
          roundId: f.hourly_round_id,
          executedAt: f.executed_at,
          ...(cycleId ? { cycleId } : {}),
          kind,
          reason,
        });
      }
  };
  const cycles: {
    id: string;
    accountId: string;
    roundId: string;
    fills: Trade[];
    remaining: bigint;
  }[] = [];
  const groups = new Map<string, Trade[]>();
  const unique = new Map<string, Trade>();
  for (const fill of trades)
    if (fill.mint_address === mint && (fill.side === 'BUY' || fill.side === 'SELL')) {
      if (fill.owner_user_id !== ownerId) {
        report([fill], 'HISTORICAL_OWNER_SCOPE_MISMATCH');
        continue;
      }
      unique.set(fill.id, fill);
    }
  plan.diagnostics.fills = unique.size;
  if (unique.size === 0) {
    plan.diagnostics.unavailable = [...unavailable];
    return plan;
  }
  for (const fill of unique.values()) {
    if (fill.owner_user_id !== ownerId) {
      report([fill], 'HISTORICAL_OWNER_SCOPE_MISMATCH');
      continue;
    }
    if (!fill.competition_account_id) {
      report([fill], 'HISTORICAL_ACCOUNT_SCOPE_UNAVAILABLE');
      continue;
    }
    const key = JSON.stringify([fill.competition_account_id, fill.hourly_round_id]);
    groups.set(key, [...(groups.get(key) ?? []), fill]);
  }
  for (const fills of groups.values()) {
    const cycleStart = cycles.length;
    let incomplete = false;
    fills.sort(
      (a, b) => Date.parse(a.executed_at) - Date.parse(b.executed_at) || a.id.localeCompare(b.id),
    );
    if (
      fills.some(
        (f, i) =>
          !Number.isFinite(Date.parse(f.executed_at)) ||
          (i > 0 && f.executed_at === fills[i - 1]!.executed_at),
      )
    ) {
      report(
        fills,
        fills.some((f) => !Number.isFinite(Date.parse(f.executed_at)))
          ? 'INVALID_FILL_TIMESTAMP'
          : 'AMBIGUOUS_FILL_ORDER',
      );
      continue;
    }
    let cycle: (typeof cycles)[number] | undefined;
    for (const fill of fills) {
      if (!/^[1-9]\d*$/.test(fill.base_quantity)) {
        report(fills, 'INVALID_FILL_QUANTITY');
        incomplete = true;
        break;
      }
      const q = BigInt(fill.base_quantity);
      if (fill.side === 'BUY') {
        if (!cycle || cycle.remaining === 0n) {
          cycle = {
            id: fill.id,
            accountId: fill.competition_account_id!,
            roundId: fill.hourly_round_id,
            fills: [],
            remaining: 0n,
          };
          cycles.push(cycle);
        }
        cycle.remaining += q;
      } else if (fill.side === 'SELL') {
        if (!cycle || q > cycle.remaining) {
          report(fills, 'INCOMPLETE_CYCLE_HISTORY');
          cycle = undefined;
          incomplete = true;
          break;
        }
        cycle.remaining -= q;
      } else continue;
      cycle!.fills.push(fill);
    }
    if (incomplete) {
      cycles.splice(cycleStart);
      continue;
    }
    // Forced write-offs occur during closing; apply actual journal quantities to the final cycle only.
    const closures = new Map(fills.flatMap((f) => f.chart_closures ?? []).map((c) => [c.id, c]));
    if (cycle)
      for (const closure of closures.values()) {
        if (
          !closure.quantity ||
          !/^\d+$/.test(closure.quantity) ||
          BigInt(closure.quantity) > cycle.remaining
        ) {
          report(cycle.fills, 'FORCED_CLOSURE_EVIDENCE_UNAVAILABLE', cycle.id);
          continue;
        }
        cycle.remaining -= BigInt(closure.quantity);
      }
  }
  cycles.sort((a, b) => Date.parse(a.fills[0]!.executed_at) - Date.parse(b.fills[0]!.executed_at));
  plan.diagnostics.cycles = cycles.length;
  const selected = cycles.slice(-3);
  plan.diagnostics.displayedCycles = selected.length;
  // Current supply is diagnostic only. Every historical level uses its immutable fill supply.
  plan.diagnostics.tokenSupplyBaseUnits = supply ?? null;
  if (decimals !== undefined) plan.diagnostics.tokenDecimals = decimals;
  if (decimals === undefined || !Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
    report(selected.flatMap((c) => c.fills), decimals === undefined
      ? 'CHART_TOKEN_METADATA_MISSING' : 'INVALID_TOKEN_DECIMALS');
    plan.diagnostics.unavailable = [...unavailable];
    return plan;
  }
  for (const cycle of selected) {
    const fxArchive = cycle.fills.filter(fill => fill.sol_usd_fx?.status === 'AVAILABLE');
    const scope = {
      ownerId,
      accountId: cycle.accountId,
      roundId: cycle.roundId,
      mint,
      cycleId: cycle.id,
    };
    const stamp = cycle.fills[0]!.executed_at.slice(5, 16).replace('T', ' ') + 'Z';
    const fillDrawings: HistoricalDrawing[] = [];
    for (const side of ['BUY', 'SELL'] as const) {
      const sideFills = cycle.fills.filter((f) => f.side === side);
      if (!sideFills.length) continue;
      let totalCapCost = 0n, totalCost = 0n,
        totalQuantity = 0n,
        valid = true;
      for (const fill of sideFills) {
        const cost = usdCost(fill, fxArchive);
        if (fill.token_decimals !== decimals) {
          valid = false;
          report([fill], 'TOKEN_DECIMALS_MISMATCH', cycle.id);
          continue;
        }
        if ('reason' in cost) {
          valid = false;
          report([fill], cost.reason, cycle.id);
          continue;
        }
        plan.diagnostics.fxReferences!.push(cost.provenance!);
        const archivedSupply = fill.token_supply_base_units;
        if (!archivedSupply || !/^[1-9]\d*$/.test(archivedSupply) || BigInt(archivedSupply) < BigInt(fill.base_quantity)) {
          valid = false;
          report([fill], 'HISTORICAL_SUPPLY_UNAVAILABLE_OR_INCOMPATIBLE', cycle.id);
          continue;
        }
        const supplyUnits = BigInt(archivedSupply);
        const q = BigInt(fill.base_quantity);
        totalCapCost += cost.cost * supplyUnits;
        totalCost += cost.cost;
        totalQuantity += q;
        fillDrawings.push({
          ...scope,
          id: JSON.stringify([cycle.accountId, cycle.roundId, fill.id, 'execution']),
          kind: side,
          levelUsd: decimal((cost.cost * supplyUnits) / q),
          time: Math.floor(Date.parse(fill.executed_at) / 1000),
          label: 'PF ' + side,
        });
      }
      if (valid && totalQuantity > 0n) {
        plan.diagnostics.averages!.push({
          cycleId: cycle.id,
          roundId: cycle.roundId,
          accountId: cycle.accountId,
          side,
          usdAmount: decimal(totalCost),
          quantity: totalQuantity.toString(),
          levelUsd: decimal(totalCapCost / totalQuantity),
        });
        plan.drawings.push({
          ...scope,
          id: JSON.stringify([cycle.accountId, cycle.roundId, cycle.id, side + '_AVG']),
          kind: side === 'BUY' ? 'BUY_AVG' : 'SELL_AVG',
          levelUsd: decimal(totalCapCost / totalQuantity),
          time: Math.floor(Date.parse(cycle.fills[0]!.executed_at) / 1000),
          label: 'PF ' + side + ' AVG · ' + stamp,
        });
      }
    }
    fillDrawings.sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
    plan.diagnostics.omittedMarkers += Math.max(0, fillDrawings.length - 50);
    plan.drawings.push(...fillDrawings.slice(-50));
  }
  plan.diagnostics.unavailable = [...unavailable];
  return plan;
}
