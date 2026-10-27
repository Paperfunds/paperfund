import type { ChartMarkers } from './chart-marker.js';
import type { PaperfundMarker } from './chart-history.js';
import { AxiomNativeAverage } from './axiom-native.js';
import { GmgnLightweightDrawings } from './gmgn-lightweight.js';
import { operatorDiagnostic } from './diagnostics.js';

export interface NativeChart {
  symbolExt(): { ticker?: string; name?: string; currency_code?: string; unit_id?: string } | null;
  createShape(
    point: { price: number; time: number },
    options: Record<string, unknown>,
  ): Promise<string>;
  removeEntity(id: string): void;
}

/** No USD/market-cap conversion or guessed pixel scale is allowed. */
export function matchesSolPriceChart(chart: NativeChart, mint: string): boolean {
  const symbol = chart.symbolExt();
  return Boolean(
    symbol &&
    (symbol.ticker === mint || symbol.name === mint) &&
    symbol.currency_code === 'SOL' &&
    symbol.unit_id === 'price',
  );
}

export function markerShape(marker: PaperfundMarker) {
  return {
    shape: 'horizontal_line',
    text:
      marker.kind === 'AVERAGE'
        ? 'PAPERFUND AVG ENTRY'
        : marker.kind === 'BUY'
          ? 'PAPERFUND BUY'
          : 'PAPERFUND SELL / EXIT',
    lock: true,
    disableSelection: true,
    disableSave: true,
    disableUndo: true,
    overrides: {
      linecolor: marker.kind === 'SELL' ? '#aab5b8' : '#74e6aa',
      linewidth: 1,
      linestyle: marker.kind === 'AVERAGE' ? 0 : 2,
      showLabel: true,
      showPrice: true,
      fontsize: 9,
    },
  };
}

