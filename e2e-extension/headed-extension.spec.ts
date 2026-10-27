import { testWalletAddress as WALLET, testWalletPrivateKey as PRIVATE_KEY } from '../e2e/test-wallet.js';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';

const EXTENSION_ID = 'lcnpjpkojoadojibfbjfohpjepkfmdln';
const MINT_A = 'BewoWqr56gfPQXzWiMUSCVY4fJbthPZrdj17L3qCXEmg';
const MINT_B = 'So11111111111111111111111111111111111111112';
const SUPPLIED_MINTS = [
  'BxS9FViALHNNd7bWVHNZ4ift699hUai4Xcj9vsKHpump',
  'KdMLzBKVHbuLxUvPJvpJtig71tDGnUiWVjAVGP6vZEC',
  'FxMHS3C5EvyPkLoKswvf99VR5RkMLxKKgBqxxDvpump',
  '36sagUqFTtRexLToDforaTaWve4HdCuzH3EXNAtLwfUQ',
] as const;
const extensionPath = resolve(process.cwd(), 'apps/extension/build');

async function captureStoreScreenshot(page: Page, name: string, redactWallet = false) {
  const configured = process.env['PAPERFUND_STORE_SCREENSHOT_DIR'];
  if (!configured) return;
  const directory = resolve(configured);
  mkdirSync(directory, { recursive: true });
  await page.setViewportSize({ width: 1280, height: 800 });
  if (redactWallet) {
    await page.evaluate(() => {
      const root = document.querySelector('#paperfund-extension-root')?.shadowRoot;
      const style = document.createElement('style');
      style.textContent = '.pf-wallet-row { visibility: hidden !important; }';
      root?.append(style);
    });
  }
  await page.screenshot({ path: join(directory, `${name}-1280x800.png`) });
}

async function launch(profile: string): Promise<BrowserContext> {
  const executablePath = process.env['PAPERFUND_CHROMIUM_EXECUTABLE'];
  const cdpLoad = process.env['PAPERFUND_CDP_LOAD_UNPACKED'] === 'true';
  const context = await chromium.launchPersistentContext(profile, {
    headless: false,
    ignoreDefaultArgs: ['--disable-extensions'],
    args: cdpLoad
      ? ['--enable-unsafe-extension-debugging']
      : [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    ...(executablePath ? { executablePath } : {}),
  });
  if (cdpLoad) {
    const browser = context.browser();
    if (!browser) throw new Error('The headed browser connection is unavailable.');
    const session = await browser.newBrowserCDPSession();
    const loaded = await session.send('Extensions.loadUnpacked', {
      path: extensionPath,
      enableInIncognito: false,
    });
    if (loaded.id !== EXTENSION_ID) throw new Error(`Unexpected extension id: ${loaded.id}`);
    const review = await context.newPage();
    await review.goto(`chrome://extensions/?id=${EXTENSION_ID}`);
    const keep = review.getByRole('button', { name: 'Keep', exact: true });
    if (await keep.isVisible().catch(() => false)) await keep.click();
    await review.close();
  }
  return context;
}

async function addWallet(context: BrowserContext) {
  await context.addInitScript(
    async ({ address, encodedPrivateKey }) => {
      if (!['axiom.trade', 'gmgn.ai', 'trade.padre.gg'].includes(location.hostname)) return;
      const bytes = Uint8Array.from(atob(encodedPrivateKey), (character) =>
        character.charCodeAt(0),
      );
      const key = await crypto.subtle.importKey('pkcs8', bytes, 'Ed25519', false, ['sign']);
      const control = { rejectConnect: true, rejectSign: true, signCalls: 0 };
      Object.defineProperty(window, '__paperfundWalletControl', {
        configurable: true,
        value: control,
      });
      Object.defineProperty(window, 'solana', {
        configurable: true,
        value: {
          publicKey: { toString: () => address },
          async connect() {
            if (control.rejectConnect) throw new Error('Wallet connection rejected.');
            return { publicKey: { toString: () => address } };
          },
          async signMessage(message: Uint8Array) {
            control.signCalls += 1;
            if (control.rejectSign) throw new Error('Signature rejected.');
            const signature = await crypto.subtle.sign('Ed25519', key, message);
            return { signature: new Uint8Array(signature) };
          },
        },
      });
    },
    { address: WALLET, encodedPrivateKey: PRIVATE_KEY },
  );
}

async function openFixture(context: BrowserContext): Promise<Page> {
  await context.route('https://axiom.trade/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><html><head><title>Axiom fixture</title></head><body><main id="axiom"><button>Axiom Trade</button><div id="chart">Fixture market layout</div></main></body></html>',
    }),
  );
  await addWallet(context);
  const page = await context.newPage();
  await page.goto(`https://axiom.trade/meme/${MINT_A}?chain=sol`);
  await expect(page.getByRole('region', { name: 'Paperfund paper trading overlay' })).toBeVisible();
  return page;
}

