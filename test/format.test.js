import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bytes, duration, pct, num } from '../src/lib/format.js';

test('bytes scales and stays readable', () => {
  assert.equal(bytes(0), '0 B');
  assert.match(bytes(1024), /1(\.0)? KB/);
  assert.match(bytes(1536), /1\.5 KB/);
  assert.match(bytes(1024 ** 3), /1(\.0)? GB/);
});

test('bytes survives rubbish', () => {
  for (const v of [null, undefined, NaN, -1]) assert.equal(typeof bytes(v), 'string');
});

test('duration reads as time', () => {
  assert.match(duration(5000), /5s/);
  assert.match(duration(65_000), /1m/);
  assert.match(duration(3_600_000), /1h/);
});

test('pct and num do not throw on nothing', () => {
  assert.equal(typeof pct(undefined), 'string');
  assert.equal(typeof num(undefined), 'string');
  assert.equal(typeof num(1234), 'string');
});

test('connectionEndpoint reads as an address, whatever the engine', async () => {
  const { connectionEndpoint } = await import('../src/lib/format.js');
  assert.equal(connectionEndpoint({ type: 'sqlite', file: '/x/notes.db' }), '/x/notes.db');
  assert.equal(connectionEndpoint({ type: 'postgres', host: 'db', port: 5432 }), 'db:5432');
  assert.equal(
    connectionEndpoint({ type: 'postgres', host: 'db', port: 5432, database: 'shop' }),
    'db:5432 / shop',
  );
  assert.equal(connectionEndpoint(null), '');
});
