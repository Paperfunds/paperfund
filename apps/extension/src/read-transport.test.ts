import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReadTransport } from './read-transport.js';

afterEach(() => vi.useRealTimers());
describe('advisory GET transport', () => {
  it('deduplicates reads, partitions sessions and invalidates cached market data after a mutation', async () => {
    const reads = new ReadTransport();
    const fetchRead = vi.fn(async () => new Response('fresh'));
    const responses = await Promise.all([
      reads.read('user-a:market', fetchRead, 1500),
      reads.read('user-a:market', fetchRead, 1500),
    ]);
    expect(await Promise.all(responses.map((response) => response.text()))).toEqual([
      'fresh',
      'fresh',
    ]);
    await reads.read('user-a:market', fetchRead, 1500);
    expect(fetchRead).toHaveBeenCalledTimes(1);
    await reads.read('user-b:market', fetchRead, 1500);
    reads.invalidate();
    await reads.read('user-a:market', fetchRead, 1500);
    expect(fetchRead).toHaveBeenCalledTimes(3);
  });

  it('bounds backoff to two retries and never caches an outage', async () => {
    vi.useFakeTimers();
    const reads = new ReadTransport();
    const fetchRead = vi.fn(async () => new Response('unavailable', { status: 503 }));
    const pending = reads.read('market', fetchRead, 1500);
    await vi.runAllTimersAsync();
    expect((await pending).status).toBe(503);
    expect(fetchRead).toHaveBeenCalledTimes(3);
    const next = reads.read('market', fetchRead, 1500);
    await vi.runAllTimersAsync();
    await next;
    expect(fetchRead).toHaveBeenCalledTimes(6);
  });
});
