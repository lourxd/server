import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { checkPort } from '../src/lib/server/ports.js';

test('rejects values that are not ports', async () => {
  for (const bad of ['nonsense', 0, 65536, -1, '']) {
    const r = await checkPort(bad);
    assert.equal(r.free, false, `${bad} should not be free`);
  }
});

test('flags a privileged port as unbindable rather than free', async () => {
  const r = await checkPort(80);
  assert.equal(r.free, false);
  assert.equal(r.privileged, true);
  assert.match(r.reason, /privileged/);
});

test('an unused high port is free', async () => {
  const r = await checkPort(47913);
  assert.equal(r.free, true, r.reason);
});

test('a port held by a listener is not free', async () => {
  const server = net.createServer();
  await new Promise((res) => server.listen(47914, '127.0.0.1', res));
  try {
    const r = await checkPort(47914);
    assert.equal(r.free, false);
    assert.match(r.reason, /already in use|already used/);
  } finally {
    await new Promise((res) => server.close(res));
  }
});

test('the port is free again once the listener closes', async () => {
  const server = net.createServer();
  await new Promise((res) => server.listen(47915, '127.0.0.1', res));
  await new Promise((res) => server.close(res));
  assert.equal((await checkPort(47915)).free, true);
});