async function authenticate(page: Page) {
  const connect = page.getByRole('button', { name: 'CONNECT WALLET' });
  await connect.click();
  await expect(page.getByText('Wallet connection rejected.')).toBeVisible();
  await page.evaluate(() => {
    const state = window as typeof window & {
      __paperfundWalletControl: { rejectConnect: boolean };
    };
    state.__paperfundWalletControl.rejectConnect = false;
  });
  await connect.click();
  const signIn = page.getByRole('button', { name: 'SIGN IN TO PAPERFUND' });
  await signIn.click();
  await expect(page.getByText('Signature rejected.')).toBeVisible();
  await page.evaluate(() => {
    const state = window as typeof window & {
      __paperfundWalletControl: { rejectSign: boolean };
    };
    state.__paperfundWalletControl.rejectSign = false;
  });
  await signIn.click();
  await expect(page.getByRole('button', { name: 'ENTER ROUND' })).toBeVisible();
}

test('headed MV3 acceptance covers auth, trading, stale mint, worker recovery, and settings', async ({
  browserName,
}, testInfo) => {
  expect(browserName).toBe('chromium');
  const context = await launch(testInfo.outputPath('profile'));
  try {
    const page = await openFixture(context);
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    expect(new URL(worker.url()).host).toBe(EXTENSION_ID);

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${EXTENSION_ID}/popup.html`);
    await expect(popup.getByRole('heading', { name: /Paperfund/ })).toBeVisible();
    await expect(popup.getByText('Paper trading only')).toBeVisible();
    await expect(popup.getByRole('region', { name: 'Supported terminals' })).toContainText('Axiom');
    await expect(popup.getByRole('region', { name: 'Supported terminals' })).toContainText('GMGN');
    await expect(popup.getByRole('region', { name: 'Supported terminals' })).toContainText(
      'Terminal',
    );
    await captureStoreScreenshot(popup, 'paperfund-popup');
    const overlayToggle = popup.getByRole('checkbox', { name: 'Overlay enabled' });
    await expect(overlayToggle).toBeChecked();
    await overlayToggle.uncheck();
    await expect(page.getByRole('region', { name: 'Paperfund paper trading overlay' })).toHaveCount(
      0,
    );
    await page.reload();
    await expect(page.getByRole('region', { name: 'Paperfund paper trading overlay' })).toHaveCount(
      0,
    );
    await overlayToggle.check();
    await expect(
      page.getByRole('region', { name: 'Paperfund paper trading overlay' }),
    ).toBeVisible();
    await popup.close();

    await authenticate(page);
    await page.getByRole('button', { name: 'ENTER ROUND' }).click();
    await expect(page.getByText('10 SOL', { exact: false }).first()).toBeVisible();
    const max = page.getByRole('button', { name: 'MAX' });
    await expect(max).toBeEnabled();
    await max.click();
    await captureStoreScreenshot(page, 'axiom-buy-preflight', true);

    await page.evaluate((mint) => history.pushState({}, '', `/meme/${mint}?chain=sol`), MINT_B);
    await expect(page.getByText('Market data temporarily unavailable. Retrying…')).toBeVisible();
    await expect(page.getByRole('button', { name: 'BUY · PAPER ONLY' })).toHaveCount(0);

    await page.evaluate((mint) => history.pushState({}, '', `/meme/${mint}?chain=sol`), MINT_A);
    await expect(max).toBeEnabled();
    await max.click();
    await page.getByRole('button', { name: 'BUY · PAPER ONLY' }).click();
    await expect(page.getByText('CURRENT POSITION')).toBeVisible();
    await expect(page.getByLabel('Paperfund average entry')).toContainText('PF AVG ENTRY');
    await captureStoreScreenshot(page, 'axiom-position-sell', true);
    await page.getByRole('button', { name: '25%' }).last().click();
    await expect(page.getByText(/Sold 25%/)).toBeVisible();
    await expect(page.getByLabel('Paperfund average entry')).toBeVisible();

    const panel = page.getByRole('region', { name: 'Paperfund paper trading overlay' });
    const beforeDrag = await panel.boundingBox();
    const header = panel.locator('.pf-header');
    const headerBox = await header.boundingBox();
    expect(beforeDrag).toBeTruthy();
    expect(headerBox).toBeTruthy();
    await page.mouse.move(headerBox!.x + 120, headerBox!.y + 24);
    await page.mouse.down();
    await page.mouse.move(headerBox!.x + 60, headerBox!.y + 70);
    await page.mouse.up();
    const afterDrag = await panel.boundingBox();
    expect(afterDrag!.x).not.toBe(beforeDrag!.x);

    const resize = page.getByRole('separator', { name: 'Resize Paperfund panel' });
    const resizeBox = await resize.boundingBox();
    const beforeResize = await panel.boundingBox();
    expect(resizeBox).toBeTruthy();
    await page.mouse.move(resizeBox!.x + 10, resizeBox!.y + 10);
    await page.mouse.down();
    await page.mouse.move(resizeBox!.x + 70, resizeBox!.y + 50);
    await page.mouse.up();
    const afterResize = await panel.boundingBox();
    expect(afterResize!.width).toBeGreaterThan(beforeResize!.width);

    await page.getByRole('button', { name: 'SELL ALL' }).click();
    await expect(page.getByText(/Sold all/)).toBeVisible();
    await expect(page.getByLabel('Paperfund average entry')).toHaveCount(0);
    await expect(page.getByText('SELL', { exact: true }).first()).toBeVisible();

    await page.getByRole('button', { name: 'Collapse Paperfund' }).click();
    await page.reload();
    await expect(page.getByRole('button', { name: 'Expand Paperfund' })).toBeVisible();
    await page.getByRole('button', { name: 'Expand Paperfund' }).click();

    const settings = await context.newPage();
    await settings.goto(`chrome-extension://${EXTENSION_ID}/popup.html`);
    await settings.getByRole('button', { name: 'Reset panel layout' }).click();
    await settings.close();
    await expect.poll(async () => (await panel.boundingBox())?.width).toBe(376);

    const client = await context.newCDPSession(page);
    const targets = await client.send('Target.getTargets');
    const serviceWorker = targets.targetInfos.find(
      (target) =>
        target.type === 'service_worker' &&
        target.url.startsWith(`chrome-extension://${EXTENSION_ID}/`),
    );
    expect(serviceWorker).toBeTruthy();
    await client.send('Target.closeTarget', { targetId: serviceWorker!.targetId });
    await page.reload();
    await expect(page.getByText('CASH')).toBeVisible();
  } finally {
    await context.close();
  }
});

