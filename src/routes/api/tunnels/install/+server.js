import { installBinary } from '$srv/cloudflare/tunnels.js';
import { sseJob } from '$srv/sse.js';
import { record } from '$srv/store/audit.js';

export async function POST({ locals, getClientAddress }) {
  return sseJob(async (emit) => {
    const res = await installBinary(emit);
    record({ user: locals.user, action: 'tunnel.install-binary', target: res.path, ip: getClientAddress() });
    return res;
  });
}
