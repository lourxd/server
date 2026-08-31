import { json, error } from '@sveltejs/kit';
import * as pm2 from '$srv/pm2.js';
import { safeRepoPath } from '$srv/repos.js';
import { STACK_BY_ID } from '$lib/stacks.js';
import { checkPort } from '$srv/ports.js';
import { getConnection } from '$srv/store/connections.js';
import { connectionUrl, defaultVarFor } from '$srv/db/provision.js';
import {
  MARKERS,
  declaredKeys,
  readEnvFile,
  splitEnv,
  writeEnvFile,
} from '$srv/appenv.js';

const { db: DB_MARKER, dbVar: DB_VAR_MARKER, pendingBuild: PENDING_BUILD, autorestart: WANTED_AUTORESTART } = MARKERS;


async function attachDatabase(body) {
  const target = body.id ?? body.name;
  if (target === undefined || target === null || target === '') error(400, 'A process id or name is required.');

  const proc = await pm2.describe(target);
  const plain = pm2.appEnv(proc.env);
  const secrets = readEnvFile(proc.cwd);

  let marker;
  let varName = String(body.varName ?? '').trim();

  if (body.detach) {
    varName = varName || proc.env?.[DB_VAR_MARKER] || '';
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
    envVars.push({ key: DB_VAR_MARKER, value: varName, secret: false });
  }

  return updateEnv({ id: proc.pmId, envVars });
}
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
  const apps = await pm2.list().catch(() => []);
  const result = await checkPort(port, { apps });
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
  env[pm2.ENV_KEYS_VAR] = declaredKeys(env);

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

  const stackDefaults = STACK_BY_ID[body.stack]?.defaults;
  const buildOutput = stackDefaults?.buildOutput;
  const buildProof = stackDefaults?.buildMarker ?? buildOutput;
  const missingBuild = !!buildProof && !fs.existsSync(path.join(cwd, buildProof));

  if (missingBuild && !body.registerOnly) {
    const dirExists = buildOutput && fs.existsSync(path.join(cwd, buildOutput));
    error(
      400,
      dirExists
        ? `${buildOutput} exists but holds no finished build — ${buildProof} is missing, which usually means the build failed part way. Delete ${buildOutput} and build again.`
        : `No build output at ${path.join(cwd, buildOutput ?? buildProof)}. Run the build step before starting, or the process will exit immediately and restart until PM2 gives up.`,
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
