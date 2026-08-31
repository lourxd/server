import pm2 from 'pm2';
import { EventEmitter } from 'node:events';

let connected = false;
let connecting = null;
let busAttached = false;

export const bus = new EventEmitter();
bus.setMaxListeners(0);

const CALL_TIMEOUT_MS = 10_000;

function resetConnection() {
  connected = false;
  connecting = null;
  busAttached = false;
  try {
    pm2.disconnect();
  } catch {
  }
}

export function connect() {
  if (connected) return Promise.resolve();
  if (connecting) return connecting;

  connecting = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      resetConnection();
      reject(new Error('Timed out connecting to the PM2 daemon.'));
    }, CALL_TIMEOUT_MS);

    pm2.connect((err) => {
      clearTimeout(timer);
      connecting = null;
      if (err) {
        resetConnection();
        return reject(err);
      }
      connected = true;
      attachBus();
      resolve();
    });
  });
  return connecting;
}

export function attachBus() {
  if (busAttached) return;
  busAttached = true;
  pm2.launchBus((err, b) => {
    if (err) {
      busAttached = false;
      console.error('[pm2] launchBus failed:', err.message);
      return;
    }
    b.on('log:out', (p) => bus.emit('log', shapeLog(p, 'out')));
    b.on('log:err', (p) => bus.emit('log', shapeLog(p, 'err')));
    b.on('process:event', (p) =>
      bus.emit('event', {
        name: p.process?.name,
        pmId: p.process?.pm_id,
        event: p.event,
        status: p.process?.status,
        at: Date.now(),
      }),
    );
  });
}

function invoke(method, args) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      resetConnection();
      reject(new Error(`PM2 did not respond to "${method}" within ${CALL_TIMEOUT_MS / 1000}s.`));
    }, CALL_TIMEOUT_MS);

    try {
      pm2[method](...args, (err, result) => {
        if (settled) return;
        clearTimeout(timer);
        if (err) return reject(err);
        resolve(result);
      });
    } catch (err) {
      clearTimeout(timer);
      reject(err);
    }
  });
}

export function disconnect() {
  resetConnection();
}

export async function call(method, ...args) {
  await connect();
  try {
    return await invoke(method, args);
  } catch (err) {
    resetConnection();
    await connect();
    return invoke(method, args);
  }
}

function shapeLog(packet, stream) {
  return {
    name: packet.process?.name,
    pmId: packet.process?.pm_id,
    stream,
    line: String(packet.data ?? '').replace(/\n$/, ''),
    at: packet.at ? packet.at * 1 : Date.now(),
  };
}

export function shapeProcess(p) {
  const env = p.pm2_env || {};
  return {
    pmId: p.pm_id,
    name: p.name,
    namespace: env.namespace || 'default',
    pid: p.pid || null,
    status: env.status,
    uptime: env.pm_uptime ? Date.now() - env.pm_uptime : 0,
    startedAt: env.pm_uptime || null,
    restarts: env.restart_time ?? 0,
    unstableRestarts: env.unstable_restarts ?? 0,
    cpu: p.monit?.cpu ?? 0,
    memory: p.monit?.memory ?? 0,
    execMode: env.exec_mode,
    instances: env.instances ?? 1,
    nodeVersion: env.node_version || null,
    version: env.version || null,
    script: env.pm_exec_path || null,
    cwd: env.pm_cwd || null,
    args: env.args || [],
    interpreter: env.exec_interpreter || null,
    watching: !!env.watch,
    autorestart: env.autorestart !== false,
    maxMemoryRestart: env.max_memory_restart || null,
    outLog: env.pm_out_log_path || null,
    errLog: env.pm_err_log_path || null,
    createdAt: env.created_at || null,
    user: env.username || null,
    stack: env.env?.SCP_STACK ?? env.SCP_STACK ?? null,
    gitRepo: env.versioning?.repo_path || null,
    gitBranch: env.versioning?.branch || null,
  };
}

