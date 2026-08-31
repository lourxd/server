import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { eq, asc } from 'drizzle-orm';
import { db, schema } from '../store/index.js';
import { encrypt, decrypt } from '../store/settings.js';
import { cf, cfList, accountId, CloudflareError } from './api.js';
import { upsertRecord, deleteRecord, listZones } from './dns.js';
import { run, runStreaming, which as whichBinary } from '../exec.js';
import { cached, invalidate } from '../cache.js';
import * as pm2 from '../pm2.js';

const { tunnels, tunnelRoutes } = schema;

function requireAccount() {
  const account = accountId();
  if (!account) {
    throw new CloudflareError(
      'This Cloudflare token can see no account, so it cannot create a tunnel. Give it ' +
        'Account · Cloudflare Tunnel · Edit and make sure its Account Resources include your ' +
        'account, then reconnect it under Settings.',
    );
  }
  return account;
}

const TUNNEL_CNAME_SUFFIX = 'cfargotunnel.com';

export function binaryStatus() {
  return cached('cf:cloudflared', 30_000, async () => {
    const binPath = whichBinary('cloudflared');
    if (!binPath) {
      return { installed: false, path: null, version: null, installHint: installHint() };
    }
    const ver = await run(binPath, ['--version'], { timeout: 5000 });
    return {
      installed: true,
      path: binPath,
      version: ver.ok ? ver.stdout.split('\n')[0] : 'unknown',
    };
  });
}

function installHint() {
  const arch = os.arch() === 'arm64' ? 'arm64' : 'amd64';
  return {
    arch,
    deb: `curl -fsSL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${arch}.deb -o /tmp/cloudflared.deb && sudo dpkg -i /tmp/cloudflared.deb`,
    binary: `curl -fsSL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${arch} -o ~/.local/bin/cloudflared && chmod +x ~/.local/bin/cloudflared`,
  };
}

export async function installBinary(onLine = () => {}) {
  const arch = os.arch() === 'arm64' ? 'arm64' : 'amd64';
  const dir = path.join(os.homedir(), '.local', 'bin');
  const target = path.join(dir, 'cloudflared');
  const url = `https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${arch}`;

  await fsp.mkdir(dir, { recursive: true });
  onLine({ stream: 'out', line: `$ curl -fsSL ${url} -o ${target}` });

  const res = await runStreaming(
    'curl',
    ['-fsSL', '--retry', '2', url, '-o', target],
    { timeout: 300_000 },
    onLine,
  );
  if (!res.ok) throw new Error('Download failed. Check the server has outbound HTTPS access.');

  await fsp.chmod(target, 0o755);
  invalidate('cf:cloudflared');

  const ver = await run(target, ['--version'], { timeout: 8000 });
  onLine({ stream: 'out', line: ver.ok ? ver.stdout : 'Installed, but --version failed.' });

  if (!process.env.PATH.split(':').includes(dir)) {
    onLine({ stream: 'err', line: `Note: ${dir} is not on PATH for this service. Restart the panel to pick it up.` });
  }
  return { ok: true, path: target, version: ver.stdout };
}

async function binary() {
  const status = await binaryStatus();
  if (status.installed) return status.path;
  const local = path.join(os.homedir(), '.local', 'bin', 'cloudflared');
  if (fs.existsSync(local)) return local;
  throw new Error('cloudflared is not installed. Install it from the Tunnels page first.');
}

export async function listTunnels() {
  const rows = await db.select().from(tunnels).orderBy(asc(tunnels.name));
  const routes = await db.select().from(tunnelRoutes).orderBy(asc(tunnelRoutes.sortOrder));
  const procs = await pm2.list().catch(() => []);

  return rows.map((t) => {
    const proc = procs.find((p) => p.name === t.pm2Name);
    return {
      ...t,
      token: undefined,
      hasToken: !!t.token,
      routes: routes.filter((r) => r.tunnelId === t.id),
      process: proc
        ? { pmId: proc.pmId, status: proc.status, uptime: proc.uptime, restarts: proc.restarts, cpu: proc.cpu, memory: proc.memory }
        : null,
      running: proc?.status === 'online',
    };
  });
}

