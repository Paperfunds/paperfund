import { testWalletAddress as walletAddress, testWalletPrivateKey as privateKey } from './test-wallet.js';
import { expect, test } from '@playwright/test';

const developedMint = 'BewoWqr56gfPQXzWiMUSCVY4fJbthPZrdj17L3qCXEmg';

test('wallet auth, round entry, authoritative BUY, valuation, SELL, and history', async ({
  page,
}) => {
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1' || url.protocol === 'data:') await route.continue();
    else await route.abort('blockedbyclient');
  });
  await page.addInitScript(
    async ({ address, encodedPrivateKey }) => {
      const bytes = Uint8Array.from(atob(encodedPrivateKey), (character) =>
        character.charCodeAt(0),
      );
      const key = await crypto.subtle.importKey('pkcs8', bytes, 'Ed25519', false, ['sign']);
      Object.defineProperty(window, 'solana', {
        configurable: true,
        value: {
          async connect() {
            return { publicKey: { toString: () => address } };
          },
          async signMessage(message: Uint8Array) {
            const signature = await crypto.subtle.sign('Ed25519', key, message);
            return { signature: new Uint8Array(signature) };
          },
          publicKey: { toString: () => address },
        },
      });
    },
    { address: walletAddress, encodedPrivateKey: privateKey },
  );

  await page.goto('/trade');
  await page.getByRole('button', { name: 'Connect Wallet' }).click();
  await page.getByRole('button', { name: 'Sign In' }).click();
  await expect(page.locator('.round-chip strong')).not.toHaveText('Unavailable');
  await expect(page.getByRole('button', { name: /Enter Round/i })).toBeVisible();
  await page.getByRole('button', { name: /Enter Round/i }).click();
  await expect(
    page.locator('.account-strip .metric').filter({ hasText: 'Available cash' }).locator('strong'),
  ).toHaveText('10 SOL');

  await page.getByLabel('Token mint').fill(developedMint);
  await page.getByRole('button', { name: 'Inspect' }).click();
  await expect(page.getByText('Supported market')).toBeVisible();
  const review = page.locator('.ticket-review');
  await expect(review.locator('strong').nth(2)).toHaveText('2 SOL');
  await page.getByRole('button', { name: 'MAX' }).click();
  await page.getByRole('button', { name: 'Buy with Paper SOL' }).click();
  await expect(page.getByText('BUY FILLED')).toBeVisible();
  await expect(page.getByText('Executable value')).toBeVisible();
  await expect(page.getByText('Valuation unavailable')).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Open positions' })).toBeVisible();
  await expect(page.getByText('1 / 5', { exact: true }).first()).toBeVisible();

  await page.getByRole('button', { name: 'Sell All' }).click();
  await expect(page.getByText('SELL FILLED')).toBeVisible();
  await expect(page.getByRole('cell', { name: 'SELL', exact: true })).toBeVisible();
  await page.goto('/hourly');
  const live = page.getByRole('region', { name: 'Live hourly leaderboard' });
  await expect(live.getByText('LIVE / PROVISIONAL', { exact: true })).toBeVisible();
  await expect(live.getByText('YOU', { exact: true })).toBeVisible();
  await expect(live.getByRole('columnheader', { name: 'Executable equity' })).toBeVisible();
  await expect(live.getByText('Live ranking temporarily unavailable')).toHaveCount(0);
});

test('independent invited browser account starts at 10 Paper SOL and cannot see another account holdings', async ({
  page,
}) => {
  const address = process.env['PAPERFUND_E2E_SECOND_PUBLIC_KEY'];
  const encodedPrivateKey = process.env['PAPERFUND_E2E_SECOND_PRIVATE_KEY'];
  if (!address || !encodedPrivateKey) throw Error('Ephemeral test-only second wallet required');
  await page.route('**/*', async (route) => {
    const u = new URL(route.request().url());
    if (u.hostname === '127.0.0.1' || u.protocol === 'data:') await route.continue();
    else await route.abort('blockedbyclient');
  });
  await page.addInitScript(
    async ({ address, encodedPrivateKey }) => {
      const bytes = Uint8Array.from(atob(encodedPrivateKey), (c) => c.charCodeAt(0));
      const key = await crypto.subtle.importKey('pkcs8', bytes, 'Ed25519', false, ['sign']);
      Object.defineProperty(window, 'solana', {
        configurable: true,
        value: {
          connect: async () => ({ publicKey: { toString: () => address } }),
          signMessage: async (message: Uint8Array) => ({
            signature: new Uint8Array(await crypto.subtle.sign('Ed25519', key, message)),
          }),
          publicKey: { toString: () => address },
        },
      });
    },
    { address, encodedPrivateKey },
  );
  await page.goto('/trade');
  await page.getByRole('button', { name: 'Connect Wallet' }).click();
  await page.getByRole('button', { name: 'Sign In' }).click();
  await page.getByRole('button', { name: /Enter Round/i }).click();
  await expect(page.getByText('10 SOL', { exact: true }).first()).toBeVisible();
  const account = await page.request.get('http://127.0.0.1:3019/api/v1/rounds/current/account');
  expect(account.status()).toBe(200);
  const body = await account.json();
  expect(body.paperSolLamports).toBe('10000000000');
  expect(body.positions).toEqual([]);
  expect(body.slotsUsed).toBe(0);
  await page.reload();
  await expect(page.getByText('10 SOL', { exact: true }).first()).toBeVisible();
});
