import { json, error } from '@sveltejs/kit';
import { readBuildLog } from '$srv/buildlog.js';
import { tail, daemonLog } from '$srv/logs.js';

export async function GET({ params, url }) {
  if (url.searchParams.get('kind') === 'build') {
    return json(readBuildLog(url.searchParams.get('name') ?? params.id));
  }

  const lines = Math.min(Number(url.searchParams.get('lines')) || 200, 5000);
  try {
    if (params.id === '_daemon') {
      return json({
        process: { name: 'pm2 daemon', pmId: null, status: 'n/a' },
        lines: (await daemonLog(lines)).map((line) => ({ stream: 'out', line })),
      });
    }
    return json(await tail(params.id, lines));
  } catch (err) {
    error(404, err.message);
  }
}