export async function getTunnel(id) {
  const [row] = await db.select().from(tunnels).where(eq(tunnels.id, id));
  if (!row) throw new Error('Tunnel not found.');
  const routes = await db.select().from(tunnelRoutes).where(eq(tunnelRoutes.tunnelId, id)).orderBy(asc(tunnelRoutes.sortOrder));
  return { ...row, token: decrypt(row.token), routes };
}

export function listRemoteTunnels() {
  const account = requireAccount();
  return cached('cf:tunnels', 30_000, async () => {
    const list = await cfList(`/accounts/${account}/cfd_tunnel`, { query: { is_deleted: 'false' } });
    return list.map((t) => ({
      id: t.id,
      name: t.name,
      status: t.status,
      createdAt: t.created_at,
      connections: t.connections?.length ?? 0,
    }));
  });
}

export async function createTunnel({ name }) {
  const account = requireAccount();

  const clean = String(name || '').trim();
  if (!/^[a-z0-9][a-z0-9-]{1,60}$/i.test(clean)) {
    throw new Error('Tunnel names may use letters, numbers and hyphens.');
  }

  const created = await cf(`/accounts/${account}/cfd_tunnel`, {
    method: 'POST',
    body: { name: clean, tunnel_secret: crypto.randomBytes(32).toString('base64'), config_src: 'cloudflare' },
  });

  const token = await cf(`/accounts/${account}/cfd_tunnel/${created.id}/token`);

  const row = {
    id: crypto.randomUUID(),
    name: clean,
    cfTunnelId: created.id,
    accountId: account,
    kind: 'named',
    token: encrypt(token),
    pm2Name: `tunnel-${clean}`,
    lastStatus: 'created',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await db.insert(tunnels).values(row);
  invalidate('cf:tunnels');
  return { ...row, token: undefined, hasToken: true };
}

export async function adoptTunnel(cfTunnelId) {
  const account = requireAccount();
  const remote = await cf(`/accounts/${account}/cfd_tunnel/${cfTunnelId}`);
  const token = await cf(`/accounts/${account}/cfd_tunnel/${cfTunnelId}/token`);

  const row = {
    id: crypto.randomUUID(),
    name: remote.name,
    cfTunnelId: remote.id,
    accountId: account,
    kind: 'named',
    token: encrypt(token),
    pm2Name: `tunnel-${remote.name}`,
    lastStatus: remote.status ?? 'unknown',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await db.insert(tunnels).values(row);
  invalidate('cf:tunnels');
  return { ...row, token: undefined, hasToken: true };
}

export async function syncIngress(tunnelId) {
  const tunnel = await getTunnel(tunnelId);
  if (tunnel.kind !== 'named') throw new Error('Quick tunnels do not support ingress rules.');

  const ingress = tunnel.routes.map((r) => ({
    hostname: r.hostname,
    service: r.service,
    ...(r.path ? { path: r.path } : {}),
  }));
  ingress.push({ service: 'http_status:404' });

  await cf(`/accounts/${tunnel.accountId}/cfd_tunnel/${tunnel.cfTunnelId}/configurations`, {
    method: 'PUT',
    body: { config: { ingress } },
  });

  await db.update(tunnels).set({ updatedAt: Date.now() }).where(eq(tunnels.id, tunnelId));
  return { ok: true, rules: ingress.length };
}

export async function addRoute(tunnelId, { hostname, service, path: routePath }) {
  const tunnel = await getTunnel(tunnelId);
  if (tunnel.kind !== 'named') throw new Error('Quick tunnels get a random URL and cannot take custom hostnames.');

  const host = String(hostname || '').trim().toLowerCase();
  if (!/^[a-z0-9*]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9-]+)+$/.test(host)) {
    throw new Error('Enter a fully-qualified hostname, for example app.example.com.');
  }

  const target = String(service || '').trim();
  if (!/^(https?|tcp|ssh|rdp|unix):\/\//.test(target)) {
    throw new Error('Service must be a URL such as http://localhost:3000.');
  }

  const zones = await listZones();
  const zone = zones
    .filter((z) => host === z.name || host.endsWith(`.${z.name}`))
    .sort((a, b) => b.name.length - a.name.length)[0];
  if (!zone) {
    if (!zones.length) {
      throw new Error(
        `This Cloudflare token cannot see any zone, so ${host} cannot be routed. Give it ` +
          'Zone · Zone · Read and Zone · DNS · Edit, and make sure its Zone Resources include the ' +
          'domain — a token scoped to one zone will not list the others.',
      );
    }
    throw new Error(
      `No zone this token can see covers ${host}. It sees ${zones.map((z) => z.name).join(', ')}.`,
    );
  }

  const record = await upsertRecord(zone.id, {
    type: 'CNAME',
    name: host,
    content: `${tunnel.cfTunnelId}.${TUNNEL_CNAME_SUFFIX}`,
    proxied: true,
    ttlAuto: true,
    comment: `Cloudflare Tunnel: ${tunnel.name}`,
  });

  await db.insert(tunnelRoutes).values({
    id: crypto.randomUUID(),
    tunnelId,
    hostname: host,
    service: target,
    path: routePath?.trim() || null,
    dnsRecordId: record.id,
    zoneId: zone.id,
    sortOrder: tunnel.routes.length,
    createdAt: Date.now(),
  });

  await syncIngress(tunnelId);
  return { ok: true, hostname: host, zone: zone.name, recordId: record.id };
}

