import type { TradeHistoryPlan } from './trade-history-chart.js';
import { useEffect } from 'react';
import type { PaperfundMarker } from './chart-history.js';
import type { TerminalId } from './terminal.js';
import { operatorDiagnostic } from './diagnostics.js';

export function findTerminalChart(terminal: TerminalId): Element | null {
  const selector =
    terminal === 'GMGN'
      ? 'iframe[title="Financial Chart"], iframe[id^="tradingview_"]'
      : 'iframe[title="Financial Chart"], [data-testid="chart-container"]';
  return (
    [...document.querySelectorAll(selector)].find((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width >= 280 && rect.height >= 180;
    }) ?? null
  );
}

export interface ChartMarkers {
  url: string;
  context: string;
  mint: string;
  markers: PaperfundMarker[];
  ownerId?: string;
  history?: TradeHistoryPlan;
  marketBinding?: { requestedContext: string; mint: string; marketId?: string };
}

/** Main-world Axiom overlay calibrates the host scale; execution remains server-only. */
export function ChartAverageMarker({ value }: { value: ChartMarkers }) {
  useEffect(() => {
    let acknowledged = false;
    const receive = (event: MessageEvent) => {
      if (
        event.source === window &&
        event.origin === location.origin &&
        event.data?.channel === 'paperfund:chart:v1' &&
        event.data.direction === 'STATUS' &&
        event.data.context === value.context
      )
        acknowledged = true;
    };
    window.addEventListener('message', receive);
    operatorDiagnostic('CHART_UPDATE_SENT', {
      context: value.context,
      mint: value.mint,
      markerCount: value.markers.length,
      averageCount: value.markers.filter((marker) => marker.kind === 'AVERAGE').length,
    });
    const timeout = window.setTimeout(() => {
      if (!acknowledged)
        operatorDiagnostic('CHART_BRIDGE_ACK', {
          status: 'FAIL',
          reason: 'MAIN_BRIDGE_STATUS_TIMEOUT',
          context: value.context,
        });
    }, 3000);
    window.postMessage(
      { channel: 'paperfund:chart:v1', direction: 'UPDATE', value },
      location.origin,
    );
    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener('message', receive);
    };
  }, [value]);
  useEffect(
    () => () => {
      window.postMessage(
        { channel: 'paperfund:chart:v1', direction: 'UPDATE', value: null },
        location.origin,
      );
    },
    [],
  );
  return null;
}