test('one headed MV3 build detects isolated Axiom, GMGN, and Terminal tabs', async ({
  browserName,
}, testInfo) => {
  expect(browserName).toBe('chromium');
  const context = await launch(testInfo.outputPath('multi-terminal-profile'));
  try {
    for (const origin of ['https://axiom.trade', 'https://gmgn.ai', 'https://trade.padre.gg']) {
      await context.route(`${origin}/**`, (route) =>
        route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: '<!doctype html><html><body><main>Terminal fixture</main></body></html>',
        }),
      );
    }
    const fixtures = [
      ['AXIOM', `https://axiom.trade/meme/${MINT_A}?chain=sol`, `/meme/${MINT_B}?chain=sol`],
      ['GMGN', `https://gmgn.ai/sol/token/${MINT_A}`, `/sol/token/${MINT_B}`],
      ['PADRE', `https://trade.padre.gg/trade/solana/${MINT_A}`, `/trade/solana/${MINT_B}`],
    ] as const;
    const pages = await Promise.all(
      fixtures.map(async ([label, url]) => {
        const page = await context.newPage();
        await page.goto(url);
        const overlay = page.getByRole('region', { name: 'Paperfund paper trading overlay' });
        await expect(overlay).toBeVisible();
        await expect(overlay).toContainText(label);
        return page;
      }),
    );
    await captureStoreScreenshot(pages[1]!, 'gmgn-overlay');
    await captureStoreScreenshot(pages[2]!, 'terminal-overlay');
    await expect(
      pages[0]!.getByRole('region', { name: 'Paperfund paper trading overlay' }),
    ).toContainText('AXIOM');
    await expect(
      pages[2]!.getByRole('region', { name: 'Paperfund paper trading overlay' }),
    ).toContainText('PADRE');
    expect(await Promise.all(pages.map((page) => page.url()))).toEqual(
      fixtures.map((entry) => entry[1]),
    );
  } finally {
    await context.close();
  }
});

