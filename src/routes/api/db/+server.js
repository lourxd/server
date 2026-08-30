import { json, error } from '@sveltejs/kit';
import * as db from '$srv/db/index.js';
import { createDatabase } from '$srv/db/provision.js';
import { record } from '$srv/store/audit.js';

export async function GET({ url }) {
  const op = url.searchParams.get('op');
  const id = url.searchParams.get('id');
  const database = url.searchParams.get('database') || null;
  const table = url.searchParams.get('table');

  try {
    switch (op) {
      case 'connections':
        return json(await db.listConnections());
      case 'engines':
        return json(await db.detectLocalEngines());
      case 'test':
        return json(await db.testConnection(id, database));
      case 'databases':
        return json(await db.databases(id));
      case 'tables':
        return json(await db.tables(id, database));
      case 'columns':
        return json(await db.tableColumns(id, database, table));
      case 'stats':
        return json(await db.dbStats(id, database));
      case 'browse':
        return json(
          await db.browseTable(id, database, {
            table,
            limit: Math.min(Number(url.searchParams.get('limit')) || 50, 500),
            offset: Math.max(Number(url.searchParams.get('offset')) || 0, 0),
            orderBy: url.searchParams.get('orderBy') || undefined,
            orderDir: url.searchParams.get('orderDir') === 'desc' ? 'desc' : 'asc',
          }),
        );
      default:
        error(400, `Unknown operation: ${op}`);
    }
  } catch (err) {
    if (err?.status) throw err;
    error(500, err.message);
  }
}

export async function POST({ request, locals, getClientAddress }) {
  const body = await request.json().catch(() => ({}));
  const audit = (action, target, detail) =>
    record({ user: locals.user, action, target, detail, ip: getClientAddress() });
  try {
    switch (body.action) {
      case 'save': {
        const saved = await db.saveConnection(body.connection ?? body);
        audit('db.connection.save', saved.name, { type: saved.type });
        return json(saved);
      }
      case 'create': {
        const created = await createDatabase(body);
        audit('db.create', created.name, { type: created.type });
        return json(created);
      }
      case 'delete': {
        const res = await db.deleteConnection(body.id);
        audit('db.connection.delete', res.name);
        return json(res);
      }
      case 'probe':
        return json(await db.probe(body.connection ?? body));
      case 'query':
        return json(
          await db.runQuery(body.id, body.database || null, body.sql, {
            collection: body.collection,
            allowDangerous: !!body.allowDangerous,
            limit: Math.min(Number(body.limit) || 500, 2000),
          }),
        );
      case 'service': {
        audit('db.service', body.service, { action: body.serviceAction });
        return json(await db.controlService(body.service, body.serviceAction));
      }
      case 'disconnect':
        db.closeClient(body.id);
        return json({ ok: true });
      default:
        error(400, `Unknown action: ${body.action}`);
    }
  } catch (err) {
    if (err?.status) throw err;
    error(500, err.message);
  }
}