export function installChartBridge(): void {
  const host = window as Window & { paperfundChartBridgeCleanup?: () => void };
  host.paperfundChartBridgeCleanup?.();
  const gmgn = location.hostname === 'gmgn.ai' ? new GmgnLightweightDrawings() : null;
  const axiom = new AxiomNativeAverage(() => {
    window.setTimeout(() => {
      void update();
    }, 0);
  });
  const channel = 'paperfund:chart:v1';
  let data: ChartMarkers | null = null;
  let terminalContext: { terminal: string; context: string; url: string } | null = null;
  let chart: NativeChart | null = null;
  const entities = new Map<string, { id: string; fingerprint: string }>();
  let busy = false;
  let generation = 0;
  let lastStatus = '';
  const clear = () => {
    gmgn?.invalidate();
    axiom.invalidate('BRIDGE_CONTEXT_CLEARED');
    generation += 1;
    for (const entity of entities.values()) {
      try {
        chart?.removeEntity(entity.id);
      } catch {
        /* chart disposed by host */
      }
    }
    entities.clear();
    chart = null;
  };
  const locate = (): NativeChart | null => {
    const candidates: Window[] = [window];
    for (const iframe of document.querySelectorAll<HTMLIFrameElement>(
      'iframe[title="Financial Chart"]',
    )) {
      if (iframe.contentWindow) candidates.push(iframe.contentWindow);
    }
    for (const candidate of candidates) {
      try {
        const widget = (candidate as Window & { tvWidget?: { activeChart(): NativeChart } })
          .tvWidget;
        const api = widget?.activeChart();
        if (
          api &&
          typeof api.symbolExt === 'function' &&
          typeof api.createShape === 'function' &&
          typeof api.removeEntity === 'function' &&
          data &&
          matchesSolPriceChart(api, data.mint)
        )
          return api;
      } catch {
        /* inaccessible frame or host API not ready */
      }
    }
    return null;
  };
  const update = async () => {
    if (busy) return;
    if (!data || data.url !== location.href) {
      clear();
      return;
    }
    if (location.hostname === 'gmgn.ai') {
      const status = gmgn!.render(data);
      const signature = JSON.stringify([data.context, status]);
      let missingDiagnostic = false;
      try {
        const records = (window as Window & { paperfundDiagnostics?: {
          event?: string; context?: string; mint?: string; world?: string;
        }[] }).paperfundDiagnostics;
        missingDiagnostic = localStorage.getItem('paperfund:debug') === '1' &&
          !records?.some(record => record?.event === 'GMGN_CHART_STATUS' &&
            record.context === data!.context && record.mint === data!.mint && record.world === 'MAIN');
      } catch {
        /* Diagnostic storage must never interrupt chart status delivery. */
      }
      if (signature !== lastStatus || missingDiagnostic) {
        operatorDiagnostic('GMGN_CHART_STATUS', {
          context: data.context, mint: data.mint, ...status, visualAcceptance: 'PENDING',
        }, 'MAIN');
        lastStatus = signature;
      }
      window.postMessage({ channel, direction: 'STATUS', context: data.context, ...status }, location.origin);
      return;
    }
    gmgn?.invalidate();
    const api = location.hostname === 'axiom.trade' ? null : locate();
    if (chart !== api) clear();
    chart = api;
    if (!api) {
      busy = true;
      const input = data;
      let status;
      try {
        status =
          location.hostname === 'axiom.trade'
            ? await axiom.render(input)
            : { available: false, reason: 'NATIVE_CHART_UNAVAILABLE', drawn: 0 };
      } finally {
        busy = false;
      }
      if (!data || data !== input || input.url !== location.href) return;
      const signature = JSON.stringify([data.context, status]);
      if (signature !== lastStatus) {
        operatorDiagnostic(
          'CHART_LINE_STATUS',
          {
            context: data.context,
            mint: data.mint,
            markerCount: data.markers.length,
            ...status,
          },
          'MAIN',
        );
        lastStatus = signature;
      }
      window.postMessage(
        { channel, direction: 'STATUS', context: data.context, ...status },
        location.origin,
      );
      return;
    }
    busy = true;
    const version = generation;
    try {
      const desired = new Set(data.markers.map((marker) => marker.id));
      for (const [key, entity] of entities)
        if (!desired.has(key)) {
          api.removeEntity(entity.id);
          entities.delete(key);
        }
      for (const marker of data.markers) {
        const fingerprint = JSON.stringify(marker);
        const previous = entities.get(marker.id);
        if (previous?.fingerprint === fingerprint) continue;
        if (previous) {
          api.removeEntity(previous.id);
          entities.delete(marker.id);
        }
        const price = Number(marker.priceSol); // Host rendering only; never execution/accounting.
        if (!Number.isFinite(price) || price <= 0) continue;
        const id = await api.createShape(
          { price, time: marker.time || Math.floor(Date.now() / 1000) },
          markerShape(marker),
        );
        if (generation !== version || data?.url !== location.href) {
          api.removeEntity(id);
          break;
        }
        entities.set(marker.id, { id, fingerprint });
      }
      if (generation === version && data)
        window.postMessage(
          { channel, direction: 'STATUS', context: data.context, available: true },
          location.origin,
        );
    } catch {
      if (data)
        window.postMessage(
          { channel, direction: 'STATUS', context: data.context, available: false },
          location.origin,
        );
      clear();
    } finally {
      busy = false;
    }
  };
  const receive = (event: MessageEvent) => {
    if (
      event.source !== window ||
      event.origin !== location.origin ||
      event.data?.channel !== channel ||
      !['UPDATE', 'CONTEXT'].includes(event.data?.direction)
    )
      return;
    const incoming = event.data.value;
    if (event.data.direction === 'CONTEXT') {
      if (incoming === null) {
        terminalContext = null;
        data = null;
        clear();
        return;
      }
      if (
        typeof incoming?.terminal !== 'string' ||
        typeof incoming.context !== 'string' ||
        typeof incoming.url !== 'string' ||
        incoming.url !== location.href
      )
        return;
      if (
        (terminalContext &&
          (terminalContext.url !== incoming.url || terminalContext.context !== incoming.context)) ||
        (data && (data.url !== incoming.url || data.context !== incoming.context))
      ) {
        data = null;
        clear();
      }
      terminalContext = {
        terminal: incoming.terminal,
        context: incoming.context,
        url: incoming.url,
      };
      operatorDiagnostic(
        'CHART_TERMINAL_CONTEXT_RECEIVED',
        {
          ...terminalContext,
          status: 'PASS',
          expectedMintSource: 'OVERLAY_BACKEND_MARKET_PENDING',
        },
        'MAIN',
      );
      return;
    }

    if (incoming === null) {
      data = null;
      clear();
      return;
    }
    if (
      typeof incoming?.context !== 'string' ||
      typeof incoming?.url !== 'string' ||
      typeof incoming?.mint !== 'string' ||
      !Array.isArray(incoming?.markers)
    )
      return;
    if (
      !incoming.markers.every(
        (m: PaperfundMarker) =>
          m &&
          typeof m.id === 'string' &&
          ['AVERAGE', 'BUY', 'SELL'].includes(m.kind) &&
          typeof m.priceSol === 'string' &&
          /^\d+(\.\d+)?$/.test(m.priceSol) &&
          (m.marketCapSol === undefined ||
            (typeof m.marketCapSol === 'string' && /^\d+(\.\d+)?$/.test(m.marketCapSol))) &&
          (m.solUsd === undefined ||
            (typeof m.solUsd === 'string' && /^\d+(\.\d+)?$/.test(m.solUsd))) &&
          (m.usdEntry === undefined ||
            (m.usdEntry &&
              typeof m.usdEntry === 'object' &&
              (m.usdEntry.reason === undefined || typeof m.usdEntry.reason === 'string') &&
              (m.usdEntry.marketCapUsd === undefined ||
                /^\d+(\.\d+)?$/.test(m.usdEntry.marketCapUsd)) &&
              (m.usdEntry.priceUsd === undefined || /^\d+(\.\d+)?$/.test(m.usdEntry.priceUsd)) &&
              m.usdEntry.details &&
              typeof m.usdEntry.details === 'object')) &&
          Number.isFinite(m.time),
      )
    )
      return;
    if (
      incoming.history !== undefined &&
      (incoming.ownerId !== incoming.history?.ownerId ||
        incoming.mint !== incoming.history?.mint ||
        typeof incoming.history.visible !== 'boolean' ||
        !Array.isArray(incoming.history.drawings) ||
        incoming.history.drawings.length > 156 ||
        !incoming.history.drawings.every(
          (d: Record<string, unknown>) =>
            d.ownerId === incoming.ownerId &&
            d.mint === incoming.mint &&
            typeof d.id === 'string' &&
            typeof d.cycleId === 'string' &&
            typeof d.accountId === 'string' &&
            typeof d.roundId === 'string' &&
            ['BUY_AVG', 'SELL_AVG', 'BUY', 'SELL'].includes(String(d.kind)) &&
            typeof d.levelUsd === 'string' &&
            /^\d+(\.\d+)?$/.test(d.levelUsd) &&
            Number.isSafeInteger(d.time) &&
            typeof d.label === 'string',
        ))
    )
      return;
    if (
      incoming.marketBinding !== undefined &&
      (incoming.marketBinding?.requestedContext !== incoming.context ||
        incoming.marketBinding?.mint !== incoming.mint ||
        (incoming.marketBinding.marketId !== undefined &&
          typeof incoming.marketBinding.marketId !== 'string'))
    ) {
      operatorDiagnostic(
        'CHART_UPDATE_REJECTED',
        { reason: 'INVALID_MARKET_MINT_BINDING' },
        'MAIN',
      );
      return;
    }
    if (
      incoming.url !== location.href ||
      (terminalContext &&
        (incoming.context !== terminalContext.context || incoming.url !== terminalContext.url))
    ) {
      operatorDiagnostic(
        'CHART_UPDATE_REJECTED',
        { reason: 'STALE_TERMINAL_CONTEXT', context: incoming.context },
        'MAIN',
      );
      return;
    }
    operatorDiagnostic(
      'CHART_UPDATE_RECEIVED',
      {
        status: 'PASS',
        context: incoming.context,
        expectedMint: incoming.mint,
        expectedMintSource: 'OVERLAY_BACKEND_MARKET',
        markerCount: incoming.markers.length,
        averageCount: incoming.markers.filter(
          (marker: PaperfundMarker) => marker.kind === 'AVERAGE',
        ).length,
      },
      'MAIN',
    );
    if (
      incoming.context !== data?.context ||
      incoming.mint !== data?.mint ||
      incoming.ownerId !== data?.ownerId
    )
      clear();
    else if (
      JSON.stringify(incoming.markers) !== JSON.stringify(data?.markers) ||
      JSON.stringify(incoming.marketBinding) !== JSON.stringify(data?.marketBinding)
    )
      axiom.invalidate('POSITION_MARKERS_CHANGED');
    generation += 1;
    data = incoming;
    void update();
  };
  window.addEventListener('message', receive);
  let lastProbe = 0;
  let lastChartCheck = 0;
  const poll = window.setInterval(() => {
    if (data) {
      // Host symbol events and backend updates refresh immediately. Poll only for host disposal/missed events.
      const interval = axiom.hasSymbolEvents ? 500 : 100;
      if (Date.now() - lastChartCheck >= interval) {
        lastChartCheck = Date.now();
        void update();
      }
    } else {
      try {
        if (
          location.hostname === 'axiom.trade' &&
          localStorage.getItem('paperfund:debug') === '1' &&
          Date.now() - lastProbe > 2000 &&
          !busy
        ) {
          lastProbe = Date.now();
          operatorDiagnostic(
            'CHART_INPUT_UNAVAILABLE',
            {
              status: 'UNAVAILABLE',
              reason:
                terminalContext?.url === location.href
                  ? 'BACKEND_RESOLVED_MINT_OR_MARKERS_PENDING'
                  : 'NO_CURRENT_TERMINAL_CONTEXT_MESSAGE',
              flagOrigin: location.origin,
            },
            'MAIN',
          );
          // Read-only context probe; an empty mint cannot authorize a drawing.
          busy = true;
          void axiom
            .render({
              url: location.href,
              context: terminalContext?.url === location.href ? terminalContext.context : '',
              mint: null,
              markers: [],
            })
            .finally(() => {
              busy = false;
            });
        }
      } catch {
        /* Blocked storage must never affect chart or trading. */
      }
    }
  }, 100);
  host.paperfundChartBridgeCleanup = () => {
    window.removeEventListener('message', receive);
    window.clearInterval(poll);
    data = null;
    clear();
  };
}
