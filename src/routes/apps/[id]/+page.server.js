import { error } from '@sveltejs/kit';
import fs from 'node:fs';
import path from 'node:path';
import * as pm2 from '$srv/pm2.js';
import { tail } from '$srv/logs.js';

function secretKeys(cwd) {
  if (!cwd) return [];
  try {
    return fs
      .readFileSync(path.join(cwd, '.env'), 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#') && l.includes('='))
      .map((l) => l.slice(0, l.indexOf('=')).replace(/^export\s+/, '').trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

export async function load({ params }) {
  try {
    const [proc, logs] = await Promise.all([
      pm2.describe(params.id),
      tail(params.id, 300).catch(() => ({ lines: [] })),
    ]);

    const plain = pm2.appEnv(proc.env);
    const envVars = [
      ...Object.entries(plain).map(([key, value]) => ({ key, value, secret: false })),
      ...secretKeys(proc.cwd).map((key) => ({ key, value: '', secret: true, stored: true })),
    ];

    return { proc, initialLogs: logs.lines, envVars };
  } catch (err) {
    error(404, err.message);
  }
}
