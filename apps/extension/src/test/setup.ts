import '@testing-library/jest-dom/vitest';

import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

const localValues: Record<string, unknown> = {};
const sessionValues: Record<string, unknown> = {};
function area(values: Record<string, unknown>) {
  return {
    get: vi.fn(async (defaults?: Record<string, unknown> | string) =>
      typeof defaults === 'object' ? { ...defaults, ...values } : { ...values },
    ),
    set: vi.fn(async (input: Record<string, unknown>) => {
      Object.assign(values, input);
    }),
    remove: vi.fn(async (key: string) => {
      delete values[key];
    }),
  };
}
Object.defineProperty(globalThis, 'chrome', {
  value: {
    runtime: {
      sendMessage: vi.fn(),
      getURL: (path: string) => `chrome-extension://test/${path}`,
      onMessage: { addListener: vi.fn() },
    },
    storage: {
      local: area(localValues),
      session: area(sessionValues),
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
  },
  configurable: true,
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
