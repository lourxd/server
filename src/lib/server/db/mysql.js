import mysql from 'mysql2/promise';

export const meta = {
  type: 'mysql',
  label: 'MySQL / MariaDB',
  defaultPort: 3306,
  supportsSql: true,
  hasSchemas: false,
};

export function createClient(conn, database) {
  const base = conn.url
    ? { uri: conn.url }
    : {
        host: conn.host || '127.0.0.1',
        port: Number(conn.port) || meta.defaultPort,
        user: conn.user || 'root',
        password: conn.password || undefined,
        ssl: conn.ssl ? { rejectUnauthorized: false } : undefined,
      };
  return mysql.createPool({
    ...base,
    database: database || conn.database || undefined,
    connectionLimit: 4,
    connectTimeout: 8000,
    waitForConnections: true,
    decimalNumbers: false,
    supportBigNumbers: true,
    bigNumberStrings: true,
    dateStrings: true,
    multipleStatements: false,
  });
}

export async function close(pool) {
  await pool.end().catch(() => {});
}

export async function test(pool) {
  const [rows] = await pool.query('select version() as version, database() as db, current_user() as usr');
  return { ok: true, version: rows[0].version, database: rows[0].db, user: rows[0].usr };
}

export async function listDatabases(pool) {
  const [rows] = await pool.query(`
    select s.schema_name as name,
           coalesce(sum(t.data_length + t.index_length), 0) as size,
           s.default_character_set_name as charset,
           count(t.table_name) as tables
    from information_schema.schemata s
    left join information_schema.tables t on t.table_schema = s.schema_name
    group by s.schema_name, s.default_character_set_name
    order by s.schema_name
  `);
  return rows.map((r) => ({
    name: r.name,
    size: Number(r.size),
    charset: r.charset,
    tables: Number(r.tables),
    system: ['mysql', 'information_schema', 'performance_schema', 'sys'].includes(r.name),
  }));
}

export async function listTables(pool, database) {
  const [rows] = await pool.query(
    `select table_name as name, table_type as kind, table_rows as approx_rows,
            (data_length + index_length) as size, engine
     from information_schema.tables
     where table_schema = ?
     order by table_name`,
    [database],
  );
  return rows.map((r) => ({
    name: r.name,
    schema: database,
    kind: r.kind === 'VIEW' ? 'view' : 'table',
    rows: Number(r.approx_rows || 0),
    size: Number(r.size || 0),
    engine: r.engine,
  }));
}

export async function columns(pool, { table, database }) {
  const [rows] = await pool.query(
    `select column_name as name, column_type as type, is_nullable = 'YES' as nullable,
            column_default as \`default\`, ordinal_position as position,
            column_key as \`key\`, extra
     from information_schema.columns
     where table_schema = ? and table_name = ?
     order by ordinal_position`,
    [database, table],
  );
  return rows.map((c) => ({
    name: c.name,
    type: c.type,
    nullable: !!c.nullable,
    default: c.default,
    position: c.position,
    primaryKey: c.key === 'PRI',
    foreignKey: c.key === 'MUL',
    extra: c.extra,
  }));
}

const ident = (s) => `\`${String(s).replace(/`/g, '``')}\``;

export async function browse(pool, { table, database, limit = 50, offset = 0, orderBy, orderDir = 'asc' }) {
  const cols = await columns(pool, { table, database });
  const valid = new Set(cols.map((c) => c.name));
  const qualified = `${ident(database)}.${ident(table)}`;
  const order = orderBy && valid.has(orderBy) ? ` order by ${ident(orderBy)} ${orderDir === 'desc' ? 'desc' : 'asc'}` : '';
  const [rows] = await pool.query(`select * from ${qualified}${order} limit ? offset ?`, [Math.min(limit, 500), offset]);
  const [[count]] = await pool.query(`select count(*) as n from ${qualified}`);
  return { columns: cols, rows, total: Number(count.n) };
}

export async function query(pool, sql, { limit = 500 } = {}) {
  const started = Date.now();
  const [rows, fields] = await pool.query(sql);
  const isSelect = Array.isArray(rows);
  return {
    columns: isSelect ? (fields || []).map((f) => ({ name: f.name })) : [{ name: 'result' }],
    rows: isSelect ? rows.slice(0, limit) : [rows],
    rowCount: isSelect ? rows.length : rows.affectedRows ?? 0,
    truncated: isSelect && rows.length > limit,
    durationMs: Date.now() - started,
  };
}

export async function stats(pool) {
  const [[status]] = await pool.query(`show global status like 'Threads_connected'`);
  const [[uptime]] = await pool.query(`show global status like 'Uptime'`);
  const [[maxConn]] = await pool.query(`show variables like 'max_connections'`);
  const [[size]] = await pool.query(
    `select coalesce(sum(data_length + index_length), 0) as total from information_schema.tables`,
  );
  return {
    connections: Number(status?.Value || 0),
    maxConnections: Number(maxConn?.Value || 0),
    uptimeSec: Number(uptime?.Value || 0),
    totalSize: Number(size.total),
  };
}
