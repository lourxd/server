import * as postgres from './postgres.js';
import * as mysql from './mysql.js';
import * as sqlite from './sqlite.js';
import * as redis from './redis.js';
import * as mongo from './mongo.js';
import * as store from '../store/connections.js';
import { run, which as whichBinary } from '../exec.js';
import { cached, invalidate } from '../cache.js';

export const DRIVERS = {
  postgres,
  mysql,
  sqlite,
  redis,
  mongodb: mongo,
};

export const DRIVER_META = Object.fromEntries(Object.entries(DRIVERS).map(([k, d]) => [k, d.meta]));

function driverFor(type) {
  const d = DRIVERS[type];
  if (!d) throw new Error(`Unsupported database type: ${type}`);
  return d;
}

const VALID_TYPES = new Set(Object.keys(DRIVERS));

export const listConnections = () => store.listConnections();
export const getConnection = (id) => store.getConnection(id);

export async function saveConnection(input) {
  const type = String(input.type || '').trim();
  driverFor(type);
  const saved = await store.saveConnection(
    { ...input, port: input.port || DRIVER_META[type].defaultPort },
    { validTypes: VALID_TYPES },
  );
  closeClient(saved.id);
  return saved;
}

export async function deleteConnection(id) {
  const res = await store.deleteConnection(id);
  closeClient(id);
  return res;
}

const clients = new Map();
const IDLE_MS = 5 * 60_000;

function keyFor(id, database) {
  return `${id}::${database ?? ''}`;
}

async function getClient(id, database) {
  const conn = await getConnection(id);
  const driver = driverFor(conn.type);
  const key = keyFor(id, conn.type === 'postgres' ? database || conn.database : '');
  const hit = clients.get(key);
  if (hit) {
    hit.lastUsed = Date.now();
    return { client: hit.client, driver, conn };
  }
  const client = driver.createClient(conn, database);
  clients.set(key, { client, driver, lastUsed: Date.now(), id });
  return { client, driver, conn };
}

export function closeClient(id) {
  for (const [key, entry] of clients) {
    if (entry.id === id || key.startsWith(`${id}::`)) {
      entry.driver.close(entry.client).catch(() => {});
      clients.delete(key);
    }
  }
}

const evictor = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of clients) {
    if (now - entry.lastUsed > IDLE_MS) {
      entry.driver.close(entry.client).catch(() => {});
      clients.delete(key);
    }
  }
}, 60_000);
evictor.unref?.();

export async function shutdownAll() {
  await Promise.all([...clients.values()].map((e) => e.driver.close(e.client).catch(() => {})));
  clients.clear();
}

async function withClient(id, database, fn) {
  const { client, driver, conn } = await getClient(id, database);
  try {
    return await fn(driver, client, conn);
  } catch (err) {
    if (/ECONNREFUSED|ETIMEDOUT|ENOTFOUND|ECONNRESET|closed|terminat/i.test(err.message || '')) {
      closeClient(id);
    }
    throw err;
  }
}

export const testConnection = (id, database) => withClient(id, database, (d, c) => d.test(c));
export const databases = (id) => withClient(id, null, (d, c) => d.listDatabases(c));
export const tables = (id, database) => withClient(id, database, (d, c) => d.listTables(c, database));
export const tableColumns = (id, database, table) =>
  withClient(id, database, (d, c) => d.columns(c, { table, database, schema: undefined }));

export const browseTable = (id, database, opts) =>
  withClient(id, database, (d, c) => d.browse(c, { database, ...opts }));

export const dbStats = (id, database) => withClient(id, database, (d, c) => d.stats(c));

export const runQuery = (id, database, sql, opts = {}) =>
  withClient(id, database, (d, c) => d.query(c, sql, { database, ...opts }));

export async function probe(input) {
  const driver = driverFor(input.type);
  const client = driver.createClient({ ...input, port: input.port || driver.meta.defaultPort });
  try {
    return await driver.test(client);
  } finally {
    await driver.close(client).catch(() => {});
  }
}

const ENGINE_PROBES = [
  { type: 'postgres', bin: 'psql', service: 'postgresql', port: 5432 },
  { type: 'mysql', bin: 'mysql', service: 'mysql', port: 3306 },
  { type: 'mysql', bin: 'mariadb', service: 'mariadb', port: 3306 },
  { type: 'redis', bin: 'redis-cli', service: 'redis-server', port: 6379 },
  { type: 'mongodb', bin: 'mongosh', service: 'mongod', port: 27017 },
  { type: 'sqlite', bin: 'sqlite3', service: null, port: null },
];

export function detectLocalEngines() {
  return cached('db:engines', 15_000, detectLocalEnginesUncached);
}

async function detectLocalEnginesUncached() {
  const listening = await run('ss', ['-tlnH'], { timeout: 5000 });
  const openPorts = new Set(
    (listening.stdout || '')
      .split('\n')
      .map((l) => l.trim().split(/\s+/)[3])
      .filter(Boolean)
      .map((addr) => Number(addr.split(':').pop()))
      .filter((n) => !Number.isNaN(n)),
  );

  const results = await Promise.all(
    ENGINE_PROBES.map(async (probe2) => {
      const binaryPath = whichBinary(probe2.bin);
      const installed = !!binaryPath;
      let serviceState = null;
      if (probe2.service) {
        const st = await run('systemctl', ['is-active', probe2.service], { timeout: 5000 });
        serviceState = st.stdout.trim() || 'unknown';
      }
      return {
        type: probe2.type,
        label: DRIVER_META[probe2.type].label,
        binary: probe2.bin,
        installed,
        binaryPath,
        service: probe2.service,
        serviceState,
        port: probe2.port,
        listening: probe2.port ? openPorts.has(probe2.port) : null,
      };
    }),
  );

  const sqliteRow = results.find((r) => r.type === 'sqlite');
  if (sqliteRow) {
    sqliteRow.installed = true;
    sqliteRow.binaryPath = sqliteRow.binaryPath || 'node:sqlite (built in)';
  }
  return results;
}

const SERVICE_ACTIONS = new Set(['start', 'stop', 'restart']);

export async function controlService(service, action) {
  if (!SERVICE_ACTIONS.has(action)) throw new Error(`Unsupported service action: ${action}`);
  const known = ENGINE_PROBES.map((p) => p.service).filter(Boolean);
  if (!known.includes(service)) throw new Error(`Refusing to control unknown service: ${service}`);
  const res = await run('sudo', ['-n', 'systemctl', action, service], { timeout: 30_000 });
  invalidate('db:engines');
  if (!res.ok) {
    throw new Error(
      res.stderr.includes('password')
        ? `Passwordless sudo is not configured for systemctl. Run: sudo systemctl ${action} ${service}`
        : res.stderr || `systemctl ${action} ${service} failed`,
    );
  }
  return { ok: true, output: res.stdout };
}
