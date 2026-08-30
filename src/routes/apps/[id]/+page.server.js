import { error } from '@sveltejs/kit';
import * as pm2 from '$srv/pm2.js';
import { tail } from '$srv/logs.js';

export async function load({ params }) {
  try {
    const [proc, logs] = await Promise.all([
      pm2.describe(params.id),
      tail(params.id, 300).catch(() => ({ lines: [] })),
    ]);
    return { proc, initialLogs: logs.lines };
  } catch (err) {
    error(404, err.message);
  }
}
