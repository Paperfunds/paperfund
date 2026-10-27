/** Advisory GET transport only. Mutations never pass through this cache/retry path. */
export class ReadTransport {
  private epoch = 0;
  private readonly pending = new Map<string, Promise<Response>>();
  private readonly recent = new Map<string, { until: number; response: Response }>();

  invalidate(): void {
    this.epoch += 1;
    this.recent.clear();
    this.pending.clear();
  }

  async read(key: string, fetchRead: () => Promise<Response>, ttl = 0): Promise<Response> {
    const cached = this.recent.get(key);
    if (cached && cached.until > Date.now()) return cached.response.clone();
    this.recent.delete(key);
    let promise = this.pending.get(key);
    if (!promise) {
      const epoch = this.epoch;
      promise = (async () => {
        for (let attempt = 0; ; attempt += 1) {
          try {
            const response = await fetchRead();
            if (attempt < 2 && [429, 502, 503, 504].includes(response.status)) {
              await response.body?.cancel();
            } else {
              if (response.ok && ttl > 0 && epoch === this.epoch) {
                if (this.recent.size >= 64) this.recent.delete(this.recent.keys().next().value!);
                this.recent.set(key, { until: Date.now() + ttl, response: response.clone() });
              }
              return response;
            }
          } catch (error) {
            if (attempt >= 2) throw error;
          }
          await new Promise((resolve) => setTimeout(resolve, 300 * 2 ** attempt));
        }
      })();
      this.pending.set(key, promise);
      void promise
        .finally(() => {
          if (this.pending.get(key) === promise) this.pending.delete(key);
        })
        .catch(() => {});
    }
    return (await promise).clone();
  }
}
