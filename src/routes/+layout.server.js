import * as metrics from '$srv/metrics.js';

export async function load({ locals }) {
  if (!locals.authed) return { authed: false, host: null, user: null };
  return {
    authed: true,
    user: { id: locals.user.id, email: locals.user.email, name: locals.user.name, role: locals.user.role },
    host: await metrics.getStatic(),
  };
}
