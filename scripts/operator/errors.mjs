// Only public codes cross the HTTP/evidence boundary; never serialize exception URLs/stacks.
export function publicError(error) {
  const message = String(error?.message ?? '');
  const code = /^[A-Z][A-Za-z0-9_:.-]{0,120}$/.test(message) ? message : 'OPERATOR_INTERNAL_ERROR';
  const action = code.startsWith('RPC_')
    ? 'Retry discovery; inspect retained RPC method, HTTP status and RPC code. Check the HTTPS provider if it persists.'
    : code.includes('CLAIM_TOPOLOGY')
      ? 'This topology requires separate claim review; no transaction authorized.'
      : 'Inspect local evidence and service configuration, then retry.';
  return { code, action };
}
