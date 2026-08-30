import { json, error } from '@sveltejs/kit';
import * as dns from '$srv/cloudflare/dns.js';
import { record } from '$srv/store/audit.js';
import { CloudflareError } from '$srv/cloudflare/api.js';

export async function GET({ url }) {
  const op = url.searchParams.get('op') ?? 'zones';
  const zoneId = url.searchParams.get('zoneId');
  try {
    switch (op) {
      case 'zones':
        return json(await dns.listZones());
      case 'records':
        return json(
          await dns.listRecords(zoneId, {
            type: url.searchParams.get('type') || undefined,
            search: url.searchParams.get('search') || undefined,
          }),
        );
      case 'resolve':
        return json(
          await dns.resolve(url.searchParams.get('hostname'), url.searchParams.get('type') || 'A'),
        );
      case 'public-ip':
        return json(await dns.publicIp());
      default:
        error(400, `Unknown operation: ${op}`);
    }
  } catch (err) {
    if (err?.status) throw err;
    error(err instanceof CloudflareError ? 400 : 500, err.message);
  }
}

export async function POST({ request, locals, getClientAddress }) {
  const body = await request.json().catch(() => ({}));
  const audit = (action, target, detail, ok = true) =>
    record({ user: locals.user, action, target, detail, ok, ip: getClientAddress() });

  try {
    switch (body.action) {
      case 'create': {
        const r = await dns.createRecord(body.zoneId, body.record ?? body);
        audit('dns.record.create', r.name, { type: r.type, content: r.content });
        return json(r);
      }
      case 'update': {
        const r = await dns.updateRecord(body.zoneId, body.recordId, body.record ?? body);
        audit('dns.record.update', r.name, { type: r.type, content: r.content });
        return json(r);
      }
      case 'delete': {
        const r = await dns.deleteRecord(body.zoneId, body.recordId);
        audit('dns.record.delete', body.name ?? body.recordId);
        return json(r);
      }
      default:
        error(400, `Unknown action: ${body.action}`);
    }
  } catch (err) {
    if (err?.status) throw err;
    audit(`dns.${body.action}`, body.name, { error: err.message }, false);
    error(err instanceof CloudflareError ? 400 : 500, err.message);
  }
}
