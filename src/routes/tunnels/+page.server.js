import { listTunnels, binaryStatus } from '$srv/cloudflare/tunnels.js';
import { cloudflareStatus } from '$srv/cloudflare/api.js';

export async function load() {
  const [tunnels, binary, cloudflare] = await Promise.all([
    listTunnels(),
    binaryStatus(),
    cloudflareStatus(),
  ]);
  return { tunnels, binary, cloudflare };
}
