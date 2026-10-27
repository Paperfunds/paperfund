import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { installChartBridge } from './chart-native.js';

const url = 'https://axiom.trade/meme/pool?chain=sol';
let receive: (event: MessageEvent) => void;
let probe: () => void;
let createShape: ReturnType<typeof vi.fn>;
let removeEntity: ReturnType<typeof vi.fn>;
let post: MockInstance<typeof window.postMessage>;
function send(direction: string, value: unknown, origin = 'https://axiom.trade') {
  receive(
    new MessageEvent('message', {
      source: window,
      origin,
      data: { channel: 'paperfund:chart:v1', direction, value },
    }),
  );
}
const context = { terminal: 'AXIOM', context: 'pool', url };
const input = {
  context: 'pool',
  mint: 'mint',
  url,
  markers: [
    { id: 'average', kind: 'AVERAGE', priceSol: '0.0000243', marketCapSol: '24300', time: 0 },
  ],
};
async function flush() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}
function diagnosis() {
  return (
    window as Window & {
      paperfundChartDiagnostics?: {
        expectedMint: string | null;
        firstFailure: string;
        stages: unknown[];
      };
    }
  ).paperfundChartDiagnostics!;
}
beforeEach(() => {
  vi.stubGlobal('location', {
    href: url,
    origin: 'https://axiom.trade',
    hostname: 'axiom.trade',
    pathname: '/meme/pool',
  });
  localStorage.setItem('paperfund:debug', '1');
  vi.spyOn(console, 'debug').mockImplementation(() => {});
  vi.spyOn(window, 'addEventListener').mockImplementation((name, callback) => {
    if (name === 'message') receive = callback as (event: MessageEvent) => void;
  });
  vi.spyOn(window, 'setInterval').mockImplementation((callback) => {
    probe = callback as () => void;
    return 1;
  });
  post = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
  const frame = document.createElement('iframe');
  frame.title = 'Financial Chart';
  document.body.append(frame);
  frame.getBoundingClientRect = () => ({ width: 700, height: 400 }) as DOMRect;
  frame.contentDocument!.body.innerHTML =
    '<button><span style="color:#9aa3af">USD</span>/<span style="color:#526fff">SOL</span></button><button><span style="color:#526fff">MarketCap</span>/<span style="color:#9aa3af">Price</span></button>';
  const ids = new Set<string>();
  createShape = vi.fn(async () => {
    ids.add('pf');
    return 'pf';
  });
  removeEntity = vi.fn((id: string) => ids.delete(id));
  Object.assign(frame.contentWindow!, {
    tradingViewApi: {
      activeChart: () => ({
        symbolExt: () => ({ ticker: 'axiom-chart-v1|pair|sol|SOL|1|pool|mint' }),
        createShape,
        removeEntity,
        getAllShapes: () => [...ids].map((id) => ({ id })),
      }),
    },
  });
  installChartBridge();
});
afterEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete (window as Window & { paperfundChartDiagnostics?: unknown }).paperfundChartDiagnostics;
});
describe('current terminal context to MAIN native chart bridge', () => {
  it('uses the supplied registry context for a no-position probe and reports a pending backend mint', async () => {
    send('CONTEXT', context);
    probe();
    await flush();
    expect(diagnosis().expectedMint).toBeNull();
    expect(diagnosis().firstFailure).toBe('CURRENT_MINT_MATCHED');
    expect(diagnosis().stages).toContainEqual(
      expect.objectContaining({
        stage: 'CURRENT_MINT_MATCHED',
        reason: 'EXPECTED_MINT_PENDING_BACKEND_RESOLUTION',
      }),
    );
    expect(createShape).not.toHaveBeenCalled();
  });
  it('retains a backend update that arrives before the parent registry-context effect', async () => {
    send('UPDATE', input);
    send('CONTEXT', context);
    await flush();
    expect(createShape).toHaveBeenCalledWith(
      { price: 24300 },
      expect.objectContaining({ shape: 'horizontal_line' }),
    );
    expect(diagnosis().expectedMint).toBe('mint');
    expect(removeEntity).not.toHaveBeenCalled();
  });
  it('rejects foreign and stale URL/context messages', async () => {
    send('CONTEXT', context);
    send('UPDATE', input, 'https://other.test');
    send('UPDATE', { ...input, url: 'https://axiom.trade/meme/other' });
    send('UPDATE', { ...input, context: 'other' });
    await flush();
    expect(createShape).not.toHaveBeenCalled();
  });
  it('clears the drawing on navigation and removes a late asynchronous creation', async () => {
    let finish!: (id: string) => void;
    createShape.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    send('CONTEXT', context);
    send('UPDATE', input);
    expect(finish).toBeTypeOf('function');
    vi.stubGlobal('location', {
      href: 'https://axiom.trade/meme/other',
      origin: 'https://axiom.trade',
      hostname: 'axiom.trade',
      pathname: '/meme/other',
    });
    send('CONTEXT', { ...context, url: location.href, context: 'other' });
    finish('late');
    await flush();
    expect(removeEntity).toHaveBeenCalledWith('late');
    expect(
      post.mock.calls.some(
        ([message]) =>
          message.direction === 'STATUS' && message.context === 'other' && message.drawn === 1,
      ),
    ).toBe(false);
  });
});
