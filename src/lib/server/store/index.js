import { DatabaseSync } from 'node:sqlite';
import { drizzle } from 'drizzle-orm/sqlite-proxy';
import { migrate } from 'drizzle-orm/sqlite-proxy/migrator';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from './schema.js';

const ROOT = process.cwd();
export const DATA_DIR = process.env.PM2D_DATA_DIR || path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'panel.db');

function migrationsDir() {
  const candidates = [
    process.env.PM2D_MIGRATIONS_DIR,
    path.join(ROOT, 'src/lib/server/store/migrations'),
    path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations'),
  ].filter(Boolean);
  return candidates.find((dir) => fs.existsSync(path.join(dir, 'meta', '_journal.json'))) ?? candidates[1];
}

fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });

export const sqlite = new DatabaseSync(DB_FILE);
sqlite.exec('pragma journal_mode = WAL');
sqlite.exec('pragma foreign_keys = ON');
sqlite.exec('pragma busy_timeout = 5000');

try {
  fs.chmodSync(DB_FILE, 0o600);
} catch {
}

function normalise(value) {
  if (typeof value === 'bigint') {
    return value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER)
      ? Number(value)
      : value.toString();
  }
  if (value instanceof Uint8Array) return Buffer.from(value);
  return value;
}

export const db = drizzle(
  async (query, params, method) => {
    const stmt = sqlite.prepare(query);
    if (method === 'run') {
      stmt.run(...params);
      return { rows: [] };
    }
    const rows = stmt.all(...params).map((row) => Object.values(row).map(normalise));
    return { rows: method === 'get' ? (rows[0] ?? []) : rows };
  },
  { schema },
);

export { schema };

export async function runStoreMigrations() {
  const dir = migrationsDir();
  if (!fs.existsSync(dir)) {
    throw new Error(
      `No Drizzle migrations found at ${dir}. Run \`npm run db:generate\`, or set PM2D_MIGRATIONS_DIR.`,
    );
  }

  let statements = 0;
  await migrate(
    db,
    async (queries) => {
      if (queries.length === 0) return;
      statements = queries.length;
      sqlite.exec('begin');
      try {
        for (const q of queries) sqlite.exec(q);
        sqlite.exec('commit');
      } catch (err) {
        sqlite.exec('rollback');
        throw err;
      }
    },
    { migrationsFolder: dir, migrationsTable: '__drizzle_migrations' },
  );

  if (statements) console.log(`[store] applied schema migrations (${statements} statements)`);
  return { applied: statements > 0, statements };
}

export function closeStore() {
  try {
    sqlite.close();
  } catch {
  }
}
