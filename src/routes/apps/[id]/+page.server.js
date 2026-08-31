import { error } from '@sveltejs/kit';
import fs from 'node:fs';
import path from 'node:path';
import * as pm2 from '$srv/pm2.js';
import { tail } from '$srv/logs.js';
import { listConnections } from '$srv/db/index.js';
import { settings } from '$srv/store/settings.js';
import { isRemote, ENGINES } from '$srv/db/provision.js';
import { cloudflareStatus } from '$srv/cloudflare/api.js';
import { binaryStatus, listTunnels } from '$srv/cloudflare/tunnels.js';
import { listZones } from '$srv/cloudflare/dns.js';

function secretKeys(cwd) {
  if (!cwd) return [];
  try {
    return fs
      .readFileSync(path.join(cwd, '.env'), 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#') && l.includes('='))
      .map((l) => l.slice(0, l.indexOf('=')).replace(/^export\s+/, '').trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

export async function load({ params }) {
  try {
    const [proc, logs, connections, cloudflare, binary, tunnels, zones] = await Promise.all([
      pm2.describe(params.id),
      tail(params.id, 300).catch(() => ({ lines: [] })),
      listConnections().catch(() => []),
      cloudflareStatus().catch(() => ({ connected: false, reason: 'Could not reach Cloudflare.' })),
      binaryStatus().catch(() => ({ installed: false })),
      listTunnels().catch(() => []),
      listZones().catch(() => []),
    ]);

    const plain = pm2.appEnv(proc.env);
    const envVars = [
      ...Object.entries(plain).map(([key, value]) => ({ key, value, secret: false })),
      ...secretKeys(proc.cwd).map((key) => ({ key, value: '', secret: true, stored: true })),
    ];

    const { env: _env, ...process } = proc;

    return {
      proc: process,
      initialLogs: logs.lines,
      envVars,
      relPath: proc.cwd ? path.relative(path.resolve(settings().projectsDir), proc.cwd) : null,
      databases: connections.map((c) => ({ ...c, remote: isRemote(c) })),
      catalogue: ENGINES,
      attached: { id: proc.env?.SCP_DB ?? null, varName: proc.env?.SCP_DB_VAR ?? null },
      port: plain.PORT ?? null,
      cloudflare,
      binary,
      tunnels,
      zones,
    };
  } catch (err) {
    error(404, err.message);
  }
}
