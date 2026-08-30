import { createClient as createRedis } from 'redis';

export const meta = {
  type: 'redis',
  label: 'Redis / Valkey',
  defaultPort: 6379,
  supportsSql: false,
  hasSchemas: false,
};

export function createClient(conn) {
  const url =
    conn.url ||
    `redis://${conn.user ? encodeURIComponent(conn.user) : ''}${conn.password ? ':' + encodeURIComponent(conn.password) : ''}${conn.user || conn.password ? '@' : ''}${conn.host || '127.0.0.1'}:${Number(conn.port) || meta.defaultPort}`;

  const client = createRedis({
    url,
    socket: { connectTimeout: 8000, reconnectStrategy: (tries) => (tries > 5 ? false : Math.min(tries * 200, 2000)) },
  });
  client.on('error', (err) => console.error('[redis] client error:', err.message));
  client.__ready = client.connect().catch((err) => {
    client.__error = err;
  });
  return client;
}

async function ready(client) {
  await client.__ready;
  if (client.__error) throw client.__error;
  return client;
}

export async function close(client) {
  await client.quit().catch(() => client.destroy?.());
}

function parseInfo(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf(':');
    if (i > 0) out[line.slice(0, i)] = line.slice(i + 1);
  }
  return out;
}

export async function test(client) {
  await ready(client);
  const info = parseInfo(await client.info('server'));
  return { ok: true, version: `Redis ${info.redis_version}`, mode: info.redis_mode, os: info.os };
}

export async function listDatabases(client) {
  await ready(client);
  const keyspace = parseInfo(await client.info('keyspace'));
  let count = 16;
  try {
    const cfg = await client.configGet('databases');
    count = Number(cfg.databases) || 16;
  } catch {
  }
  return Array.from({ length: count }, (_, i) => {
    const stat = keyspace[`db${i}`];
    const keys = stat ? Number(stat.match(/keys=(\d+)/)?.[1] || 0) : 0;
    const expires = stat ? Number(stat.match(/expires=(\d+)/)?.[1] || 0) : 0;
    return { name: String(i), keys, expires, size: 0, empty: keys === 0 };
  });
}

export async function listTables(client, database) {
  await ready(client);
  if (database != null) await client.select(Number(database));
  const groups = new Map();
  let cursor = '0';
  let scanned = 0;
  do {
    const res = await client.scan(cursor, { COUNT: 500 });
    cursor = String(res.cursor);
    for (const key of res.keys) {
      const prefix = key.includes(':') ? key.slice(0, key.indexOf(':')) : '(no prefix)';
      groups.set(prefix, (groups.get(prefix) || 0) + 1);
      scanned += 1;
    }
  } while (cursor !== '0' && scanned < 20_000);

  return [...groups.entries()]
    .map(([name, rows]) => ({ name, kind: 'keyspace', rows, size: 0 }))
    .sort((a, b) => b.rows - a.rows);
}

const TYPE_READERS = {
  string: (c, k) => c.get(k),
  list: (c, k) => c.lRange(k, 0, 199),
  set: (c, k) => c.sMembers(k),
  zset: (c, k) => c.zRangeWithScores(k, 0, 199),
  hash: (c, k) => c.hGetAll(k),
  stream: (c, k) => c.xRange(k, '-', '+', { COUNT: 100 }),
};

export async function browse(client, { table, database, limit = 50, offset = 0 }) {
  await ready(client);
  if (database != null) await client.select(Number(database));
  const pattern = table === '(no prefix)' ? '*' : `${table}:*`;

  const keys = [];
  let cursor = '0';
  do {
    const res = await client.scan(cursor, { MATCH: pattern, COUNT: 500 });
    cursor = String(res.cursor);
    keys.push(...res.keys);
  } while (cursor !== '0' && keys.length < offset + limit + 1000);

  keys.sort();
  const page = keys.slice(offset, offset + Math.min(limit, 500));
  const rows = await Promise.all(
    page.map(async (key) => {
      const type = await client.type(key);
      const ttl = await client.ttl(key);
      let value;
      try {
        value = await (TYPE_READERS[type] || ((c, k) => c.get(k)))(client, key);
      } catch (err) {
        value = `<unreadable: ${err.message}>`;
      }
      return {
        key,
        type,
        ttl: ttl < 0 ? null : ttl,
        value: typeof value === 'string' ? value : JSON.stringify(value),
      };
    }),
  );

  return {
    columns: [{ name: 'key' }, { name: 'type' }, { name: 'ttl' }, { name: 'value' }],
    rows,
    total: keys.length,
  };
}

export async function columns() {
  return [
    { name: 'key', type: 'string', primaryKey: true },
    { name: 'type', type: 'string' },
    { name: 'ttl', type: 'seconds' },
    { name: 'value', type: 'any' },
  ];
}

const WRITE_COMMANDS = new Set(['flushall', 'flushdb', 'shutdown', 'config', 'debug', 'script', 'eval', 'evalsha']);

export async function query(client, command, { database, allowDangerous = false } = {}) {
  await ready(client);
  if (database != null) await client.select(Number(database));
  const started = Date.now();
  const parts = String(command).trim().match(/"[^"]*"|'[^']*'|\S+/g) || [];
  if (!parts.length) throw new Error('Enter a Redis command, for example: KEYS user:*');
  const args = parts.map((p) => p.replace(/^["']|["']$/g, ''));
  const name = args[0].toLowerCase();

  if (WRITE_COMMANDS.has(name) && !allowDangerous) {
    throw new Error(`"${args[0].toUpperCase()}" is blocked. Tick "allow destructive commands" to run it.`);
  }

  const result = await client.sendCommand(args);
  const rows = Array.isArray(result)
    ? result.map((v, i) => ({ '#': i, value: typeof v === 'object' ? JSON.stringify(v) : String(v) }))
    : [{ result: result === null ? '(nil)' : typeof result === 'object' ? JSON.stringify(result) : String(result) }];

  return {
    columns: Object.keys(rows[0] || { result: '' }).map((name2) => ({ name: name2 })),
    rows,
    rowCount: rows.length,
    durationMs: Date.now() - started,
  };
}

export async function stats(client) {
  await ready(client);
  const info = parseInfo(await client.info());
  return {
    connections: Number(info.connected_clients || 0),
    maxConnections: Number(info.maxclients || 0),
    uptimeSec: Number(info.uptime_in_seconds || 0),
    totalSize: Number(info.used_memory || 0),
    memoryPeak: Number(info.used_memory_peak || 0),
    keyspaceHits: Number(info.keyspace_hits || 0),
    keyspaceMisses: Number(info.keyspace_misses || 0),
    opsPerSec: Number(info.instantaneous_ops_per_sec || 0),
    role: info.role,
  };
}