export async function removeRoute(routeId, { removeDns = true } = {}) {
  const [route] = await db.select().from(tunnelRoutes).where(eq(tunnelRoutes.id, routeId));
  if (!route) throw new Error('Route not found.');

  if (removeDns && route.dnsRecordId && route.zoneId) {
    await deleteRecord(route.zoneId, route.dnsRecordId).catch(() => {});
  }

  await db.delete(tunnelRoutes).where(eq(tunnelRoutes.id, routeId));
  await syncIngress(route.tunnelId).catch(() => {});
  return { ok: true };
}

export async function startTunnel(tunnelId) {
  const tunnel = await getTunnel(tunnelId);
  const bin = await binary();

  if (tunnel.kind === 'quick') return startQuickTunnel(tunnelId);
  if (!tunnel.token) throw new Error('This tunnel has no run token stored. Re-adopt it from Cloudflare.');

  const name = tunnel.pm2Name || `tunnel-${tunnel.name}`;

  await pm2.del(name).catch(() => {});

  await pm2.start({
    script: bin,
    name,
    args: ['tunnel', '--no-autoupdate', '--metrics', '127.0.0.1:0', 'run'],
    env: { SCP_KIND: 'tunnel', TUNNEL_TOKEN: tunnel.token },
    exec_mode: 'fork',
    autorestart: true,
    max_restarts: 20,
    restart_delay: 3000,
    time: true,
    interpreter: 'none',
  });

  await db.update(tunnels).set({ lastStatus: 'running', pm2Name: name, updatedAt: Date.now() }).where(eq(tunnels.id, tunnelId));
  return { ok: true, pm2Name: name };
}

export async function startQuickTunnel(tunnelId) {
  const tunnel = await getTunnel(tunnelId);
  const bin = await binary();
  const route = tunnel.routes[0];
  if (!route) throw new Error('Add a local service for this quick tunnel first, e.g. http://localhost:3000.');

  const name = tunnel.pm2Name || `tunnel-${tunnel.name}`;
  await pm2.del(name).catch(() => {});

  await pm2.start({
    script: bin,
    name,
    args: ['tunnel', '--no-autoupdate', '--url', route.service],
    exec_mode: 'fork',
    autorestart: true,
    time: true,
    interpreter: 'none',
  });

  await db.update(tunnels).set({ lastStatus: 'running', pm2Name: name, quickUrl: null, updatedAt: Date.now() }).where(eq(tunnels.id, tunnelId));
  return { ok: true, pm2Name: name, note: 'The public URL appears in the log within a few seconds.' };
}

const QUICK_URL = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

export async function discoverQuickUrl(tunnelId) {
  const tunnel = await getTunnel(tunnelId);
  if (!tunnel.pm2Name) return null;

  const { tail } = await import('../logs.js');
  const { lines } = await tail(tunnel.pm2Name, 200).catch(() => ({ lines: [] }));

  for (const entry of [...lines].reverse()) {
    const match = QUICK_URL.exec(entry.line ?? '');
    if (match) {
      await db.update(tunnels).set({ quickUrl: match[0], updatedAt: Date.now() }).where(eq(tunnels.id, tunnelId));
      return match[0];
    }
  }
  return null;
}

