import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from './client.js';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe('BUY extension message failures', () => {
  it('sends the financial intent once and exposes typed transport failures', async () => {
    const sendMessage = vi
      .fn()
      .mockResolvedValue({ ok: true, data: { tokenQuantityReceivedBaseUnits: '1' } });
    vi.stubGlobal('chrome', { runtime: { sendMessage } });
    await apiRequest('BUY', { mint: 'mint', paperSol: '1', idempotencyKey: 'one' });
    expect(sendMessage).toHaveBeenCalledExactlyOnceWith({
      kind: 'PAPERFUND_API_V1',
      operation: 'BUY',
      payload: { mint: 'mint', paperSol: '1', idempotencyKey: 'one' },
    });
    sendMessage.mockRejectedValue(new Error('Receiving end does not exist'));
    await expect(apiRequest('BUY')).rejects.toMatchObject({ code: 'EXTENSION_REQUEST_FAILED' });
    sendMessage.mockResolvedValue(undefined);
    await expect(apiRequest('BUY')).rejects.toMatchObject({ code: 'EXTENSION_INVALID_RESPONSE' });
  });
  it('bounds a missing response and never retries a mutation', async () => {
    vi.useFakeTimers();
    const sendMessage = vi.fn(() => new Promise(() => {}));
    vi.stubGlobal('chrome', { runtime: { sendMessage } });
    const pending = expect(apiRequest('BUY')).rejects.toMatchObject({
      code: 'EXTENSION_RESPONSE_TIMEOUT',
    });
    await vi.advanceTimersByTimeAsync(20_000);
    await pending;
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });
});
