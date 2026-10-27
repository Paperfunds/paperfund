/** Public browser configuration is never a credential transport. */
export function browserPublicUrl(name, value) {
  const message = name + ' must be a public HTTP(S) URL without credentials, query or fragment.';
  try {
    const url = new URL(value);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error(message);
    return url;
  } catch {
    throw new Error(message);
  }
}

export function assertNoServerRpcInBrowserEnvironment(environment) {
  const secrets = [];
  for (const name of ['SOLANA_RPC_URL', 'SOLANA_WS_URL']) {
    try {
      const url = new URL(environment[name]);
      if (url.password) secrets.push(url.password);
      for (const [key, value] of url.searchParams)
        if (/key|token|auth|secret|password/i.test(key) && value.length > 3) secrets.push(value);
    } catch {
      /* Configuration parsing handles invalid server values separately. */
    }
  }
  for (const [name, value] of Object.entries(environment)) {
    if (!name.startsWith('VITE_') || typeof value !== 'string') continue;
    const message = name + ' cannot contain backend RPC credentials.';
    if (
      /SOLANA_RPC|SOLANA_WS|HELIUS_API_KEY|RPC.*(?:URL|KEY|TOKEN)/i.test(name) ||
      /\b(?:Bearer|Basic)\s+/i.test(value)
    )
      throw new Error(message);
    if (
      secrets.some((secret) => value.includes(secret) || value.includes(encodeURIComponent(secret)))
    )
      throw new Error(message);
    for (const match of value.matchAll(/(?:https?|wss?):\/\/[^\s"'<>]+/gi))
      browserPublicUrl(name, match[0]);
  }
}
