import { redactDiagnostic, safeErrorMessage } from '@paperfund/core';
const sources = () => [process.env['SOLANA_RPC_URL'], process.env['SOLANA_WS_URL']];
export const safeOpsErrorMessage = (error: unknown, fallback = 'unavailable') =>
  safeErrorMessage(error, sources(), fallback);
export const opsDiagnosticJson = (value: unknown) =>
  JSON.stringify(redactDiagnostic(value, sources()), null, 2);
