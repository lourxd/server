import { listTunnels } from '$srv/cloudflare/tunnels.js';
import { publicIp } from '$srv/dns.js';
import { settings } from '$srv/store/settings.js';

export async function load() {
  const [tunnels, ip] = await Promise.all([
    listTunnels().catch(() => []),
    publicIp().catch(() => ({ ip: null })),
  ]);

  const routed = tunnels.flatMap((t) =>
    (t.routes ?? []).map((r) => ({
      hostname: r.hostname,
      via: t.name,
      running: t.running,
      expect: t.cfTunnelId
        ? { type: 'CNAME', value: `${t.cfTunnelId}.cfargotunnel.com` }
        : null,
    })),
  );

  const watched = (settings().watchedDomains ?? []).filter(
    (d) => !routed.some((r) => r.hostname === d),
  );

  return { routed, watched, publicIp: ip.ip ?? null };
}
