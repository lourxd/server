import { MongoClient } from 'mongodb';

export const meta = {
  type: 'mongodb',
  label: 'MongoDB',
  defaultPort: 27017,
  supportsSql: false,
  hasSchemas: false,
};

export function createClient(conn) {
  const url =
    conn.url ||
    `mongodb://${conn.user ? encodeURIComponent(conn.user) : ''}${conn.password ? ':' + encodeURIComponent(conn.password) : ''}${conn.user ? '@' : ''}${conn.host || '127.0.0.1'}:${Number(conn.port) || meta.defaultPort}/${conn.database || ''}`;

  const client = new MongoClient(url, {
    serverSelectionTimeoutMS: 8000,
    connectTimeoutMS: 8000,
    maxPoolSize: 4,
  });
  client.__ready = client.connect().catch((err) => {
    client.__error = err;
  });
  client.__defaultDb = conn.database || null;
  return client;
}

async function ready(client) {
  await client.__ready;
  if (client.__error) throw client.__error;
  return client;
}

export async function close(client) {
  await client.close().catch(() => {});
}

function serialise(value, depth = 0) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'bigint') return value.toString();
  if (value._bsontype) return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return depth > 6 ? '[...]' : value.map((v) => serialise(v, depth + 1));
  if (typeof value === 'object') {
    if (depth > 6) return '{...}';
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, serialise(v, depth + 1)]));
  }
  return value;
}

export async function test(client) {
  await ready(client);
  const info = await client.db('admin').command({ buildInfo: 1 });
  return { ok: true, version: `MongoDB ${info.version}`, gitVersion: info.gitVersion };
}

export async function listDatabases(client) {
  await ready(client);
  const { databases } = await client.db('admin').command({ listDatabases: 1 });
  return databases.map((d) => ({
    name: d.name,
    size: d.sizeOnDisk,
    empty: d.empty,
    system: ['admin', 'local', 'config'].includes(d.name),
  }));
}

export async function listTables(client, database) {
  await ready(client);
  const db = client.db(database || client.__defaultDb || 'admin');
  const collections = await db.listCollections().toArray();
  return Promise.all(
    collections.map(async (c) => {
      let rows = 0;
      let size = 0;
      try {
        const s = await db.command({ collStats: c.name });
        rows = s.count || 0;
        size = s.storageSize || 0;
      } catch {
        rows = await db.collection(c.name).estimatedDocumentCount().catch(() => 0);
      }
      return { name: c.name, kind: c.type === 'view' ? 'view' : 'collection', rows, size };
    }),
  );
}

export async function columns(client, { table, database }) {
  await ready(client);
  const db = client.db(database || client.__defaultDb);
  const sample = await db.collection(table).find({}).limit(50).toArray();
  const fields = new Map();
  for (const doc of sample) {
    for (const [k, v] of Object.entries(doc)) {
      const type = v === null ? 'null' : v?._bsontype || (Array.isArray(v) ? 'array' : typeof v);
      if (!fields.has(k)) fields.set(k, { name: k, types: new Set(), count: 0 });
      const f = fields.get(k);
      f.types.add(type);
      f.count += 1;
    }
  }
  return [...fields.values()].map((f, i) => ({
    name: f.name,
    type: [...f.types].join(' | '),
    nullable: f.count < sample.length,
    position: i + 1,
    primaryKey: f.name === '_id',
  }));
}

export async function browse(client, { table, database, limit = 50, offset = 0, orderBy, orderDir = 'asc' }) {
  await ready(client);
  const db = client.db(database || client.__defaultDb);
  const coll = db.collection(table);
  const sort = orderBy ? { [orderBy]: orderDir === 'desc' ? -1 : 1 } : { _id: 1 };
  const [docs, total, cols] = await Promise.all([
    coll.find({}).sort(sort).skip(offset).limit(Math.min(limit, 500)).toArray(),
    coll.estimatedDocumentCount(),
    columns(client, { table, database }),
  ]);
  return { columns: cols, rows: docs.map((d) => serialise(d)), total };
}

export async function query(client, expression, { database, collection, limit = 500 } = {}) {
  await ready(client);
  const db = client.db(database || client.__defaultDb);
  const started = Date.now();
  const text = String(expression).trim();

  const call = text.match(/^db\.([A-Za-z0-9_.-]+)\.(find|aggregate|countDocuments|distinct)\s*\(([\s\S]*)\)\s*;?$/);
  let coll = collection;
  let op = 'find';
  let argText = text;

  if (call) {
    coll = call[1];
    op = call[2];
    argText = call[3].trim() || '{}';
  }
  if (!coll) throw new Error('Choose a collection, or write db.<collection>.find({ ... }).');

  let arg;
  try {
    arg = argText ? JSON.parse(argText.replace(/^\(|\)$/g, '')) : {};
  } catch {
    throw new Error('The argument must be valid JSON, e.g. {"status":"active"}.');
  }

  let rows;
  if (op === 'aggregate') {
    rows = await db.collection(coll).aggregate(Array.isArray(arg) ? arg : [arg]).limit(limit).toArray();
  } else if (op === 'countDocuments') {
    rows = [{ count: await db.collection(coll).countDocuments(arg) }];
  } else if (op === 'distinct') {
    const values = await db.collection(coll).distinct(String(arg));
    rows = values.map((v, i) => ({ '#': i, value: serialise(v) }));
  } else {
    rows = await db.collection(coll).find(arg).limit(limit).toArray();
  }

  const out = rows.map((r) => serialise(r));
  const keys = new Set();
  for (const r of out.slice(0, 50)) Object.keys(r || {}).forEach((k) => keys.add(k));
  return {
    columns: [...keys].map((name) => ({ name })),
    rows: out,
    rowCount: out.length,
    truncated: out.length >= limit,
    durationMs: Date.now() - started,
  };
}

export async function stats(client) {
  await ready(client);
  const admin = client.db('admin');
  const status = await admin.command({ serverStatus: 1 });
  return {
    connections: status.connections?.current || 0,
    maxConnections: status.connections?.available || 0,
    uptimeSec: status.uptime || 0,
    totalSize: status.mem?.resident ? status.mem.resident * 1024 * 1024 : 0,
    opsPerSec: Object.values(status.opcounters || {}).reduce((a, b) => a + b, 0),
    version: status.version,
  };
}
