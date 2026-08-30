import fs from 'node:fs';
import path from 'node:path';
import { DRIVERS, DRIVER_META, probe, saveConnection } from './index.js';
import { safeRepoPath } from '../repos.js';

const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;

export const ENGINES = [
  {
    type: 'postgres',
    label: 'PostgreSQL',
    logo: 'postgresql',
    summary: 'Relational, the default choice for most applications',
    needsServer: true,
    defaultPort: 5432,
    defaultUser: 'postgres',
    install: 'sudo apt install postgresql',
  },
  {
    type: 'mysql',
    label: 'MySQL / MariaDB',
    logo: 'mysql',
    summary: 'Relational, widely supported by older stacks',
    needsServer: true,
    defaultPort: 3306,
    defaultUser: 'root',
    install: 'sudo apt install mariadb-server',
  },
  {
    type: 'mongodb',
    label: 'MongoDB',
    logo: 'mongodb',
    summary: 'Document store, schema-free JSON documents',
    needsServer: true,
    defaultPort: 27017,
    defaultUser: '',
    install: 'sudo apt install mongodb-org',
  },
  {
    type: 'redis',
    label: 'Redis / Valkey',
    logo: 'redis',
    summary: 'In-memory key/value, for caching, queues and sessions',
    needsServer: true,
    defaultPort: 6379,
    defaultUser: '',
    install: 'sudo apt install redis-server',
  },
  {
    type: 'sqlite',
    label: 'SQLite',
    logo: 'sqlite',
    summary: 'A single file on this machine, nothing to run',
    needsServer: false,
    defaultPort: null,
    defaultUser: '',
    install: null,
  },
];

export const ENGINE_BY_TYPE = Object.fromEntries(ENGINES.map((e) => [e.type, e]));

function assertName(name) {
  if (!NAME_RE.test(name)) {
    throw new Error(
      'Use letters, digits and underscores, starting with a letter or underscore — at most 63 characters.',
    );
  }
}

async function createSqlite({ name, connectionName }) {
  assertName(name);
  const file = safeRepoPath(path.join('databases', `${name}.db`));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) throw new Error(`A database file already exists at ${file}.`);

  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(file);
  db.exec('pragma journal_mode = WAL');
  db.close();
  fs.chmodSync(file, 0o600);

  return saveConnection({ name: connectionName || name, type: 'sqlite', file, createIfMissing: false });
}

async function createOnServer({ type, name, connectionName, server }) {
  assertName(name);
  const meta = DRIVER_META[type];
  const engine = ENGINE_BY_TYPE[type];
  const base = {
    type,
    host: server.host || '127.0.0.1',
    port: Number(server.port) || meta.defaultPort,
    user: server.user ?? engine.defaultUser,
    password: server.password ?? '',
    ssl: !!server.ssl,
  };

  const reachable = await probe({ ...base, database: server.adminDatabase || undefined }).catch((err) => {
    throw new Error(`Could not reach the ${engine.label} server: ${err.message}`);
  });
  if (reachable && reachable.ok === false) throw new Error(reachable.error || 'Server refused the connection.');

  if (type === 'postgres' || type === 'mysql') {
    const driver = DRIVERS[type];
    const client = driver.createClient({ ...base, database: server.adminDatabase || undefined });
    try {
      const quoted = type === 'postgres' ? `"${name}"` : `\`${name}\``;
      await driver.query(client, `CREATE DATABASE ${quoted}`, { limit: 1 });
    } catch (err) {
      const message = String(err?.message ?? err);
      if (/exists/i.test(message)) throw new Error(`A database called "${name}" already exists on that server.`);
      throw new Error(`Could not create the database: ${message}`);
    } finally {
      await driver.close(client).catch(() => {});
    }
  }

  return saveConnection({ ...base, name: connectionName || name, database: name });
}

export async function createDatabase(input) {
  const engine = ENGINE_BY_TYPE[input.type];
  if (!engine) throw new Error(`Unsupported database type: ${input.type}`);
  const name = String(input.name ?? '').trim();
  if (!name) throw new Error('A name is required.');

  return engine.needsServer
    ? createOnServer({ ...input, name, server: input.server ?? {} })
    : createSqlite({ ...input, name });
}
