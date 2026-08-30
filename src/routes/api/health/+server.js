import { json } from '@sveltejs/kit';
import { needsSetup } from '$srv/auth.js';
import { version } from '$app/environment';

const startedAt = Date.now();

export function GET() {
  return json({
    ok: true,
    status: needsSetup() ? 'setup-required' : 'ready',
    version,
    uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
  });
}
