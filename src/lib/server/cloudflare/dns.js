import dns from 'node:dns/promises';
import { cf, cfList } from './api.js';
import { cached, invalidate } from '../cache.js';

export const RECORD_TYPES = ['A', 'AAAA', 'CNAME', 'TXT', 'MX', 'NS', 'SRV', 'CAA'];

const PROXYABLE = new Set(['A', 'AAAA', 'CNAME']);

export function isProxyable(type) {
  return PROXYABLE.has(type);
}

export function listZones() {
  return cached('cf:zones', 60_000, async () => {
    const zones = await cfList('/zones', { query: { status: 'active' } });
    return zones.map((z) => ({
      id: z.id,
      name: z.name,
      status: z.status,
      paused: z.paused,
      type: z.type,
      nameServers: z.name_servers ?? [],
      accountId: z.account?.id ?? null,
      accountName: z.account?.name ?? null,
      plan: z.plan?.name ?? null,
    }));
  });
}

function shapeRecord(r) {
  return {
    id: r.id,
    zoneId: r.zone_id,
    zoneName: r.zone_name,
    type: r.type,
    name: r.name,
    content: r.content,
    ttl: r.ttl,
    ttlAuto: r.ttl === 1,
    proxied: !!r.proxied,
    proxiable: !!r.proxiable,
    priority: r.priority ?? null,
    comment: r.comment ?? null,
    tags: r.tags ?? [],
    locked: !!r.locked,
    createdAt: r.created_on,
    modifiedAt: r.modified_on,
  };
}

export function listRecords(zoneId, { type, search } = {}) {
  const key = `cf:records:${zoneId}:${type ?? ''}:${search ?? ''}`;
  return cached(key, 15_000, async () => {
    const records = await cfList(`/zones/${zoneId}/dns_records`, {
      query: { type: type || undefined, name: search ? `contains:${search}` : undefined, order: 'type' },
    });
    return records.map(shapeRecord);
  });
}

function toRecordBody(input) {
  const type = String(input.type || '').toUpperCase();
  if (!RECORD_TYPES.includes(type)) throw new Error(`Unsupported record type: ${type}`);

  const name = String(input.name ?? '').trim();
  if (!name) throw new Error('A record name is required (use "@" for the zone root).');

  const content = String(input.content ?? '').trim();
  if (!content) throw new Error('A record value is required.');

  if (type === 'A' && !/^\d{1,3}(\.\d{1,3}){3}$/.test(content)) {
    throw new Error('An A record needs an IPv4 address, for example 203.0.113.10.');
  }
  if (type === 'AAAA' && !content.includes(':')) {
    throw new Error('An AAAA record needs an IPv6 address.');
  }
  if (type === 'MX' && input.priority == null) {
    throw new Error('An MX record needs a priority, for example 10.');
  }

  const ttl = input.ttlAuto ? 1 : Number(input.ttl || 1);
  if (ttl !== 1 && (ttl < 60 || ttl > 86400)) {
    throw new Error('TTL must be 1 (automatic) or between 60 and 86400 seconds.');
  }

  const body = {
    type,
    name,
    content,
    ttl,
    comment: input.comment?.trim() || undefined,
  };

  if (isProxyable(type)) body.proxied = !!input.proxied;
  if (type === 'MX' || type === 'SRV') body.priority = Number(input.priority ?? 10);

  return body;
}

export async function createRecord(zoneId, input) {
  const result = await cf(`/zones/${zoneId}/dns_records`, { method: 'POST', body: toRecordBody(input) });
  invalidate(`cf:records:${zoneId}`);
  return shapeRecord(result);
}

export async function updateRecord(zoneId, recordId, input) {
  const result = await cf(`/zones/${zoneId}/dns_records/${recordId}`, {
    method: 'PUT',
    body: toRecordBody(input),
  });
  invalidate(`cf:records:${zoneId}`);
  return shapeRecord(result);
}

export async function deleteRecord(zoneId, recordId) {
  await cf(`/zones/${zoneId}/dns_records/${recordId}`, { method: 'DELETE' });
  invalidate(`cf:records:${zoneId}`);
  return { ok: true };
}

export async function upsertRecord(zoneId, input) {
  const existing = await cfList(`/zones/${zoneId}/dns_records`, { query: { name: input.name } });
  const match = existing.find((r) => r.name === input.name && r.type === input.type);
  return match ? updateRecord(zoneId, match.id, input) : createRecord(zoneId, input);
}

export async function resolve(hostname, type = 'A') {
  const started = Date.now();
  try {
    const resolver = new dns.Resolver({ timeout: 5000, tries: 2 });
    resolver.setServers(['1.1.1.1', '8.8.8.8']);

    const answers = await resolver.resolve(hostname, type);
    return {
      ok: true,
      hostname,
      type,
      answers: (Array.isArray(answers) ? answers : [answers]).map((a) =>
        typeof a === 'string' ? a : JSON.stringify(a),
      ),
      durationMs: Date.now() - started,
    };
  } catch (err) {
    const reasons = {
      ENOTFOUND: 'No such hostname.',
      ENODATA: `No ${type} record found.`,
      ETIMEOUT: 'The DNS query timed out.',
      SERVFAIL: 'The resolver returned SERVFAIL.',
    };
    return {
      ok: false,
      hostname,
      type,
      error: reasons[err.code] ?? err.message,
      code: err.code,
      durationMs: Date.now() - started,
    };
  }
}

export function publicIp() {
  return cached('cf:publicip', 300_000, async () => {
    const res = await fetch('https://cloudflare.com/cdn-cgi/trace', { signal: AbortSignal.timeout(8000) });
    const text = await res.text();
    const ip = text.match(/^ip=(.+)$/m)?.[1] ?? null;
    return { ip, ipv6: ip?.includes(':') ?? false };
  });
}
