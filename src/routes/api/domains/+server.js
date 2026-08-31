import { json, error } from '@sveltejs/kit';
import { checkDomain, resolve, publicIp, RECORD_TYPES } from '$srv/dns.js';
import { settings, setSetting } from '$srv/store/settings.js';

const HOSTNAME = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;

const watched = () => (Array.isArray(settings().watchedDomains) ? settings().watchedDomains : []);

export async function GET({ url }) {
  const op = url.searchParams.get('op') ?? 'check';
  try {
    if (op === 'resolve') {
      const type = url.searchParams.get('type') || 'A';
      if (!RECORD_TYPES.includes(type)) error(400, `Unsupported record type: ${type}`);
      return json(await resolve(url.searchParams.get('hostname'), type));
    }
    if (op === 'public-ip') return json(await publicIp());
    return json(await checkDomain({ hostname: url.searchParams.get('hostname') }));
  } catch (err) {
    if (err?.status) throw err;
    error(500, err.message);
  }
}

export async function POST({ request }) {
  const body = await request.json().catch(() => ({}));
  const host = String(body.hostname ?? '').trim().toLowerCase();

  try {
    if (body.action === 'watch') {
      if (!HOSTNAME.test(host)) error(400, `"${host}" is not a hostname.`);
      const next = [...new Set([...watched(), host])].sort();
      await setSetting('watchedDomains', next);
      return json({ ok: true, domains: next });
    }
    if (body.action === 'unwatch') {
      const next = watched().filter((d) => d !== host);
      await setSetting('watchedDomains', next);
      return json({ ok: true, domains: next });
    }
    error(400, `Unknown action: ${body.action}`);
  } catch (err) {
    if (err?.status) throw err;
    error(500, err.message);
  }
}
