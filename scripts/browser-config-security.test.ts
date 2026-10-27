import { expect, it } from 'vitest';
import {
  browserPublicUrl,
  assertNoServerRpcInBrowserEnvironment,
} from './browser-config-security.mjs';
const key = 'SyntheticBrowserCredential_6ed99bdecc0c4c149a221c5983a295e2';
it.each([
  'https://api.paperfund.app/?api-key=' + key,
  'https://' + key + '@api.paperfund.app/',
  'https://api.paperfund.app/#' + key,
  'not-a-url-' + key,
])('rejects private browser configuration without echoing input', (value) => {
  let message = '';
  try {
    browserPublicUrl('PAPERFUND_API_BASE_URL', value);
  } catch (e) {
    message = (e as Error).message;
  }
  expect(message.length > 0).toBe(true);
  expect(message.includes(key)).toBe(false);
});
it('preserves public production and loopback URL parsing', () => {
  expect(browserPublicUrl('API', 'https://api.paperfund.app').origin).toBe(
    'https://api.paperfund.app',
  );
  expect(browserPublicUrl('APP', 'http://127.0.0.1:5173/trade').pathname).toBe('/trade');
});

it.each([
  { VITE_HELIUS_API_KEY: key },
  { VITE_RPC_URL: 'https://mainnet.helius-rpc.com/?api-key=' + key },
  { VITE_MISC: 'Bearer ' + key },
  { SOLANA_RPC_URL: 'https://mainnet.helius-rpc.com/?api-key=' + key, VITE_MISC: key },
])('rejects public Vite RPC credential transport without echoing values', (environment) => {
  let message = '';
  try {
    assertNoServerRpcInBrowserEnvironment(environment);
  } catch (e) {
    message = (e as Error).message;
  }
  expect(message.length > 0).toBe(true);
  expect(message.includes(key)).toBe(false);
});
