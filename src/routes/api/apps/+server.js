import { json, error } from '@sveltejs/kit';
import * as pm2 from '$srv/pm2.js';
import { safeRepoPath } from '$srv/repos.js';
import { STACK_BY_ID } from '$lib/stacks.js';
import { checkPort } from '$srv/ports.js';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

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
      await SIMPLE_ACTIONS[action](target);
      return json({ ok: true, action, target });
    }

    if (action === 'start') {
      return json({ ok: true, result: await startProcess(body) });
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

async function startProcess(body) {
  const cwd = safeRepoPath(body.cwd || '');

  if (body.ecosystem) {
    const file = path.join(cwd, path.basename(body.ecosystem));
    if (!fs.existsSync(file)) error(400, `Ecosystem file not found: ${file}`);
    return pm2.startFromFile(file);
  }

  const split = splitEnv(body.envVars);
  const env = Array.isArray(body.envVars) ? split.plain : (parseEnv(body.env) ?? {});
  const secrets = split.secret;
  if (Object.keys(secrets).length) writeEnvFile(cwd, secrets);
  if (body.stack && /^[a-z0-9-]{1,32}$/.test(body.stack)) env.SCP_STACK = body.stack;

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
      autorestart: body.autorestart !== false,
      max_memory_restart: body.maxMemory || undefined,
      min_uptime: 5000,
      max_restarts: 10,
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
  if (buildOutput && !fs.existsSync(path.join(cwd, buildOutput))) {
    error(
      400,
      `No build output at ${path.join(cwd, buildOutput)}. Run the build step before starting, or the process will exit immediately and restart until PM2 gives up.`,
    );
  }

  await assertPortFree(env.PORT, { force: body.forcePort });

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
    autorestart: body.autorestart !== false,
    max_memory_restart: body.maxMemory || undefined,
    min_uptime: 5000,
    max_restarts: 10,
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

function splitEnv(input) {
  const plain = {};
  const secret = {};
  if (!Array.isArray(input)) return { plain, secret };
  for (const row of input) {
    const key = String(row?.key ?? '').trim();
    if (!key) continue;
    if (!ENV_KEY_RE.test(key)) error(400, `Invalid environment variable name: ${key}`);
    (row.secret ? secret : plain)[key] = String(row.value ?? '');
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

function writeEnvFile(cwd, vars) {
  const file = path.join(cwd, '.env');
  fs.writeFileSync(file, envFileBody(vars), { mode: 0o600 });
  fs.chmodSync(file, 0o600);

  const ignore = path.join(cwd, '.gitignore');
  const current = fs.existsSync(ignore) ? fs.readFileSync(ignore, 'utf8') : '';
  if (!current.split('\n').some((l) => l.trim() === '.env')) {
    fs.appendFileSync(ignore, `${current && !current.endsWith('\n') ? '\n' : ''}.env\n`);
  }
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
