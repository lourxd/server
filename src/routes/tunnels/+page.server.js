import { cloudflareStatus } from '$srv/cloudflare/api.js';
import { binaryStatus, listTunnels } from '$srv/cloudflare/tunnels.js';
import { listZones } from '$srv/cloudflare/dns.js';

export async function load() {
  const cloudflare = await cloudflareStatus().catch(() => ({
    connected: false,
    reason: 'Could not reach Cloudflare.',
  }));

  const [binary, tunnels, zones] = await Promise.all([
    binaryStatus().catch(() => ({ installed: false, path: null, version: null })),
    listTunnels().catch(() => []),
    cloudflare.connected ? listZones().catch(() => []) : Promise.resolve([]),
  ]);

  return { cloudflare, binary, tunnels, zones };
}
