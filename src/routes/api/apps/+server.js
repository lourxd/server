import { json, error } from '@sveltejs/kit';
import * as pm2 from '$srv/pm2.js';
import { safeRepoPath } from '$srv/repos.js';
import { STACK_BY_ID } from '$lib/stacks.js';
import { checkPort } from '$srv/ports.js';
import { getConnection } from '$srv/store/connections.js';
import { connectionUrl, defaultVarFor } from '$srv/db/provision.js';

const DB_MARKER = 'SCP_DB';
const PENDING_BUILD = 'SCP_PENDING_BUILD';
const WANTED_AUTORESTART = 'SCP_AUTORESTART';

function readEnvFile(cwd) {
  const out = {};
  try {
    for (const raw of fs.readFileSync(path.join(cwd, '.env'), 'utf8').split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq < 1) continue;
      const key = line.slice(0, eq).replace(/^export\s+/, '').trim();
      let value = line.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (key) out[key] = value;
    }
  } catch {
  }
  return out;
}

async function attachDatabase(body) {
  const target = body.id ?? body.name;
  if (target === undefined || target === null || target === '') error(400, 'A process id or name is required.');

  const proc = await pm2.describe(target);
  const plain = pm2.appEnv(proc.env);
  const secrets = readEnvFile(proc.cwd);

  let marker;
  let varName = String(body.varName ?? '').trim();

  if (body.detach) {
    varName = varName || proc.env?.[`${DB_MARKER}_VAR`] || '';
    if (varName) delete secrets[varName];
    marker = null;
  } else {
    const conn = await getConnection(body.connectionId);
    varName = varName || defaultVarFor(conn.type);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(varName)) error(400, `Invalid variable name: ${varName}`);
    secrets[varName] = connectionUrl(conn);
    marker = conn.id;
  }

  const envVars = [
    ...Object.entries(plain).map(([key, value]) => ({ key, value, secret: false })),
    ...Object.entries(secrets).map(([key, value]) => ({ key, value, secret: true })),
  ];
  if (marker) {
    envVars.push({ key: DB_MARKER, value: marker, secret: false });
    envVars.push({ key: `${DB_MARKER}_VAR`, value: varName, secret: false });
  }

  return updateEnv({ id: proc.pmId, envVars });
}
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const pm2Serve = () =>
  path.join(path.dirname(createRequire(import.meta.url).resolve('pm2/package.json')), 'lib/API/Serve.js');

export async function GET({ url }) {
  const id = url.searchParams.get('id');
  try {
    return json(id ? await pm2.describe(id) : await pm2.list());
  } catch (err) {
    error(500, err.message);
  }
}

const SIMPLE_ACTIONS = {
  restart: pm2.restart,
  reload: pm2.reload,
  stop: pm2.stop,
  delete: pm2.del,
  flush: pm2.flush,
  reset: pm2.reset,
};

export async function POST({ request }) {
  const body = await request.json().catch(() => ({}));
  const { action } = body;

  try {
    if (action in SIMPLE_ACTIONS) {
      const target = body.id ?? body.name;
      if (target === undefined || target === null || target === '') error(400, 'A process id or name is required.');

      if (action === 'restart') {
        const healed = await healPendingBuild(target);
        if (healed) return json({ ok: true, action, target, healed: true, ...healed });
      }

      await SIMPLE_ACTIONS[action](target);
      return json({ ok: true, action, target });
    }

    if (action === 'start') {
      return json({ ok: true, result: await startProcess(body) });
    }

    if (action === 'attach-db' || action === 'detach-db') {
      return json(await attachDatabase({ ...body, detach: action === 'detach-db' }));
    }

    if (action === 'update-env') {
      return json(await updateEnv(body));
    }

    if (action === 'save') {
      await pm2.dump();
      return json({ ok: true, action: 'save' });
    }

    if (action === 'restartAll' || action === 'stopAll') {
      const list = await pm2.list();
      const fn = action === 'restartAll' ? pm2.restart : pm2.stop;
      const results = [];
      for (const p of list) {
        try { await fn(p.pmId); results.push({ name: p.name, ok: true }); }
        catch (err) { results.push({ name: p.name, ok: false, error: err.message }); }
      }
      return json({ ok: true, results });
    }

    error(400, `Unknown action: ${action}`);
  } catch (err) {
    if (err?.status) throw err;
    error(500, err.message || 'PM2 command failed');
  }
}

