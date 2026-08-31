import dns from 'node:dns/promises';
import { cached } from './cache.js';

const RESOLVERS = ['1.1.1.1', '8.8.8.8'];

export const RECORD_TYPES = ['A', 'AAAA', 'CNAME', 'TXT', 'MX', 'NS', 'SRV', 'CAA'];

const REASONS = {
  ENOTFOUND: 'No such hostname.',
  ENODATA: 'No record of that type.',
  ETIMEOUT: 'The DNS query timed out.',
  SERVFAIL: 'The resolver returned SERVFAIL.',
  EREFUSED: 'The resolver refused the query.',
};

function resolver() {
  const r = new dns.Resolver({ timeout: 5000, tries: 2 });
  r.setServers(RESOLVERS);
  return r;
}

export async function resolve(hostname, type = 'A') {
  const started = Date.now();
  const host = String(hostname ?? '').trim();
  if (!host) return { ok: false, hostname: host, type, error: 'No hostname given.' };

  try {
    const answers = await resolver().resolve(host, type);
    return {
      ok: true,
      hostname: host,
      type,
      answers: (Array.isArray(answers) ? answers : [answers]).map((a) =>
        typeof a === 'string' ? a : JSON.stringify(a),
      ),
      durationMs: Date.now() - started,
    };
  } catch (err) {
    return {
      ok: false,
      hostname: host,
      type,
      error: REASONS[err.code] ?? err.message,
      code: err.code,
      durationMs: Date.now() - started,
    };
  }
}

export async function publicIp() {
  return cached('dns:publicip', 300_000, async () => {
    for (const url of ['https://api.ipify.org', 'https://icanhazip.com']) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
        const ip = (await res.text()).trim();
        if (/^[0-9a-f.:]+$/i.test(ip)) return { ip };
      } catch {
      }
    }
    return { ip: null };
  });
}

const CLOUDFLARE_RANGES = /^(104\.(1[6-9]|2[0-9]|3[01])\.|172\.6[4-9]\.|172\.7[0-1]\.|188\.114\.|190\.93\.|197\.234\.|198\.41\.)/;

async function reach(hostname) {
  for (const scheme of ['https', 'http']) {
    try {
      const res = await fetch(`${scheme}://${hostname}/`, {
        method: 'GET',
        redirect: 'manual',
        signal: AbortSignal.timeout(8000),
      });
      return { ok: res.status < 500, status: res.status, scheme };
    } catch (err) {
      if (scheme === 'http') return { ok: false, status: null, error: err.message };
    }
  }
  return { ok: false, status: null };
}

export async function checkDomain({ hostname, expect } = {}) {
  const host = String(hostname ?? '').trim();
  if (!host) return { hostname: host, resolves: false, error: 'No hostname given.' };

  const [cname, a] = await Promise.all([resolve(host, 'CNAME'), resolve(host, 'A')]);
  const answers = [...(cname.ok ? cname.answers : []), ...(a.ok ? a.answers : [])];
  const resolves = answers.length > 0;

  const proxied = answers.some((v) => CLOUDFLARE_RANGES.test(String(v)));
  const http = resolves ? await reach(host) : { ok: false, status: null };

  return {
    hostname: host,
    resolves,
    answers,
    proxied,
    http,
    expect: expect ?? null,
    serving: !!http.ok,
    error: resolves ? null : (cname.error ?? a.error ?? 'No record found.'),
    checkedAt: Date.now(),
  };
}
