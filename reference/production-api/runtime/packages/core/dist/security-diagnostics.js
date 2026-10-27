/** Pure diagnostic redaction. Never calls getters, toJSON, inspect or a logger. */
const hidden = '[REDACTED]';
const sensitiveKey = /^(?:auth|authentication|authorization|proxyauthorization|authtoken|xauthtoken|cookie|setcookie|apikey|xapikey|apitoken|heliusapikey|credential|credentials|key|token|accesstoken|refreshtoken|sessiontoken|password|passwd|secret|clientsecret|privatekey|seedphrase|solanarpcurl|solanawsurl|rpcurl)$/i;
const normalizeKey = (key) => key.replace(/[^a-z0-9]/gi, '');
const maxLength = 100000;
function variants(text) {
    const result = [text.replace(/\\\//g, '/')];
    for (let i = 0; i < 2; i++) {
        try {
            const decoded = decodeURIComponent(result[result.length - 1]);
            if (decoded === result[result.length - 1])
                break;
            result.push(decoded);
        }
        catch {
            break;
        }
    }
    return result;
}
function collectText(text, secrets) {
    if (text.length > maxLength)
        return;
    for (const value of variants(text)) {
        for (const match of value.matchAll(/(?:https?|wss?):\/\/[^\s"'<>\\]+/gi)) {
            try {
                const url = new URL(match[0].replace(/[),.;\]}]+$/, ''));
                if (url.username)
                    secrets.add(url.username);
                if (url.password)
                    secrets.add(url.password);
                for (const value of [url.username, url.password]) {
                    try {
                        if (value)
                            secrets.add(decodeURIComponent(value));
                    }
                    catch {
                        /* Already collected encoded value. */
                    }
                }
                for (const [key, token] of url.searchParams)
                    if (sensitiveKey.test(normalizeKey(key)) && token)
                        secrets.add(token);
                if (/helius|quicknode|quiknode|alchemy|chainstack|getblock|triton|ankr/i.test(url.hostname))
                    for (const token of url.pathname.split('/'))
                        if (/^[a-z0-9_-]{24,}$/i.test(token))
                            secrets.add(token);
            }
            catch {
                /* Do not serialize URL parser exceptions. */
            }
        }
        for (const match of value.matchAll(/\b(Bearer|Basic)\s+([a-z0-9._~+/-]+=*)/gi)) {
            secrets.add(match[2]);
            if (match[1].toLowerCase() === 'basic') {
                try {
                    const decoded = atob(match[2]);
                    secrets.add(decoded);
                    const colon = decoded.indexOf(':');
                    if (colon >= 0)
                        secrets.add(decoded.slice(colon + 1));
                }
                catch {
                    /* Invalid Basic payload is still redacted. */
                }
            }
        }
        for (const match of value.matchAll(/(?:api[-_]?key|access[-_]?token|refresh[-_]?token|session[-_]?token|password|client[-_]?secret|authorization|auth|token|key|secret)\s*["']?\s*[:=]\s*["']?([^\s"'&,;\]}]+)/gi))
            if (!/^(?:Bearer|Basic)$/i.test(match[1]))
                secrets.add(match[1]);
    }
}
function descriptors(value) {
    return Object.getOwnPropertyDescriptors(value);
}
function collect(value, secrets, seen, depth = 0) {
    if (depth > 8)
        return;
    if (typeof value === 'string') {
        collectText(value, secrets);
        return;
    }
    if (!value || typeof value !== 'object' || seen.has(value))
        return;
    seen.add(value);
    if (value instanceof URL) {
        const href = Object.getOwnPropertyDescriptor(URL.prototype, 'href').get.call(value);
        collectText(href, secrets);
        return;
    }
    if (typeof Headers !== 'undefined' && value instanceof Headers) {
        for (const [key, token] of Headers.prototype.entries.call(value)) {
            if (sensitiveKey.test(normalizeKey(key))) {
                secrets.add(token);
                collectText(token, secrets);
            }
        }
        return;
    }
    const own = descriptors(value);
    for (const [key, descriptor] of Object.entries(own).slice(0, 200)) {
        if (!('value' in descriptor))
            continue;
        const field = descriptor.value;
        if (sensitiveKey.test(normalizeKey(key)) && typeof field === 'string') {
            if (field.length <= maxLength) {
                if (field)
                    secrets.add(field);
                collectText(field, secrets);
            }
        }
        collect(field, secrets, seen, depth + 1);
    }
}
function textRedacted(text, secrets) {
    if (text.length > maxLength)
        return '[Diagnostic text too long]';
    let result = text;
    const decoded = variants(text);
    const last = decoded[decoded.length - 1];
    if (/(?:https?|wss?):\/\/|\b(?:Bearer|Basic)\s|api[-_]?key\s*[:=]/i.test(last))
        result = last;
    result = result.replace(/(?:https?|wss?):\/\/[^\s"'<>\\]+/gi, '[URL REDACTED]');
    result = result.replace(/\b(Bearer|Basic)\s+[a-z0-9._~+/-]+=*/gi, '$1 [REDACTED]');
    result = result.replace(/((?:api[-_]?key|access[-_]?token|refresh[-_]?token|session[-_]?token|password|client[-_]?secret|authorization|auth|token|key|secret)\s*["']?\s*[:=]\s*["']?)([^\s"'&,;\]}]+)/gi, '$1[REDACTED]');
    for (const secret of [...secrets].sort((a, b) => b.length - a.length)) {
        if (!secret)
            continue;
        result = result.split(secret).join(hidden);
        result = result.split(encodeURIComponent(secret)).join(hidden);
    }
    return result.length > 16000 ? result.slice(0, 16000) + '[Truncated]' : result;
}
function clean(value, secrets, seen, depth = 0) {
    if (typeof value === 'string')
        return textRedacted(value, secrets);
    if (typeof value === 'bigint')
        return value.toString();
    if (value === null || typeof value === 'number' || typeof value === 'boolean')
        return value;
    if (value === undefined)
        return undefined;
    if (typeof value !== 'object')
        return '[Nonserializable diagnostic]';
    if (depth > 8)
        return '[Diagnostic depth limit]';
    if (seen.has(value))
        return '[Circular]';
    seen.add(value);
    if (value instanceof Date)
        return Date.prototype.toISOString.call(value);
    if (value instanceof URL)
        return '[URL REDACTED]';
    if (typeof Headers !== 'undefined' && value instanceof Headers)
        return clean(Object.fromEntries(Headers.prototype.entries.call(value)), secrets, seen, depth + 1);
    if (Array.isArray(value))
        return value.slice(0, 200).map((v) => clean(v, secrets, seen, depth + 1));
    const own = descriptors(value);
    const output = Object.create(null);
    if (value instanceof Error)
        output.type = 'Error';
    for (const [key, descriptor] of Object.entries(own).slice(0, 200)) {
        const safeKey = textRedacted(key, secrets);
        if (sensitiveKey.test(normalizeKey(key))) {
            output[safeKey] = hidden;
            continue;
        }
        if (!('value' in descriptor)) {
            output[safeKey] = '[Accessor omitted]';
            continue;
        }
        if (typeof descriptor.value === 'function')
            continue;
        output[safeKey] = clean(descriptor.value, secrets, seen, depth + 1);
    }
    return output;
}
/** Sources contain private values only in memory; the return value never includes them. */
export function redactDiagnostic(value, sources = []) {
    try {
        const secrets = new Set();
        for (const source of sources)
            collect(source, secrets, new WeakSet());
        collect(value, secrets, new WeakSet());
        return clean(value, secrets, new WeakSet());
    }
    catch {
        return '[Diagnostic unavailable]';
    }
}
export function redactDiagnosticText(value, sources = []) {
    const result = redactDiagnostic(value, sources);
    return typeof result === 'string' ? result : '[Diagnostic unavailable]';
}
export function safeErrorMessage(error, sources = [], fallback = 'Unknown error') {
    try {
        const descriptor = error && typeof error === 'object'
            ? Object.getOwnPropertyDescriptor(error, 'message')
            : undefined;
        return descriptor && 'value' in descriptor && typeof descriptor.value === 'string'
            ? redactDiagnosticText(descriptor.value, [...sources, error])
            : redactDiagnosticText(fallback, sources);
    }
    catch {
        return '[Diagnostic unavailable]';
    }
}
//# sourceMappingURL=security-diagnostics.js.map