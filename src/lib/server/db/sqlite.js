import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export const meta = {
  type: 'sqlite',
  label: 'SQLite',
  defaultPort: null,
  supportsSql: true,
  hasSchemas: false,
};

export function createClient(conn) {
  const file = conn.file || conn.database;
  if (!file) throw new Error('A SQLite database file path is required.');
  const resolved = path.resolve(file);
  const mayCreate = conn.createIfMissing ?? conn.create;
  if (!fs.existsSync(resolved) && !mayCreate) {
    throw new Error(`No SQLite file at ${resolved}. Tick "create if missing" to make one.`);
  }
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const db = new DatabaseSync(resolved, { readOnly: !!conn.readOnly });
  db.__file = resolved;
  return db;
}

export async function close(db) {
  try {
    db.close();
  } catch {
  }
}

function normalise(value) {
  if (typeof value === 'bigint') {
    return value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER)
      ? Number(value)
      : value.toString();
  }
  if (value instanceof Uint8Array) return `<blob ${value.length} bytes>`;
  return value;
}

const normaliseRow = (row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, normalise(v)]));

export async function test(db) {
  const [{ v }] = db.prepare('select sqlite_version() as v').all();
  const size = fs.existsSync(db.__file) ? fs.statSync(db.__file).size : 0;
  return { ok: true, version: `SQLite ${v}`, database: path.basename(db.__file), size };
}

export async function listDatabases(db) {
  const size = fs.existsSync(db.__file) ? fs.statSync(db.__file).size : 0;
  return [{ name: path.basename(db.__file), size, path: db.__file }];
}

export async function listTables(db) {
  const rows = db
    .prepare(
      `select name, type from sqlite_master
       where type in ('table','view') and name not like 'sqlite_%'
       order by name`,
    )
    .all();
  return rows.map((r) => {
    let count = 0;
    try {
      count = Number(normalise(db.prepare(`select count(*) as n from "${r.name.replace(/"/g, '""')}"`).get().n));
    } catch {
    }
    return { name: r.name, kind: r.type, rows: count, size: 0 };
  });
}

export async function columns(db, { table }) {
  const info = db.prepare(`pragma table_info("${String(table).replace(/"/g, '""')}")`).all();
  return info.map((c) => ({
    name: c.name,
    type: c.type || 'ANY',
    nullable: !c.notnull,
    default: c.dflt_value,
    position: Number(c.cid) + 1,
    primaryKey: !!Number(c.pk),
  }));
}

const ident = (s) => `"${String(s).replace(/"/g, '""')}"`;

export async function browse(db, { table, limit = 50, offset = 0, orderBy, orderDir = 'asc' }) {
  const cols = await columns(db, { table });
  const valid = new Set(cols.map((c) => c.name));
  const order = orderBy && valid.has(orderBy) ? ` order by ${ident(orderBy)} ${orderDir === 'desc' ? 'desc' : 'asc'}` : '';
  const rows = db
    .prepare(`select * from ${ident(table)}${order} limit ? offset ?`)
    .all(Math.min(limit, 500), offset)
    .map(normaliseRow);
  const total = Number(normalise(db.prepare(`select count(*) as n from ${ident(table)}`).get().n));
  return { columns: cols, rows, total };
}

export async function query(db, sql, { limit = 500 } = {}) {
  const started = Date.now();
  const stmt = db.prepare(sql);
  let rows = [];
  let rowCount = 0;
  try {
    rows = stmt.all().map(normaliseRow);
    rowCount = rows.length;
  } catch (err) {
    if (!/does not return data|no result/i.test(err.message)) throw err;
    const info = stmt.run();
    rowCount = Number(normalise(info.changes ?? 0));
    rows = [{ changes: rowCount, lastInsertRowid: normalise(info.lastInsertRowid ?? 0) }];
  }
  return {
    columns: rows.length ? Object.keys(rows[0]).map((name) => ({ name })) : [],
    rows: rows.slice(0, limit),
    rowCount,
    truncated: rows.length > limit,
    durationMs: Date.now() - started,
  };
}

export async function stats(db) {
  const pageCount = Number(normalise(db.prepare('pragma page_count').get().page_count));
  const pageSize = Number(normalise(db.prepare('pragma page_size').get().page_size));
  const journal = db.prepare('pragma journal_mode').get().journal_mode;
  return {
    connections: 1,
    totalSize: pageCount * pageSize,
    pageCount,
    pageSize,
    journalMode: journal,
    file: db.__file,
  };
}
