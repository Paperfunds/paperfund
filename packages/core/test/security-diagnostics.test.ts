import { afterEach, expect, it, vi } from 'vitest';
import {
  redactDiagnostic,
  redactDiagnosticText,
  safeErrorMessage,
} from '../src/security-diagnostics.js';
const key = 'SyntheticRpcCredential_61fb640067ec42e0863ab1826f52d01a';
const token = 'SyntheticBearer_01cdebb27f3346c9a9e808571223cf0e';
const endpoint = 'https://mainnet.helius-rpc.com/?api-key=' + key;
const absent = (value: unknown) => {
  const text = JSON.stringify(value);
  expect(text.includes(key)).toBe(false);
  expect(text.includes(token)).toBe(false);
  expect(text.includes(endpoint)).toBe(false);
};
afterEach(() => vi.unstubAllEnvs());
it.each([
  endpoint,
  encodeURIComponent(endpoint),
  JSON.stringify({ url: endpoint }),
  'api_key=' + key,
])('removes credential URL and query representations', (input) => {
  absent(redactDiagnosticText(input));
});
it('redacts headers, structured keys and nested HTTP error causes without mutating input', () => {
  const original = Object.assign(new Error('HTTP 401 at ' + endpoint), {
    code: 'RPC_UNAVAILABLE',
    status: 401,
    attempt: 3,
    elapsedMs: 42,
    cause: Object.assign(new Error('Bearer ' + token), {
      response: {
        config: { url: endpoint, headers: { Authorization: 'Bearer ' + token, 'x-api-key': key } },
      },
    }),
  });
  const safe = redactDiagnostic(original);
  absent(safe);
  expect(JSON.stringify(safe).includes('RPC_UNAVAILABLE')).toBe(true);
  expect(JSON.stringify(safe).includes('401')).toBe(true);
  expect(original.message.includes(key)).toBe(true);
});
it('removes configured credentials even if the transport echoes only their bare value', () => {
  absent(redactDiagnosticText('Transport rejected credential ' + key, [endpoint]));
  absent(safeErrorMessage(new Error('Transport rejected ' + key), [endpoint]));
});
it('redacts nested credentials that are repeated before their defining field', () => {
  absent(redactDiagnostic({ message: key, cause: { headers: { 'api-key': key } } }));
});
it('does not invoke accessors, toJSON or inspection hooks, and safely handles cycles', () => {
  const getter = vi.fn(() => {
    throw Error(endpoint);
  });
  const toJSON = vi.fn(() => endpoint);
  const value: Record<string, unknown> = { toJSON };
  Object.defineProperty(value, 'private', { enumerable: true, get: getter });
  value.cycle = value;
  absent(redactDiagnostic(value));
  expect(getter).not.toHaveBeenCalled();
  expect(toJSON).not.toHaveBeenCalled();
  const proxy = new Proxy(
    {},
    {
      ownKeys() {
        throw Error(endpoint);
      },
    },
  );
  absent(redactDiagnostic(proxy));
});
it('omits malicious error-message getters instead of logging their thrown value', () => {
  const error = new Error();
  Object.defineProperty(error, 'message', {
    get() {
      throw Error(endpoint);
    },
  });
  absent(safeErrorMessage(error));
});
it('preserves ordinary non-sensitive classifications, status, retry counts, timing and messages', () => {
  const input = {
    provider: 'HELIUS',
    code: 'RPC_UNAVAILABLE',
    message: 'HTTP 429',
    status: 429,
    retries: 2,
    elapsedMs: 125,
  };
  expect(redactDiagnostic(input)).toEqual(input);
  expect(safeErrorMessage(new Error('Request timed out'))).toBe('Request timed out');
});

it('scrubs native HTTP Headers and URL objects plus repeated credential text', () => {
  absent(
    redactDiagnostic({
      message: token,
      cause: {
        request: {
          headers: new Headers({ Authorization: 'Bearer ' + token }),
          url: new URL(endpoint),
        },
      },
    }),
  );
});

it('removes encoded URL-userinfo credentials even when repeated as bare decoded text', () => {
  const credential = key + '/private';
  const privateUrl = 'https://user:' + encodeURIComponent(credential) + '@fixture.invalid';
  const output = redactDiagnosticText('Transport rejected ' + credential, [privateUrl]);
  expect(output.includes(credential)).toBe(false);
});
