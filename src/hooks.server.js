import { redirect } from '@sveltejs/kit';
import { building } from '$app/environment';
import { getSession, needsSetup, runAuthMigrations } from '$srv/auth.js';
import { runStoreMigrations } from '$srv/store/index.js';
import { loadSettings, ensureProjectsDir } from '$srv/store/settings.js';
import { startRealtime } from '$srv/realtime.js';

const ready = (async () => {
  await runStoreMigrations();
  await runAuthMigrations();
  await loadSettings();
  await ensureProjectsDir();
  startRealtime({ intervalMs: 2000 });
})().catch((err) => {
  console.error('[boot] startup failed:', err);
  throw err;
});

const PUBLIC_PREFIXES = ['/login', '/setup', '/api/auth', '/api/health'];
const isPublic = (pathname) => PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'));

export async function handle({ event, resolve }) {
  if (building) return resolve(event);
  await ready;

  const { pathname } = event.url;

  if (pathname.startsWith('/api/auth')) return resolve(event);

  const session = await getSession(event);
  event.locals.session = session?.session ?? null;
  event.locals.user = session?.user ?? null;
  event.locals.authed = !!session?.user;

  if (needsSetup() && pathname !== '/setup' && !isPublic(pathname)) redirect(303, '/setup');
  if (!needsSetup() && pathname === '/setup') redirect(303, event.locals.authed ? '/' : '/login');

  if (!event.locals.authed && !isPublic(pathname)) {
    if (pathname.startsWith('/api/')) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      });
    }
    const next = pathname === '/' ? '' : `?next=${encodeURIComponent(pathname + event.url.search)}`;
    redirect(303, `/login${next}`);
  }

  if (event.locals.authed && pathname === '/login') redirect(303, '/');

  const response = await resolve(event);
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'same-origin');
  return response;
}

export function handleError({ error, event }) {
  console.error(`[error] ${event.request.method} ${event.url.pathname}:`, error);
  return { message: error?.message || 'Unexpected server error' };
}
