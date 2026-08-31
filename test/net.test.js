import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serviceUrl, servesPort, routesForPort } from '../src/lib/net.js';

test('serviceUrl needs a port', () => {
  assert.equal(serviceUrl(3000), 'http://localhost:3000');
  assert.equal(serviceUrl(null), null);
  assert.equal(serviceUrl(''), null);
});

test('servesPort matches the local host forms and the exact port', () => {
  for (const s of ['http://localhost:3000', 'http://127.0.0.1:3000', 'https://localhost:3000/']) {
    assert.equal(servesPort(s, 3000), true, s);
  }
  assert.equal(servesPort('http://localhost:3000', '3000'), true, 'a string port is the same port');
});

test('servesPort does not match a port that merely starts the same', () => {
  assert.equal(servesPort('http://localhost:30000', 3000), false);
  assert.equal(servesPort('http://localhost:3001', 3000), false);
});

test('servesPort ignores another machine on the same port', () => {
  assert.equal(servesPort('http://192.168.1.9:3000', 3000), false);
  assert.equal(servesPort('http://other.internal:3000', 3000), false);
});

test('servesPort copes with nonsense', () => {
  assert.equal(servesPort(null, 3000), false);
  assert.equal(servesPort('not a url', 3000), false);
  assert.equal(servesPort('http://localhost:3000', null), false);
});

test('routesForPort finds only this app, and carries its tunnel', () => {
  const tunnels = [
    { name: 'a', routes: [{ hostname: 'x.com', service: 'http://localhost:3000' }] },
    { name: 'b', routes: [{ hostname: 'y.com', service: 'http://localhost:3001' }] },
  ];
  const found = routesForPort(tunnels, 3000);
  assert.equal(found.length, 1);
  assert.equal(found[0].hostname, 'x.com');
  assert.equal(found[0].tunnel.name, 'a');
});

test('routesForPort is empty without a port, or without tunnels', () => {
  assert.deepEqual(routesForPort([{ routes: [{ service: 'http://localhost:3000' }] }], null), []);
  assert.deepEqual(routesForPort(undefined, 3000), []);
});
