import pg from 'pg';

pg.types.setTypeParser(20, (v) => v);
pg.types.setTypeParser(1700, (v) => v);

export const meta = {
  type: 'postgres',
  label: 'PostgreSQL',
  defaultPort: 5432,
  supportsSql: true,
  hasSchemas: true,
};

function poolConfig(conn) {
  if (conn.url) return { connectionString: conn.url, max: 4, connectionTimeoutMillis: 8000, idleTimeoutMillis: 30_000 };
  return {
    host: conn.host || '127.0.0.1',
    port: Number(conn.port) || meta.defaultPort,
    user: conn.user || undefined,
    password: conn.password || undefined,
    database: conn.database || 'postgres',
    ssl: conn.ssl ? { rejectUnauthorized: false } : undefined,
    max: 4,
    connectionTimeoutMillis: 8000,
    idleTimeoutMillis: 30_000,
  };
}

export function createClient(conn, database) {
  const cfg = poolConfig(conn);
  if (database) {
    if (cfg.connectionString) {
      const u = new URL(cfg.connectionString);
      u.pathname = `/${database}`;
      cfg.connectionString = u.toString();
    } else {
      cfg.database = database;
    }
  }
  const pool = new pg.Pool(cfg);
  pool.on('error', (err) => console.error('[postgres] idle client error:', err.message));
  return pool;
}

export async function close(pool) {
  await pool.end().catch(() => {});
}

export async function test(pool) {
  const r = await pool.query('select version() as version, current_database() as db, current_user as usr');
  return { ok: true, version: r.rows[0].version, database: r.rows[0].db, user: r.rows[0].usr };
}

export async function listDatabases(pool) {
  const r = await pool.query(`
    select d.datname as name,
           pg_database_size(d.datname) as size,
           pg_get_userbyid(d.datdba) as owner,
           pg_encoding_to_char(d.encoding) as encoding
    from pg_database d
    where d.datistemplate = false
    order by d.datname
  `);
  return r.rows.map((x) => ({ name: x.name, size: Number(x.size), owner: x.owner, encoding: x.encoding }));
}

export async function listTables(pool) {
  const r = await pool.query(`
    select c.relname as name,
           n.nspname as schema,
           case c.relkind when 'r' then 'table' when 'v' then 'view' when 'm' then 'matview' when 'p' then 'partitioned' else c.relkind::text end as kind,
           coalesce(c.reltuples, 0)::bigint as approx_rows,
           pg_total_relation_size(c.oid) as size
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r','v','m','p')
      and n.nspname not in ('pg_catalog','information_schema')
      and n.nspname not like 'pg_toast%'
    order by n.nspname, c.relname
  `);
  return r.rows.map((x) => ({
    name: x.name,
    schema: x.schema,
    kind: x.kind,
    rows: Number(x.approx_rows),
    size: Number(x.size),
  }));
}

export async function columns(pool, { table, schema = 'public' }) {
  const r = await pool.query(
    `select column_name as name, data_type as type, is_nullable = 'YES' as nullable,
            column_default as "default", ordinal_position as position,
            character_maximum_length as length
     from information_schema.columns
     where table_name = $1 and table_schema = $2
     order by ordinal_position`,
    [table, schema],
  );
  const keys = await pool.query(
    `select kcu.column_name as name, tc.constraint_type as type
     from information_schema.table_constraints tc
     join information_schema.key_column_usage kcu
       on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema
     where tc.table_name = $1 and tc.table_schema = $2`,
    [table, schema],
  );
  const pk = new Set(keys.rows.filter((k) => k.type === 'PRIMARY KEY').map((k) => k.name));
  const fk = new Set(keys.rows.filter((k) => k.type === 'FOREIGN KEY').map((k) => k.name));
  return r.rows.map((c) => ({ ...c, primaryKey: pk.has(c.name), foreignKey: fk.has(c.name) }));
}

const ident = (s) => `"${String(s).replace(/"/g, '""')}"`;

export async function browse(pool, { table, schema = 'public', limit = 50, offset = 0, orderBy, orderDir = 'asc' }) {
  const qualified = `${ident(schema)}.${ident(table)}`;
  const cols = await columns(pool, { table, schema });
  const valid = new Set(cols.map((c) => c.name));
  let order = '';
  if (orderBy && valid.has(orderBy)) {
    order = ` order by ${ident(orderBy)} ${orderDir === 'desc' ? 'desc' : 'asc'}`;
  }
  const [rows, count] = await Promise.all([
    pool.query(`select * from ${qualified}${order} limit $1 offset $2`, [Math.min(limit, 500), offset]),
    pool.query(`select count(*) as n from ${qualified}`),
  ]);
  return {
    columns: cols,
    rows: rows.rows,
    total: Number(count.rows[0].n),
  };
}

export async function query(pool, sql, { limit = 500 } = {}) {
  const started = Date.now();
  const r = await pool.query(sql);
  const result = Array.isArray(r) ? r[r.length - 1] : r;
  return {
    columns: (result.fields || []).map((f) => ({ name: f.name })),
    rows: (result.rows || []).slice(0, limit),
    rowCount: result.rowCount ?? (result.rows || []).length,
    truncated: (result.rows || []).length > limit,
    command: result.command,
    durationMs: Date.now() - started,
  };
}

export async function stats(pool) {
  const [activity, size, uptime] = await Promise.all([
    pool.query(`select state, count(*)::int as n from pg_stat_activity group by state`),
    pool.query(`select sum(pg_database_size(datname))::bigint as total from pg_database where datistemplate = false`),
    pool.query(`select extract(epoch from (now() - pg_postmaster_start_time()))::bigint as uptime,
                       (select setting::int from pg_settings where name = 'max_connections') as max_connections`),
  ]);
  return {
    connections: activity.rows.reduce((a, x) => a + x.n, 0),
    byState: Object.fromEntries(activity.rows.map((x) => [x.state || 'unknown', x.n])),
    maxConnections: Number(uptime.rows[0].max_connections),
    totalSize: Number(size.rows[0].total),
    uptimeSec: Number(uptime.rows[0].uptime),
  };
}