export async function list() {
  const procs = await call('list');
  return procs.map(shapeProcess);
}

const SYSTEM_ENV = new Set([
  'PWD', 'OLDPWD', 'HOME', 'SHELL', 'USER', 'LOGNAME', 'PATH', 'LANG', 'LC_ALL', 'TERM', 'SHLVL',
  '_', 'TMPDIR', 'XDG_DATA_DIRS', 'XDG_RUNTIME_DIR', 'XDG_SESSION_TYPE', 'XDG_SESSION_CLASS',
  'XDG_SESSION_ID', 'SYSTEMD_EXEC_PID', 'INVOCATION_ID', 'JOURNAL_STREAM', 'MEMORY_PRESSURE_WATCH',
  'MEMORY_PRESSURE_WRITE', 'MANAGERPID', 'DBUS_SESSION_BUS_ADDRESS', 'MOTD_SHOWN', 'SSH_CONNECTION',
  'SSH_CLIENT', 'SSH_TTY', 'HOSTNAME', 'NVM_DIR', 'NVM_BIN', 'NVM_INC', 'NVM_CD_FLAGS',
]);

const PANEL_ENV = /^(PM2|PM_|SCP_|PM2D_|npm_|NODE_OPTIONS$|unique_id$|axm_)/i;
const AGENT_ENV = /^(SSH_|GPG_|GNOME_|DBUS_|SYSTEMD_|MANAGERPID|JOURNAL_|MEMORY_PRESSURE|XDG_|LC_|LESS|COLORTERM$|DESKTOP_|SESSION_)/i;

export const ENV_KEYS_VAR = 'SCP_ENV_KEYS';

export function appEnv(env) {
  const all = env || {};

  const declared = all[ENV_KEYS_VAR];
  if (typeof declared === 'string') {
    return Object.fromEntries(
      declared
        .split(',')
        .map((k) => k.trim())
        .filter((k) => k && k in all && !PANEL_ENV.test(k))
        .map((k) => [k, all[k]]),
    );
  }

  return Object.fromEntries(
    Object.entries(all).filter(
      ([k, v]) =>
        typeof v === 'string' &&
        k === k.toUpperCase() &&
        !SYSTEM_ENV.has(k) &&
        !PANEL_ENV.test(k) &&
        !AGENT_ENV.test(k),
    ),
  );
}

export async function describe(id) {
  const [p] = await call('describe', id);
  if (!p) throw new Error(`process "${id}" not found`);
  const shaped = shapeProcess(p);
  shaped.env = Object.fromEntries(
    Object.entries(p.pm2_env || {})
      .filter(([k, v]) => k === k.toUpperCase() && typeof v === 'string')
  );
  return shaped;
}

export const restart = (id) => call('restart', id);
export const reload  = (id) => call('reload', id);
export const stop    = (id) => call('stop', id);
export const del     = (id) => call('delete', id);
export const flush   = (id) => call('flush', id);
export const reset   = (id) => call('reset', id);

const PM2_RESERVED = /^(pm_|pm2_pid|PM2_|name$|instances$|exec_mode$|unique_id$|status$|version$|axm_)/;

const PM2_ALLOWED = /^PM2_SERVE_/;

export function sanitizeEnv(env) {
  if (!env || typeof env !== 'object') return undefined;
  const out = {};
  for (const [k, v] of Object.entries(env)) {
    if (PM2_RESERVED.test(k) && !PM2_ALLOWED.test(k)) continue;
    out[k] = String(v);
  }
  return Object.keys(out).length ? out : undefined;
}

export async function start(options) {
  return call('start', { ...options, env: sanitizeEnv(options.env) });
}

export async function startFromFile(filePath) {
  return call('start', filePath);
}

export async function dump() {
  return new Promise((resolve, reject) => {
    connect().then(() => {
      pm2.dump((err, ret) => (err ? reject(err) : resolve(ret)));
    }, reject);
  });
}
