import { cloneRepo, gitAction } from '$srv/repos.js';
import { sseJob } from '$srv/sse.js';
import { invalidate } from '$srv/cache.js';

export async function POST({ request }) {
  const body = await request.json().catch(() => ({}));
  const { action } = body;

  return sseJob(async (emit) => {
    const result =
      action === 'clone'
        ? await cloneRepo({ url: body.url, name: body.name, branch: body.branch }, emit)
        : await gitAction(body.path, action, body, emit);

    invalidate('repos:');
    return { code: result.code, name: result.name, path: result.path, ok: result.ok };
  });
}
