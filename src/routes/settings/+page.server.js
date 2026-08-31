import { publicSettings } from '$srv/store/settings.js';
import { DATA_DIR } from '$srv/store/index.js';
import { githubStatus } from '$srv/repos.js';
import { cloudflareStatus } from '$srv/cloudflare/api.js';
import { binaryStatus, listTunnels } from '$srv/cloudflare/tunnels.js';
import { listUsers, activeSessionCount } from '$srv/auth.js';
import { recent } from '$srv/store/audit.js';

export async function load({ locals, request }) {
  const isAdmin = locals.user?.role === 'admin';
  const [config, github, cloudflare, binary, tunnels, users, audit] = await Promise.all([
    publicSettings(),
    githubStatus(),
    cloudflareStatus(),
    binaryStatus().catch(() => ({ installed: false, version: null, path: null })),
    listTunnels().catch(() => []),
    isAdmin ? listUsers(request.headers) : [],
    isAdmin ? recent({ limit: 50 }) : [],
  ]);
  return { config, github, cloudflare, binary, tunnels, users, audit, sessions: activeSessionCount(), dataDir: DATA_DIR, isAdmin };
}
