import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

const now = sql`(unixepoch() * 1000)`;

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value'),
  encrypted: integer('encrypted', { mode: 'boolean' }).notNull().default(false),
  updatedAt: integer('updated_at').notNull().default(now),
});

export const dbConnections = sqliteTable(
  'db_connections',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    type: text('type').notNull(),
    host: text('host').default(''),
    port: integer('port'),
    user: text('user').default(''),
    password: text('password').default(''),
    database: text('database').default(''),
    file: text('file').default(''),
    url: text('url').default(''),
    ssl: integer('ssl', { mode: 'boolean' }).notNull().default(false),
    readOnly: integer('read_only', { mode: 'boolean' }).notNull().default(false),
    createIfMissing: integer('create_if_missing', { mode: 'boolean' }).notNull().default(false),
    color: text('color'),
    createdAt: integer('created_at').notNull().default(now),
    updatedAt: integer('updated_at').notNull().default(now),
  },
  (t) => [uniqueIndex('db_connections_name_idx').on(t.name)],
);

export const tunnels = sqliteTable(
  'tunnels',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    cfTunnelId: text('cf_tunnel_id'),
    accountId: text('account_id'),
    kind: text('kind').notNull().default('named'),
    token: text('token').default(''),
    pm2Name: text('pm2_name'),
    quickUrl: text('quick_url'),
    lastStatus: text('last_status').default('unknown'),
    createdAt: integer('created_at').notNull().default(now),
    updatedAt: integer('updated_at').notNull().default(now),
  },
  (t) => [uniqueIndex('tunnels_name_idx').on(t.name)],
);

export const tunnelRoutes = sqliteTable(
  'tunnel_routes',
  {
    id: text('id').primaryKey(),
    tunnelId: text('tunnel_id')
      .notNull()
      .references(() => tunnels.id, { onDelete: 'cascade' }),
    hostname: text('hostname').notNull(),
    service: text('service').notNull(),
    path: text('path'),
    dnsRecordId: text('dns_record_id'),
    zoneId: text('zone_id'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: integer('created_at').notNull().default(now),
  },
  (t) => [index('tunnel_routes_tunnel_idx').on(t.tunnelId)],
);

export const auditLog = sqliteTable(
  'audit_log',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    at: integer('at').notNull().default(now),
    userId: text('user_id'),
    userEmail: text('user_email'),
    action: text('action').notNull(),
    target: text('target'),
    detail: text('detail'),
    ok: integer('ok', { mode: 'boolean' }).notNull().default(true),
    ip: text('ip'),
  },
  (t) => [index('audit_log_at_idx').on(t.at), index('audit_log_action_idx').on(t.action)],
);
