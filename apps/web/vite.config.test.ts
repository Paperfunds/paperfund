import { describe, expect, it } from 'vitest';

import { WEB_DEV_ALLOWED_HOSTS } from './vite.config.js';

describe('web development host allowlist', () => {
  it('allows only the canonical tunneled app hostname', () => {
    expect(WEB_DEV_ALLOWED_HOSTS).toEqual(['app.paperfund.app']);
    expect(WEB_DEV_ALLOWED_HOSTS).not.toContain('*');
  });
});