async function assertPortFree(port, { force = false } = {}) {
  if (force || port == null || port === '') return;
  const result = await checkPort(port);
  if (result.free || !result.valid) return;
  error(409, `${result.reason} Choose another port, or stop what is holding it.`);
}

async function healPendingBuild(target) {
  const proc = await pm2.describe(target).catch(() => null);
  if (!proc || proc.env?.[PENDING_BUILD] !== '1') return null;

  const plain = pm2.appEnv(proc.env);
  const secrets = readEnvFile(proc.cwd);
  const envVars = [
    ...Object.entries(plain).map(([key, value]) => ({ key, value, secret: false })),
    ...Object.entries(secrets).map(([key, value]) => ({ key, value, secret: true })),
  ];

  return updateEnv({
    id: proc.pmId,
    envVars,
    overrides: { autorestart: proc.env[WANTED_AUTORESTART] !== '0' },
  });
}

async function updateEnv(body) {
  const target = body.id ?? body.name;
  if (target === undefined || target === null || target === '') error(400, 'A process id or name is required.');

  const proc = await pm2.describe(target);

  const rebuilt = {
    cwd: proc.cwd,
    name: proc.name,
    script: proc.script,
    args: Array.isArray(proc.args) ? proc.args.join(' ') : proc.args,
    execMode: proc.execMode === 'cluster_mode' ? 'cluster' : 'fork',
    instances: proc.instances,
    watch: proc.watching,
    autorestart: proc.autorestart,
    maxMemory: proc.maxMemoryRestart || '',
    interpreter: proc.interpreter && proc.interpreter !== 'node' ? proc.interpreter : '',
    stack: proc.stack || undefined,
    envVars: body.envVars,
    forcePort: true,
    ...(body.overrides ?? {}),
  };

  await pm2.del(proc.pmId);
  try {
    const result = await startProcess(rebuilt);
    return { ok: true, restarted: true, result };
  } catch (err) {
    try {
      await startProcess({ ...rebuilt, envVars: undefined, env: proc.env });
    } catch {
    }
    error(500, `Could not restart ${proc.name} with the new environment: ${err?.body?.message ?? err.message}`);
  }
}

async function startProcess(body) {
  const cwd = safeRepoPath(body.cwd || '');

  if (body.ecosystem) {
    const file = path.join(cwd, path.basename(body.ecosystem));
    if (!fs.existsSync(file)) error(400, `Ecosystem file not found: ${file}`);
    return pm2.startFromFile(file);
  }

  const split = splitEnv(body.envVars, readEnvFile(cwd));
  const env = Array.isArray(body.envVars) ? split.plain : (parseEnv(body.env) ?? {});
  const secrets = split.secret;
  if (Array.isArray(body.envVars) && (Object.keys(secrets).length || fs.existsSync(path.join(cwd, '.env')))) {
    writeEnvFile(cwd, secrets);
  }
  if (body.stack && /^[a-z0-9-]{1,32}$/.test(body.stack)) env.SCP_STACK = body.stack;
  if (body.registerOnly) {
    env[PENDING_BUILD] = '1';
    env[WANTED_AUTORESTART] = body.autorestart === false ? '0' : '1';
  }
  env[pm2.ENV_KEYS_VAR] = Object.keys(env)
    .filter((k) => !/^SCP_/.test(k))
    .join(',');

  const name = String(body.name || path.basename(cwd)).trim();
  if (!/^[A-Za-z0-9._@/-]+$/.test(name)) error(400, 'Invalid app name.');

  if (body.serve) {
    await assertPortFree(body.serve.port, { force: body.forcePort });
    const dir = path.resolve(cwd, String(body.serve.dir || 'dist'));
    if (!dir.startsWith(path.resolve(cwd))) error(400, 'Serve directory escapes the project directory.');
    if (!fs.existsSync(dir)) error(400, `Build output not found at ${dir}. Run the build first.`);

    return pm2.start({
      script: pm2Serve(),
      name,
      cwd,
      exec_mode: 'fork',
      autorestart: body.registerOnly ? false : body.autorestart !== false,
      max_memory_restart: body.maxMemory || undefined,
      min_uptime: 5000,
      max_restarts: body.registerOnly ? 0 : 10,
      restart_delay: 1000,
      time: true,
      env: {
        ...env,
        PM2_SERVE_PATH: dir,
        PM2_SERVE_PORT: String(body.serve.port ?? 5000),
        PM2_SERVE_SPA: body.serve.spa ? 'true' : 'false',
        PM2_SERVE_HOST: body.serve.host ?? '0.0.0.0',
      },
    });
  }

  const buildOutput = STACK_BY_ID[body.stack]?.defaults?.buildOutput;
  const missingBuild = !!buildOutput && !fs.existsSync(path.join(cwd, buildOutput));
  if (missingBuild && !body.registerOnly) {
    error(
      400,
      `No build output at ${path.join(cwd, buildOutput)}. Run the build step before starting, or the process will exit immediately and restart until PM2 gives up.`,
    );
  }

  await assertPortFree(env.PORT, { force: body.forcePort || body.registerOnly });

  const script = String(body.script || '').trim();
  if (!script) error(400, 'A script or ecosystem file is required.');

  const scriptPath = path.resolve(cwd, script);
  if (!scriptPath.startsWith(path.resolve(cwd))) error(400, 'Script path escapes the project directory.');
  if (!fs.existsSync(scriptPath)) error(400, `Script not found: ${scriptPath}`);

  const interpreter = body.interpreter || undefined;
  const nodeEntry = !interpreter || interpreter === 'node';
  const hasEnvFile = fs.existsSync(path.join(cwd, '.env'));
  const execMode = body.execMode === 'cluster' && nodeEntry ? 'cluster' : 'fork';
  if (body.execMode === 'cluster' && !nodeEntry) {
    console.warn(`[apps] cluster requested for a ${interpreter} entry point; falling back to fork`);
  }

  const options = {
    script: scriptPath,
    name,
    cwd,
    args: parseArgs(body.args),
    instances: execMode === 'cluster' && body.instances ? Number(body.instances) : 1,
    exec_mode: execMode,
    watch: !!body.watch,
    autorestart: body.registerOnly ? false : body.autorestart !== false,
    max_memory_restart: body.maxMemory || undefined,
    min_uptime: 5000,
    max_restarts: body.registerOnly ? 0 : 10,
    restart_delay: 1000,
    interpreter,
    interpreter_args: nodeEntry && hasEnvFile ? ['--env-file-if-exists=.env'] : undefined,
    env: Object.keys(env).length ? env : undefined,
    time: true,
  };
  return pm2.start(options);
}