export async function stopTunnel(tunnelId) {
  const tunnel = await getTunnel(tunnelId);
  if (tunnel.pm2Name) await pm2.stop(tunnel.pm2Name).catch(() => {});
  await db.update(tunnels).set({ lastStatus: 'stopped', updatedAt: Date.now() }).where(eq(tunnels.id, tunnelId));
  return { ok: true };
}

export async function createQuickTunnel({ name, service }) {
  const clean = String(name || '').trim() || `quick-${Date.now().toString(36)}`;
  const target = String(service || '').trim();
  if (!/^https?:\/\//.test(target)) throw new Error('Service must be a URL such as http://localhost:3000.');

  const id = crypto.randomUUID();
  await db.insert(tunnels).values({
    id,
    name: clean,
    kind: 'quick',
    pm2Name: `tunnel-${clean}`,
    lastStatus: 'created',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  await db.insert(tunnelRoutes).values({
    id: crypto.randomUUID(),
    tunnelId: id,
    hostname: '(assigned by Cloudflare)',
    service: target,
    sortOrder: 0,
    createdAt: Date.now(),
  });
  return { ok: true, id };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function remoteTunnel(account, cfTunnelId) {
  try {
    return await cf(`/accounts/${account}/cfd_tunnel/${cfTunnelId}`);
  } catch (err) {
    if (/404|not found/i.test(err.message)) return null;
    throw err;
  }
}

async function drainConnections(account, cfTunnelId, onLine = () => {}) {
  await cf(`/accounts/${account}/cfd_tunnel/${cfTunnelId}/connections`, { method: 'DELETE' }).catch(
    () => {},
  );

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const remote = await remoteTunnel(account, cfTunnelId);
    if (!remote) return true;

    const open = (remote.connections ?? []).length;
    if (open === 0) return true;

    onLine(`waiting for ${open} connection${open === 1 ? '' : 's'} to close`);
    await wait(1500);
    await cf(`/accounts/${account}/cfd_tunnel/${cfTunnelId}/connections`, { method: 'DELETE' }).catch(
      () => {},
    );
  }
  return false;
}

export async function deleteTunnel(tunnelId, { deleteRemote = true } = {}) {
  const tunnel = await getTunnel(tunnelId);

  if (tunnel.pm2Name) {
    await pm2.del(tunnel.pm2Name).catch(() => {});
  }

  for (const route of tunnel.routes) {
    if (route.dnsRecordId && route.zoneId) {
      await deleteRecord(route.zoneId, route.dnsRecordId).catch(() => {});
    }
  }

  let removedRemotely = false;

  if (deleteRemote && tunnel.kind === 'named' && tunnel.cfTunnelId) {
    const account = tunnel.accountId ?? accountId();
    if (!account) throw new CloudflareError('No Cloudflare account is configured, so the tunnel cannot be deleted there.');

    await drainConnections(account, tunnel.cfTunnelId);

    try {
      await cf(`/accounts/${account}/cfd_tunnel/${tunnel.cfTunnelId}`, { method: 'DELETE' });
      removedRemotely = true;
    } catch (err) {
      const remote = await remoteTunnel(account, tunnel.cfTunnelId).catch(() => null);
      if (!remote || remote.deleted_at) {
        removedRemotely = true;
      } else {
        throw new CloudflareError(
          `${tunnel.name} was stopped here, but Cloudflare would not delete it: ${err.message}. ` +
            'It is still in your account — try again in a moment, or remove it from the Cloudflare dashboard.',
        );
      }
    }
  }

  await db.delete(tunnels).where(eq(tunnels.id, tunnelId));
  invalidate('cf:tunnels');
  return { ok: true, removedRemotely };
}

export async function tunnelHealth(tunnelId) {
  const tunnel = await getTunnel(tunnelId);
  if (tunnel.kind !== 'named' || !tunnel.cfTunnelId) return { status: 'n/a', connections: [] };

  const remote = await cf(`/accounts/${tunnel.accountId}/cfd_tunnel/${tunnel.cfTunnelId}`);
  return {
    status: remote.status,
    connections: (remote.connections ?? []).map((c) => ({
      id: c.id,
      colo: c.colo_name,
      origin: c.origin_ip,
      openedAt: c.opened_at,
      clientVersion: c.client_version,
    })),
  };
}
