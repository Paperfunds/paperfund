import { redactDiagnostic, safeErrorMessage } from '@paperfund/core';
const sources = () => [process.env['SOLANA_RPC_URL'], process.env['SOLANA_WS_URL']];
export const safeApiDiagnostic = (value: unknown, context?: unknown) =>
  redactDiagnostic(value, [...sources(), context]);
export const safeApiErrorMessage = (error: unknown) => safeErrorMessage(error, sources());
export function safeApiSerializedError(error: unknown) {
  const safe = safeApiDiagnostic(error);
  const fields = safe && typeof safe === 'object' ? (safe as Record<string, unknown>) : {};
  return {
    ...fields,
    type: typeof fields['name'] === 'string' ? fields['name'] : 'Error',
    message: typeof fields['message'] === 'string' ? fields['message'] : '[Diagnostic error]',
    stack: typeof fields['stack'] === 'string' ? fields['stack'] : '',
  };
}
function safeLogArgument(value: unknown, context: readonly unknown[]): unknown {
  const safe = safeApiDiagnostic(value, context);
  if (!value || typeof value !== 'object' || !safe || typeof safe !== 'object') return safe;
  try {
    const fields = safe as Record<string, unknown>;
    const own = Object.getOwnPropertyDescriptors(value);
    const request = own['req'];
    if (request && 'value' in request) {
      const req = request.value as {
        id?: unknown;
        method?: unknown;
        url?: unknown;
        hostname?: unknown;
        ip?: unknown;
      };
      fields['req'] = safeApiDiagnostic(
        { id: req.id, method: req.method, url: req.url, hostname: req.hostname, ip: req.ip },
        context,
      );
    }
    const response = own['res'];
    if (response && 'value' in response) {
      const res = response.value as { statusCode?: unknown };
      fields['res'] = safeApiDiagnostic({ statusCode: res.statusCode }, context);
    }
    return fields;
  } catch {
    return '[Log diagnostic unavailable]';
  }
}
export function safeApiLoggerOptions(level: string) {
  return {
    level,
    hooks: {
      logMethod(this: unknown, args: unknown[], method: (...args: unknown[]) => void) {
        method.apply(
          this,
          args.map((value) => safeLogArgument(value, args)),
        );
      },
    },
    serializers: { err: safeApiSerializedError, error: safeApiSerializedError },
  };
}
