import { cloudflareStatus } from '$srv/cloudflare/api.js';
import { listZones } from '$srv/cloudflare/dns.js';

export async function load() {
  const cloudflare = await cloudflareStatus().catch(() => ({
    connected: false,
    reason: 'Could not reach Cloudflare.',
  }));

  const zones = cloudflare.connected ? await listZones().catch(() => []) : [];
  return { cloudflare, zones };
}
