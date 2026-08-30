import { json, error } from '@sveltejs/kit';
import * as tunnels from '$srv/cloudflare/tunnels.js';
import { record } from '$srv/store/audit.js';
import { CloudflareError } from '$srv/cloudflare/api.js';

export async function GET({ url }) {
  const op = url.searchParams.get('op') ?? 'list';
  const id = url.searchParams.get('id');
  try {
    switch (op) {
      case 'list':
        return json(await tunnels.listTunnels());
      case 'binary':
        return json(await tunnels.binaryStatus());
      case 'remote':
        return json(await tunnels.listRemoteTunnels());
      case 'health':
        return json(await tunnels.tunnelHealth(id));
      case 'quick-url':
        return json({ url: await tunnels.discoverQuickUrl(id) });
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
        const t = await tunnels.createTunnel({ name: body.name });
        audit('tunnel.create', t.name, { cfTunnelId: t.cfTunnelId });
        return json(t);
      }
      case 'create-quick': {
        const t = await tunnels.createQuickTunnel({ name: body.name, service: body.service });
        audit('tunnel.create-quick', body.name, { service: body.service });
        return json(t);
      }
      case 'adopt': {
        const t = await tunnels.adoptTunnel(body.cfTunnelId);
        audit('tunnel.adopt', t.name);
        return json(t);
      }
      case 'start': {
        const r = await tunnels.startTunnel(body.id);
        audit('tunnel.start', body.id);
        return json(r);
      }
      case 'stop': {
        const r = await tunnels.stopTunnel(body.id);
        audit('tunnel.stop', body.id);
        return json(r);
      }
      case 'delete': {
        const r = await tunnels.deleteTunnel(body.id, { deleteRemote: body.deleteRemote !== false });
        audit('tunnel.delete', body.id, { deleteRemote: body.deleteRemote !== false });
        return json(r);
      }
      case 'add-route': {
        const r = await tunnels.addRoute(body.id, body);
        audit('tunnel.route.add', body.hostname, { service: body.service });
        return json(r);
      }
      case 'remove-route': {
        const r = await tunnels.removeRoute(body.routeId, { removeDns: body.removeDns !== false });
        audit('tunnel.route.remove', body.routeId);
        return json(r);
      }
      case 'sync':
        return json(await tunnels.syncIngress(body.id));
      default:
        error(400, `Unknown action: ${body.action}`);
    }
  } catch (err) {
    if (err?.status) throw err;
    audit(`tunnel.${body.action}`, body.id ?? body.name, { error: err.message }, false);
    error(err instanceof CloudflareError ? 400 : 500, err.message);
  }
}
