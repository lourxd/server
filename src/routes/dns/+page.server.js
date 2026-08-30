import { listZones, RECORD_TYPES } from '$srv/cloudflare/dns.js';
import { cloudflareStatus } from '$srv/cloudflare/api.js';

export async function load() {
  const cloudflare = await cloudflareStatus();
  if (!cloudflare.connected) return { cloudflare, zones: [], recordTypes: RECORD_TYPES };

  try {
    return { cloudflare, zones: await listZones(), recordTypes: RECORD_TYPES };
  } catch (err) {
    return { cloudflare, zones: [], zonesError: err.message, recordTypes: RECORD_TYPES };
  }
}
