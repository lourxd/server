import { desc, eq, and, gte } from 'drizzle-orm';
import { db, schema } from './index.js';

const { auditLog } = schema;

export function record({ user, action, target, detail, ok = true, ip } = {}) {
  return db
    .insert(auditLog)
    .values({
      at: Date.now(),
      userId: user?.id ?? null,
      userEmail: user?.email ?? null,
      action,
      target: target ?? null,
      detail: detail == null ? null : JSON.stringify(detail),
      ok,
      ip: ip ?? null,
    })
    .catch((err) => console.error('[audit] could not record entry:', err.message));
}

export async function recent({ limit = 100, action, since } = {}) {
  const filters = [];
  if (action) filters.push(eq(auditLog.action, action));
  if (since) filters.push(gte(auditLog.at, since));

  const rows = await db
    .select()
    .from(auditLog)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(auditLog.at))
    .limit(Math.min(limit, 500));

  return rows.map((r) => ({ ...r, detail: r.detail ? JSON.parse(r.detail) : null }));
}
