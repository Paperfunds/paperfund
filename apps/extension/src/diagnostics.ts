/** Operator-only metadata. Callers must never supply credentials or authentication messages. */
export function operatorDiagnostic(
  event: string,
  details: Record<string, unknown>,
  world = 'ISOLATED',
): void {
  try {
    if (localStorage.getItem('paperfund:debug') !== '1') return;
    const target = window as Window & {
      paperfundDiagnostics?: unknown[];
      paperfundChartDiagnostics?: unknown;
    };
    if (world === 'ISOLATED')
      window.postMessage({ channel: 'paperfund:diagnostic:v1', event, details }, location.origin);
    if (event === 'CHART_HISTORY_STATUS')
      (
        window as Window & { paperfundHistoricalDiagnostics?: unknown }
      ).paperfundHistoricalDiagnostics = details;
    if (event === 'CHART_DIAGNOSIS') {
      const previous = JSON.stringify(target.paperfundChartDiagnostics);
      target.paperfundChartDiagnostics = details;
      if (previous === JSON.stringify(details)) return;
    }
    const events = target.paperfundDiagnostics ?? (target.paperfundDiagnostics = []);
    const record = { event, at: new Date().toISOString(), ...details, world };
    events.push(record);
    if (events.length > 200) events.shift();
    console.debug('[Paperfund diagnostic]', record);
  } catch {
    /* Storage may be blocked; diagnostics must never affect trading or drawing. */
  }
}

/** MAIN-world collector uses the top terminal origin's flag, never iframe/extension storage. */
export function installDiagnosticCollector(): void {
  window.addEventListener('message', (event: MessageEvent) => {
    if (
      event.source !== window ||
      event.origin !== location.origin ||
      event.data?.channel !== 'paperfund:diagnostic:v1'
    )
      return;
    const incoming = event.data;
    if (
      typeof incoming.event !== 'string' ||
      !incoming.details ||
      typeof incoming.details !== 'object'
    )
      return;
    operatorDiagnostic(incoming.event, incoming.details, 'ISOLATED_RELAY');
  });
  operatorDiagnostic(
    'CHART_BRIDGE_READY',
    {
      status: 'PASS',
      frame: 'top',
      flagOrigin: location.origin,
      reason: 'MAIN_CLASSIC_IIFE_STARTED',
    },
    'MAIN',
  );
}
