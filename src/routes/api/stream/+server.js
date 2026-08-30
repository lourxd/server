import { subscribe, getRecentEvents } from '$srv/realtime.js';
import { sseResponse } from '$srv/sse.js';
import * as metrics from '$srv/metrics.js';
import * as pm2 from '$srv/pm2.js';

export function GET() {
  return sseResponse(
    async (client) => {
      client.comment('connected');

      client.send('metrics', metrics.snapshot());
      try {
        client.send('apps', await pm2.list());
      } catch (err) {
        client.send('error', { message: err.message });
      }
      for (const evt of getRecentEvents().slice(0, 20).reverse()) client.send('pm2:event', evt);

      return subscribe(client);
    },
    { heartbeatMs: 25_000 },
  );
}
