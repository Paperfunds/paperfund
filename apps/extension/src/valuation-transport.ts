/** Bounded, ref-counted advisory GETs. Financial mutations never use this transport. */
export class ValuationTransport {
  private pending = new Map<
    string,
    { controller: AbortController; value: Promise<Response>; consumers: Set<string> }
  >();
  private canceled = new Map<string, number>();
  private consumers = new Map<string, AbortController>();
  cancel(id: string) {
    const current = this.consumers.get(id);
    if (current) current.abort();
    else {
      if (this.canceled.size >= 256) this.canceled.delete(this.canceled.keys().next().value!);
      this.canceled.set(id, Date.now() + 20000);
    }
  }
  invalidate() {
    for (const entry of this.pending.values()) entry.controller.abort();
    this.pending.clear();
  }
  async read(
    key: string,
    id: string,
    fetcher: (signal: AbortSignal) => Promise<Response>,
    deadlineMs = 3500,
  ) {
    const until = this.canceled.get(id);
    this.canceled.delete(id);
    if (until && until > Date.now()) throw new DOMException('Advisory canceled', 'AbortError');
    let entry = this.pending.get(key);
    if (!entry) {
      const controller = new AbortController();
      const current = {
        controller,
        consumers: new Set<string>(),
        value: Promise.resolve(new Response()),
      };
      current.value = fetcher(AbortSignal.any([controller.signal, AbortSignal.timeout(deadlineMs)]))
        .then(
          async (response) =>
            new Response(await response.text(), {
              status: response.status,
              statusText: response.statusText,
              headers: response.headers,
            }),
        )
        .finally(() => {
          if (this.pending.get(key) === current) this.pending.delete(key);
        });
      void current.value.catch(() => {});
      this.pending.set(key, current);
      entry = current;
    }
    const consumer = new AbortController();
    this.consumers.set(id, consumer);
    entry.consumers.add(id);
    const captured = entry;
    try {
      return await new Promise<Response>((resolve, reject) => {
        const abort = () => reject(new DOMException('Advisory read canceled', 'AbortError'));
        consumer.signal.addEventListener('abort', abort, { once: true });
        void captured.value
          .then((r) => resolve(r.clone()), reject)
          .finally(() => consumer.signal.removeEventListener('abort', abort));
      });
    } finally {
      this.consumers.delete(id);
      captured.consumers.delete(id);
      if (captured.consumers.size === 0 && this.pending.get(key) === captured)
        captured.controller.abort();
    }
  }
}
