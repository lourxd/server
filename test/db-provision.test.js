import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseConnectionUrl, connectionUrl, isRemote, defaultVarFor, ENGINE_BY_TYPE } from '../src/lib/server/db/provision.js';

test('parses a managed postgres URL', () => {
  const c = parseConnectionUrl('postgres://user:p%40ss@ep-cool.neon.tech/neondb?sslmode=require');
  assert.equal(c.type, 'postgres');
  assert.equal(c.host, 'ep-cool.neon.tech');
  assert.equal(c.port, 5432);
  assert.equal(c.user, 'user');
  assert.equal(c.password, 'p@ss', 'percent-encoding must decode');
  assert.equal(c.database, 'neondb');
  assert.equal(c.ssl, true);
});

test('keeps an explicit port', () => {
  assert.equal(parseConnectionUrl('mysql://root:x@db.example.com:3307/shop').port, 3307);
});

test('mongodb+srv implies TLS and keeps the original URL', () => {
  const c = parseConnectionUrl('mongodb+srv://me:pw@cluster0.abc.mongodb.net/mydb');
  assert.equal(c.type, 'mongodb');
  assert.equal(c.ssl, true);
  assert.match(c.url, /^mongodb\+srv:/, 'srv URLs must be passed through verbatim');
});

test('rediss implies TLS', () => {
  assert.equal(parseConnectionUrl('rediss://default:tok@upstash.io:6379').ssl, true);
});

test('rejects a scheme we cannot drive', () => {
  assert.throws(() => parseConnectionUrl('ftp://host/x'), /Unsupported scheme/);
  assert.throws(() => parseConnectionUrl('not a url'), /not a valid connection string/i);
  assert.throws(() => parseConnectionUrl(''), /Paste a connection string/);
});

test('isRemote is derived from the host', () => {
  assert.equal(isRemote({ type: 'postgres', host: 'db.example.com' }), true);
  assert.equal(isRemote({ type: 'postgres', host: '127.0.0.1' }), false);
  assert.equal(isRemote({ type: 'postgres', host: 'localhost' }), false);
  assert.equal(isRemote({ type: 'postgres', host: 'LOCALHOST' }), false, 'case must not matter');
  assert.equal(isRemote({ type: 'sqlite', file: '/x.db' }), false, 'a file is never remote');
  assert.equal(isRemote(null), false);
});

test('builds a connection string an app can use', () => {
  const url = connectionUrl({
    type: 'postgres', host: 'db.internal', port: 5432,
    user: 'app', password: 'p@ss word', database: 'shop', ssl: true,
  });
  const back = parseConnectionUrl(url);
  assert.equal(back.user, 'app');
  assert.equal(back.password, 'p@ss word', 'a password with symbols must survive the round trip');
  assert.equal(back.database, 'shop');
  assert.equal(back.ssl, true);
});

test('a stored URL is used verbatim rather than rebuilt', () => {
  const original = 'postgres://u:p@ep.neon.tech/neondb?sslmode=require';
  assert.equal(connectionUrl({ type: 'postgres', url: original }), original);
});

test('sqlite becomes a file URL', () => {
  assert.equal(connectionUrl({ type: 'sqlite', file: '/tmp/notes.db' }), 'file:/tmp/notes.db');
});

test('each engine has a conventional variable name', () => {
  assert.equal(defaultVarFor('postgres'), 'DATABASE_URL');
  assert.equal(defaultVarFor('mongodb'), 'MONGODB_URI');
  assert.equal(defaultVarFor('redis'), 'REDIS_URL');
  assert.equal(defaultVarFor('something-else'), 'DATABASE_URL');
});

test('every engine in the catalogue is complete', () => {
  for (const [type, e] of Object.entries(ENGINE_BY_TYPE)) {
    assert.ok(e.label, `${type} needs a label`);
    assert.ok(e.logo, `${type} needs a logo`);
    assert.ok(e.summary, `${type} needs a summary`);
    if (e.needsServer) {
      assert.ok(e.defaultPort, `${type} needs a default port`);
      assert.ok(e.install, `${type} needs an install hint`);
    }
  }
});
