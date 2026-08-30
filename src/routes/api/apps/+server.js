import { json, error } from '@sveltejs/kit';
import * as pm2 from '$srv/pm2.js';
import { safeRepoPath } from '$srv/repos.js';
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

async function startProcess(body) {
  const cwd = safeRepoPath(body.cwd || '');

  if (body.ecosystem) {
    const file = path.join(cwd, path.basename(body.ecosystem));
    if (!fs.existsSync(file)) error(400, `Ecosystem file not found: ${file}`);
    return pm2.startFromFile(file);
  }

  const env = parseEnv(body.env) ?? {};
  if (body.stack && /^[a-z0-9-]{1,32}$/.test(body.stack)) env.SCP_STACK = body.stack;

  const name = String(body.name || path.basename(cwd)).trim();
  if (!/^[A-Za-z0-9._@/-]+$/.test(name)) error(400, 'Invalid app name.');

  if (body.serve) {
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

  const script = String(body.script || '').trim();
  if (!script) error(400, 'A script or ecosystem file is required.');

  const scriptPath = path.resolve(cwd, script);
  if (!scriptPath.startsWith(path.resolve(cwd))) error(400, 'Script path escapes the project directory.');
  if (!fs.existsSync(scriptPath)) error(400, `Script not found: ${scriptPath}`);

  const interpreter = body.interpreter || undefined;
  const nodeEntry = !interpreter || interpreter === 'node';
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
    interpreter,
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
