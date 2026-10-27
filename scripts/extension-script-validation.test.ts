import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { afterEach, describe, expect, it } from 'vitest';
import { validateExtensionScripts } from './extension-script-validation.mjs';

const copies: string[] = [];
afterEach(() => {
  for (const path of copies.splice(0)) rmSync(path, { recursive: true, force: true });
});
function artifact() {
  const path = mkdtempSync(join(tmpdir(), 'paperfund-bridge-test-'));
  copies.push(path);
  cpSync(resolve('apps/extension/build'), path, { recursive: true });
  return path;
}
describe('emitted MV3 script compatibility', () => {
  it('validates the actual build and starts the bridge as a classic script', () => {
    validateExtensionScripts(resolve('apps/extension/build'));
    const messages: unknown[] = [];
    const listeners = new Map<string, ((event: unknown) => void)[]>();
    const window = {
      addEventListener: (type: string, listener: (event: unknown) => void) =>
        listeners.set(type, [...(listeners.get(type) ?? []), listener]),
      setInterval: () => 1,
      postMessage: (message: unknown) => messages.push(message),
    };
    const history = { pushState: () => {}, replaceState: () => {} };
    runInNewContext(readFileSync('apps/extension/build/page-bridge.js', 'utf8'), {
      window,
      history,
      location: { href: 'https://axiom.trade/meme/fixture', origin: 'https://axiom.trade' },
      document: {},
      console,
      setTimeout,
      clearTimeout,
    });
    expect(listeners.get('message')?.length).toBeGreaterThan(0);
    expect(messages).toContainEqual(expect.objectContaining({ direction: 'NAVIGATION' }));
    history.pushState();
    expect(messages).toHaveLength(2);
  });
  it.each(['import "./chunks/broken.js";', 'void import("./chunks/broken.js");'])(
    'rejects a classic bridge import %s',
    (code) => {
      const path = artifact();
      writeFileSync(join(path, 'page-bridge.js'), code);
      expect(() => validateExtensionScripts(path)).toThrow();
    },
  );
  it('rejects missing bridge, missing chunks and inaccessible chunks', () => {
    const path = artifact();
    rmSync(join(path, 'page-bridge.js'));
    expect(() => validateExtensionScripts(path)).toThrow('Missing/inaccessible');
    cpSync('apps/extension/build/page-bridge.js', join(path, 'page-bridge.js'));
    writeFileSync(join(path, 'content.js'), 'import "./chunks/missing.js";');
    expect(() => validateExtensionScripts(path)).toThrow('Missing/inaccessible');
    const manifest = JSON.parse(readFileSync(join(path, 'manifest.json'), 'utf8'));
    manifest.web_accessible_resources[0].resources = ['content.js'];
    writeFileSync(join(path, 'manifest.json'), JSON.stringify(manifest));
    expect(() => validateExtensionScripts(path)).toThrow('not web accessible');
    manifest.content_scripts[0].world = 'ISOLATED';
    writeFileSync(join(path, 'manifest.json'), JSON.stringify(manifest));
    expect(() => validateExtensionScripts(path)).toThrow('Missing MAIN');
  });
});

describe('emitted operator chart pipeline', () => {
  it('starts in MAIN, consolidates isolated diagnostics and probes without position data', async () => {
    const listeners = new Map<string, ((event: unknown) => void)[]>();
    const intervals: (() => void)[] = [];
    const location = {
      href: 'https://axiom.trade/meme/pair',
      origin: 'https://axiom.trade',
      pathname: '/meme/pair',
      hostname: 'axiom.trade',
    };
    const window: Record<string, unknown> = {
      addEventListener: (type: string, listener: (event: unknown) => void) =>
        listeners.set(type, [...(listeners.get(type) ?? []), listener]),
      setInterval: (callback: () => void) => {
        intervals.push(callback);
        return 1;
      },
      postMessage: () => {},
    };
    runInNewContext(readFileSync('apps/extension/build/page-bridge.js', 'utf8'), {
      window,
      location,
      history: { pushState: () => {}, replaceState: () => {} },
      document: { querySelectorAll: () => [], getElementById: () => null },
      localStorage: { getItem: () => '1' },
      console: { debug: () => {} },
      setTimeout,
      clearTimeout,
    });
    expect(window.paperfundDiagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event: 'CHART_BRIDGE_READY', world: 'MAIN' }),
      ]),
    );
    for (const listener of listeners.get('message') ?? [])
      listener({
        source: window,
        origin: location.origin,
        data: {
          channel: 'paperfund:diagnostic:v1',
          event: 'CHART_CONTENT_READY',
          details: { status: 'PASS' },
        },
      });
    expect(window.paperfundDiagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event: 'CHART_CONTENT_READY', world: 'ISOLATED_RELAY' }),
      ]),
    );
    for (const listener of listeners.get('message') ?? [])
      listener({
        source: window,
        origin: location.origin,
        data: {
          channel: 'paperfund:chart:v1',
          direction: 'CONTEXT',
          value: { terminal: 'AXIOM', context: 'pair', url: location.href },
        },
      });
    intervals[0]!();
    await Promise.resolve();
    expect(window.paperfundChartDiagnostics).toMatchObject({
      world: 'MAIN',
      expectedMint: null,
      firstFailure: 'CHART_IFRAME_FOUND',
      stages: expect.arrayContaining([
        expect.objectContaining({ stage: 'DRAWING_REQUESTED', status: 'UNAVAILABLE' }),
      ]),
    });
  });
});
