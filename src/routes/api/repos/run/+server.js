import { cloneRepo, gitAction } from '$srv/repos.js';
import { sseJob } from '$srv/sse.js';
import { invalidate } from '$srv/cache.js';
import { startBuildLog, appendBuildLog } from '$srv/buildlog.js';
import { begin } from '$srv/activity.js';

export async function POST({ request }) {
  const body = await request.json().catch(() => ({}));
  const { action } = body;

  const logFile = body.buildLogFor
    ? startBuildLog(body.buildLogFor, `${action} ${body.script ?? ''} in ${body.path ?? ''}`)
    : null;

  const ACTIVITY = { 'run-script': 'building', install: 'installing', clone: 'installing' };
  const endActivity = begin(body.buildLogFor ?? body.name, ACTIVITY[action]);

  return sseJob(async (emit) => {
    const tee = (l) => {
      appendBuildLog(logFile, l.line);
      emit(l);
    };

    let result;
    try {
      result =
        action === 'clone'
          ? await cloneRepo({ url: body.url, name: body.name, branch: body.branch }, tee)
          : await gitAction(body.path, action, body, tee);
    } finally {
      endActivity();
    }

    if (logFile) appendBuildLog(logFile, result?.ok ? '--- build succeeded ---' : '--- build failed ---');

    invalidate('repos:');
    return { code: result.code, name: result.name, path: result.path, ok: result.ok };
  });
}