function parseArgs(input) {
  if (!input) return [];
  if (Array.isArray(input)) return input.map(String);
  return String(input).match(/"[^"]*"|'[^']*'|\S+/g)?.map((s) => s.replace(/^["']|["']$/g, '')) ?? [];
}

const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function splitEnv(input, existingSecrets = {}) {
  const plain = {};
  const secret = {};
  if (!Array.isArray(input)) return { plain, secret };
  for (const row of input) {
    const key = String(row?.key ?? '').trim();
    if (!key) continue;
    if (!ENV_KEY_RE.test(key)) error(400, `Invalid environment variable name: ${key}`);
    if (!row.secret) {
      plain[key] = String(row.value ?? '');
      continue;
    }
    const typed = String(row.value ?? '');
    secret[key] = typed === '' && key in existingSecrets ? existingSecrets[key] : typed;
  }
  return { plain, secret };
}

function envFileBody(vars) {
  return (
    Object.entries(vars)
      .map(([k, v]) => (/[\s"'#$`\\]/.test(v) ? `${k}="${v.replace(/(["\\$`])/g, '\\$1')}"` : `${k}=${v}`))
      .join('\n') + '\n'
  );
}

function ensureEnvIgnored(cwd) {
  if (!fs.existsSync(path.join(cwd, '.git'))) return;

  const check = spawnSync('git', ['-C', cwd, 'check-ignore', '-q', '.env'], { timeout: 5000 });
  if (check.status === 0) return;

  const ignore = path.join(cwd, '.gitignore');
  const current = fs.existsSync(ignore) ? fs.readFileSync(ignore, 'utf8') : '';
  fs.appendFileSync(ignore, `${current && !current.endsWith('\n') ? '\n' : ''}.env\n`);
  console.log(`[apps] added .env to ${ignore} so the secret cannot be committed`);
}

function writeEnvFile(cwd, vars) {
  const file = path.join(cwd, '.env');
  fs.writeFileSync(file, envFileBody(vars), { mode: 0o600 });
  fs.chmodSync(file, 0o600);

  ensureEnvIgnored(cwd);
  return file;
}

function parseEnv(input) {
  if (!input) return undefined;
  if (typeof input === 'object') return input;
  const out = {};
  for (const line of String(input).split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const i = trimmed.indexOf('=');
    if (i < 1) continue;
    out[trimmed.slice(0, i).trim()] = trimmed.slice(i + 1).trim();
  }
  return Object.keys(out).length ? out : undefined;
}
