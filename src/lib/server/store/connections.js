import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db, schema } from './index.js';
import { encrypt, decrypt } from './settings.js';

const { dbConnections } = schema;

const SQLITE_CONSTRAINT_UNIQUE = 2067;

function isUniqueViolation(err) {
  for (let e = err; e; e = e.cause) {
    if (e.errcode === SQLITE_CONSTRAINT_UNIQUE) return true;
    if (/UNIQUE constraint failed/i.test(e.message ?? '')) return true;
  }
  return false;
}

export function toPublic(row) {
  const { password, url, ...rest } = row;
  return { ...rest, hasPassword: !!password, url: url ? maskUrl(decrypt(url)) : null };
}

function maskUrl(url) {
  try {
    const u = new URL(url);
    if (u.password) u.password = '***';
    return u.toString();
  } catch {
    return url ? '***' : null;
  }
}

export async function listConnections() {
  const rows = await db.select().from(dbConnections).orderBy(dbConnections.name);
  return rows.map(toPublic);
}

export async function getConnection(id) {
  const [row] = await db.select().from(dbConnections).where(eq(dbConnections.id, id));
  if (!row) throw new Error('Connection not found.');
  return { ...row, password: decrypt(row.password), url: decrypt(row.url) };
}

export async function saveConnection(input, { validTypes }) {
  const type = String(input.type || '').trim();
  if (validTypes && !validTypes.has(type)) throw new Error(`Unsupported database type: ${type}`);

  const name = String(input.name || '').trim();
  if (!name) throw new Error('Give the connection a name.');

  const existing = input.id ? await db.select().from(dbConnections).where(eq(dbConnections.id, input.id)) : [];
  const prev = existing[0];

  const record = {
    name,
    type,
    host: input.host?.trim() || '',
    port: input.port ? Number(input.port) : null,
    user: input.user?.trim() || '',
    database: input.database?.trim() || '',
    file: input.file?.trim() || '',
    ssl: !!input.ssl,
    readOnly: !!input.readOnly,
    createIfMissing: !!(input.create ?? input.createIfMissing),
    color: input.color || null,
    updatedAt: Date.now(),
    password: input.password ? encrypt(input.password) : (prev?.password ?? ''),
    url: input.url ? encrypt(input.url) : (prev?.url ?? ''),
  };

  try {
    if (prev) {
      await db.update(dbConnections).set(record).where(eq(dbConnections.id, prev.id));
      return toPublic({ ...prev, ...record });
    }
    const row = { id: crypto.randomUUID(), createdAt: Date.now(), ...record };
    await db.insert(dbConnections).values(row);
    return toPublic(row);
  } catch (err) {
    if (isUniqueViolation(err)) throw new Error(`A connection named "${name}" already exists.`);
    throw err;
  }
}

export async function deleteConnection(id) {
  const [row] = await db.select().from(dbConnections).where(eq(dbConnections.id, id));
  if (!row) throw new Error('Connection not found.');
  await db.delete(dbConnections).where(eq(dbConnections.id, id));
  return { ok: true, name: row.name };
}