const liveFixtures = [
  [
    'Axiom',
    `https://axiom.trade/meme/${SUPPLIED_MINTS[0]}?chain=sol`,
    (mint: string) => `/meme/${mint}?chain=sol`,
  ],
  [
    'GMGN',
    `https://gmgn.ai/sol/token/${SUPPLIED_MINTS[0]}`,
    (mint: string) => `/sol/token/${mint}`,
  ],
  [
    'Padre',
    `https://trade.padre.gg/trade/solana/${SUPPLIED_MINTS[0]}`,
    (mint: string) => `/trade/solana/${mint}`,
  ],
] as const;

for (const [terminalName, initialUrl, pathForMint] of liveFixtures) {
  test(`@live injects safely on current public ${terminalName} routes without trading`, async ({
    browserName,
  }, testInfo) => {
    expect(browserName).toBe('chromium');
    const context = await launch(testInfo.outputPath('live-profile'));
    try {
      const page = await context.newPage();
      await page.goto(initialUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 60_000,
      });
      const host = page.locator('#paperfund-extension-root');
      await expect(host).toBeAttached();
      await expect(
        page.getByRole('region', { name: 'Paperfund paper trading overlay' }),
      ).toBeVisible();
      expect(await host.evaluate((element) => getComputedStyle(element).pointerEvents)).toBe(
        'none',
      );
      for (const mint of SUPPLIED_MINTS) {
        const nextPath = pathForMint(mint);
        const reportedUrl = await page.evaluate(
          (path) =>
            new Promise<string>((resolve) => {
              const listener = (event: MessageEvent) => {
                const message = event.data as {
                  channel?: string;
                  direction?: string;
                  url?: string;
                };
                if (
                  message.channel === 'paperfund:page-bridge:v1' &&
                  message.direction === 'NAVIGATION' &&
                  message.url?.includes(path)
                ) {
                  window.removeEventListener('message', listener);
                  resolve(message.url);
                }
              };
              window.addEventListener('message', listener);
              history.pushState({}, '', path);
            }),
          nextPath,
        );
        expect(reportedUrl).toContain(mint);
        await expect(host).toBeAttached();
      }
      await page.evaluate(
        (url) => history.pushState({}, '', new URL(url).pathname + new URL(url).search),
        initialUrl,
      );
      await expect(host).toBeAttached();
    } finally {
      await context.close();
    }
  });
}
