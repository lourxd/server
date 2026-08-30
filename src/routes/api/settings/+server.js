import { json, error } from '@sveltejs/kit';
import fs from 'node:fs';
import path from 'node:path';
import { setSetting, publicSettings } from '$srv/store/settings.js';
import { githubStatus, probeGithubToken } from '$srv/repos.js';
import { invalidate } from '$srv/cache.js';
import { record } from '$srv/store/audit.js';

export async function GET() {
  return json({ config: await publicSettings(), github: await githubStatus() });
}

export async function POST({ request, locals, getClientAddress }) {
  const body = await request.json().catch(() => ({}));
  const audit = (action, target, detail, ok = true) =>
    record({ user: locals.user, action, target, detail, ok, ip: getClientAddress() });

  try {
    switch (body.action) {
      case 'github-token': {
        const token = String(body.token ?? '').trim();

        if (!token) {
          await setSetting('githubToken', '');
          await setSetting('githubUser', '');
          invalidate('github:');
          audit('settings.github.disconnect');
          return json({ ok: true, github: { connected: false, reason: 'No GitHub token configured.' } });
        }

        const status = await probeGithubToken(token);
        if (!status.connected) {
          audit('settings.github.connect', null, { reason: status.reason }, false);
          error(400, `Token rejected: ${status.reason}`);
        }

        await setSetting('githubToken', token);
        await setSetting('githubUser', status.login || '');
        invalidate('github:');
        audit('settings.github.connect', status.login);
        return json({ ok: true, github: status });
      }

      case 'cloudflare-token': {
        const token = String(body.token ?? '').trim();
        const { probeCloudflareToken } = await import('$srv/cloudflare/api.js');

        if (!token) {
          await setSetting('cloudflareToken', '');
          await setSetting('cloudflareAccountId', '');
          invalidate('cf:');
          audit('settings.cloudflare.disconnect');
          return json({ ok: true, cloudflare: { connected: false, reason: 'No Cloudflare token configured.' } });
        }

        const status = await probeCloudflareToken(token);
        if (!status.connected) {
          audit('settings.cloudflare.connect', null, { reason: status.reason }, false);
          error(400, `Token rejected: ${status.reason}`);
        }

        await setSetting('cloudflareToken', token);
        if (status.accountId) await setSetting('cloudflareAccountId', status.accountId);
        invalidate('cf:');
        audit('settings.cloudflare.connect', status.accountName ?? status.accountId);
        return json({ ok: true, cloudflare: status });
      }

      case 'projects-dir': {
        const dir = path.resolve(String(body.dir ?? '').trim());
        if (!dir || dir === '/') error(400, 'Choose a real directory.');
        try {
          fs.mkdirSync(dir, { recursive: true });
          fs.accessSync(dir, fs.constants.W_OK);
        } catch (err) {
          error(400, `Cannot use that directory: ${err.message}`);
        }
        await setSetting('projectsDir', dir);
        invalidate('repos:');
        audit('settings.projectsDir', dir);
        return json({ ok: true, projectsDir: dir });
      }

      case 'recheck-github': {
        invalidate('github:');
        const { githubStatus: fresh } = await import('$srv/repos.js');
        return json({ ok: true, github: await fresh() });
      }

      case 'allow-signup': {
        const value = !!body.value;
        await setSetting('allowSignUp', value);
        audit('settings.allowSignUp', String(value));
        return json({ ok: true, allowSignUp: value });
      }

      default:
        error(400, `Unknown action: ${body.action}`);
    }
  } catch (err) {
    if (err?.status) throw err;
    error(500, err.message);
  }
}
