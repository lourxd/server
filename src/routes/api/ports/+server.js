import { json, error } from '@sveltejs/kit';
import { checkPort } from '$srv/ports.js';
import * as pm2 from '$srv/pm2.js';

export async function GET({ url }) {
  const port = url.searchParams.get('port');
  if (!port) error(400, 'A port is required.');
  const apps = await pm2.list().catch(() => []);
  return json(await checkPort(port, { apps }));
}
