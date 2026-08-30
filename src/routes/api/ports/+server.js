import { json, error } from '@sveltejs/kit';
import { checkPort } from '$srv/ports.js';

export async function GET({ url }) {
  const port = url.searchParams.get('port');
  if (!port) error(400, 'A port is required.');
  return json(await checkPort(port));
}
