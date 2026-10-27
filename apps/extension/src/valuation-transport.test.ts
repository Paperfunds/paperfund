import { expect, it, vi } from 'vitest';
import { ValuationTransport } from './valuation-transport.js';
it('coalesces two tabs, buffers the response and cancels only abandoned consumers', async () => {
  const t = new ValuationTransport();
  let finish!: (r: Response) => void;
  const fetcher = vi.fn((_signal: AbortSignal) => {
    _signal.throwIfAborted();
    return new Promise<Response>((r) => (finish = r));
  });
  const first = t.read('session:mint', 'tab1', fetcher),
    second = t.read('session:mint', 'tab2', fetcher);
  const canceled = expect(first).rejects.toMatchObject({ name: 'AbortError' });
  t.cancel('tab1');
  expect(fetcher.mock.calls[0]![0].aborted).toBe(false);
  finish(new Response('fresh'));
  await canceled;
  expect(await (await second).text()).toBe('fresh');
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('aborts the upstream fetch after the last consumer leaves and on financial invalidation', async () => {
  const t = new ValuationTransport();
  const fetcher = vi.fn(
    (signal: AbortSignal) =>
      new Promise<Response>((_r, reject) =>
        signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))),
      ),
  );
  const p = t.read('one', 'tab', fetcher),
    error = expect(p).rejects.toMatchObject({ name: 'AbortError' });
  t.cancel('tab');
  await error;
  expect(fetcher.mock.calls[0]![0].aborted).toBe(true);
  const second = t.read('two', 'tab2', fetcher),
    e = expect(second).rejects.toMatchObject({ name: 'AbortError' });
  t.invalidate();
  await e;
});

it('remembers cancellation delivered before session lookup finishes', async () => {
  const t = new ValuationTransport(),
    fetcher = vi.fn(async () => new Response('obsolete'));
  t.cancel('tab:request');
  await expect(t.read('key', 'tab:request', fetcher)).rejects.toMatchObject({ name: 'AbortError' });
  expect(fetcher).not.toHaveBeenCalled();
});
