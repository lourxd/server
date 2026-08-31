import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ENV_KEY_RE, parseEnvText } from '../env-format.js';

export { ENV_KEY_RE };

export const MARKERS = {
  stack: 'SCP_STACK',
  keys: 'SCP_ENV_KEYS',
  db: 'SCP_DB',
  dbVar: 'SCP_DB_VAR',
  pendingBuild: 'SCP_PENDING_BUILD',
  autorestart: 'SCP_AUTORESTART',
};

export function splitEnv(rows, existingSecrets = {}) {
  const plain = {};
  const secret = {};
  if (!Array.isArray(rows)) return { plain, secret };

  for (const row of rows) {
    const key = String(row?.key ?? '').trim();
    if (!key) continue;
    if (!ENV_KEY_RE.test(key)) throw new Error(`Invalid environment variable name: ${key}`);

    const typed = String(row.value ?? '');
    const onDisk = key in existingSecrets;

    if (!row.secret && !onDisk) {
      plain[key] = typed;
      continue;
    }
    secret[key] = typed === '' && onDisk ? existingSecrets[key] : typed;
  }
  return { plain, secret };
}

export function envFileBody(vars) {
  const lines = Object.entries(vars).map(([key, raw]) => {
    const value = String(raw ?? '');
    if (/[\r\n]/.test(value)) {
      throw new Error(`${key} contains a line break, which a .env file cannot represent.`);
    }
    return /[\s"'#$`\\]/.test(value)
      ? `${key}="${value.replace(/(["\\$`])/g, '\\$1')}"`
      : `${key}=${value}`;
  });
  return lines.length ? `${lines.join('\n')}\n` : '';
}

export function parseEnvFile(text) {
  return Object.fromEntries(parseEnvText(text).map((r) => [r.key, r.value]));
}

export function readEnvFile(cwd) {
  try {
    return parseEnvFile(fs.readFileSync(path.join(cwd, '.env'), 'utf8'));
  } catch {
    return {};
  }
}

export function ensureEnvIgnored(cwd) {
  if (!fs.existsSync(path.join(cwd, '.git'))) return false;

  const check = spawnSync('git', ['-C', cwd, 'check-ignore', '-q', '.env'], { timeout: 5000 });
  if (check.status === 0) return false;

  const ignore = path.join(cwd, '.gitignore');
  const current = fs.existsSync(ignore) ? fs.readFileSync(ignore, 'utf8') : '';
  fs.appendFileSync(ignore, `${current && !current.endsWith('\n') ? '\n' : ''}.env\n`);
  console.log(`[apps] added .env to ${ignore} so the secret cannot be committed`);
  return true;
}

export function writeEnvFile(cwd, vars) {
  const file = path.join(cwd, '.env');
  const body = envFileBody(vars);

  if (!body) {
    fs.rmSync(file, { force: true });
    return null;
  }

  fs.writeFileSync(file, body, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
  ensureEnvIgnored(cwd);
  return file;
}

export function declaredKeys(env) {
  return Object.keys(env)
    .filter((k) => !k.startsWith('SCP_'))
    .join(',');
}
