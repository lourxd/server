import { settings } from '../store/settings.js';
import { cached } from '../cache.js';

const BASE = 'https://api.cloudflare.com/client/v4';

export class CloudflareError extends Error {
  constructor(message, { status, errors = [] } = {}) {
    super(message);
    this.name = 'CloudflareError';
    this.status = status;
    this.errors = errors;
  }
}

export async function cf(path, { token, method = 'GET', body, query } = {}) {
  const apiToken = token || settings().cloudflareToken;
  if (!apiToken) throw new CloudflareError('No Cloudflare API token configured. Add one under Settings.');

  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v != null && v !== '') url.searchParams.set(k, String(v));
  }

  let res;
  try {
    res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    throw new CloudflareError(
      err.name === 'TimeoutError' ? 'Cloudflare API timed out.' : `Could not reach Cloudflare: ${err.message}`,
    );
  }

  const text = await res.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new CloudflareError(`Cloudflare returned a non-JSON response (${res.status}).`, { status: res.status });
  }

  if (!res.ok || payload.success === false) {
    const errors = payload.errors ?? [];
    const detail = errors.map((e) => `${e.message}${e.code ? ` (${e.code})` : ''}`).join('; ');
    throw new CloudflareError(detail || `Cloudflare API error ${res.status}`, { status: res.status, errors });
  }

  return payload.result;
}

export async function cfList(path, { token, query = {}, max = 1000 } = {}) {
  const out = [];
  let page = 1;
  while (out.length < max) {
    const batch = await cf(path, { token, query: { ...query, page, per_page: 100 } });
    if (!Array.isArray(batch) || batch.length === 0) break;
    out.push(...batch);
    if (batch.length < 100) break;
    page += 1;
  }
  return out.slice(0, max);
}

export async function probeCloudflareToken(token) {
  try {
    const verify = await cf('/user/tokens/verify', { token });
    if (verify?.status && verify.status !== 'active') {
      return { connected: false, reason: `Token status is "${verify.status}".` };
    }

    const accounts = await cf('/accounts', { token, query: { per_page: 50 } }).catch(() => []);
    const zones = await cf('/zones', { token, query: { per_page: 50, status: 'active' } }).catch(() => []);

    const fromAccounts = accounts?.[0] ?? null;
    const fromZone = (zones ?? []).map((z) => z.account).find((a) => a?.id) ?? null;
    const account = fromAccounts ?? fromZone;

    return {
      connected: true,
      tokenId: verify?.id ?? null,
      accountId: account?.id ?? null,
      accountName: account?.name ?? null,
      zoneCount: Array.isArray(zones) ? zones.length : 0,
      needsAccountId: !account,
      reason: account
        ? Array.isArray(zones) && zones.length === 0
          ? 'No zones are visible to this token, so a hostname cannot be routed yet. Add Zone · Zone · Read and Zone · DNS · Edit.'
          : null
        : 'The token works, but the panel could not work out which account to use — listing accounts needs Account · Account Settings · Read, which Cloudflare Tunnel · Edit does not include. Paste your Account ID below and everything else will work.',
    };
  } catch (err) {
    return { connected: false, reason: err.message };
  }
}export function cloudflareStatus() {
  const token = settings().cloudflareToken;
  if (!token) return Promise.resolve({ connected: false, reason: 'No Cloudflare API token configured.' });
  return cached('cf:status', 60_000, () => probeCloudflareToken(token));
}

export function accountId() {
  return settings().cloudflareAccountId || null;
}
