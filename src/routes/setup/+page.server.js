import { redirect } from '@sveltejs/kit';
import { needsSetup } from '$srv/auth.js';

export function load() {
  if (!needsSetup()) redirect(303, '/login');
  return {};
}
