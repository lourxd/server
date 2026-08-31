import { test } from 'node:test';
import assert from 'node:assert/strict';

const { groupInstances } = await import('../src/lib/live-group.js');

const proc = (over) => ({
  name: 'api', pmId: 0, status: 'online', cpu: 1, memory: 100, restarts: 0, uptime: 10, ...over,
});

test('a clustered app is one entry, not one per instance', () => {
  const grouped = groupInstances([
    proc({ pmId: 0 }),
    proc({ pmId: 1 }),
    proc({ pmId: 2 }),
  ]);
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].instances, 3);
  assert.deepEqual(grouped[0].pmIds, [0, 1, 2]);
});

test('its cost is the sum across instances', () => {
  const grouped = groupInstances([proc({ pmId: 0, cpu: 2, memory: 100 }), proc({ pmId: 1, cpu: 3, memory: 150 })]);
  assert.equal(grouped[0].cpu, 5);
  assert.equal(grouped[0].memory, 250);
});

test('the worst instance status wins, so a failure is visible', () => {
  const grouped = groupInstances([proc({ pmId: 0 }), proc({ pmId: 1, status: 'errored' })]);
  assert.equal(grouped[0].status, 'errored');
});

test('separate apps stay separate', () => {
  const grouped = groupInstances([proc({ name: 'a' }), proc({ name: 'b', pmId: 1 })]);
  assert.equal(grouped.length, 2);
  assert.equal(grouped[0].instances, 1);
});

test('nothing in, nothing out', () => {
  assert.deepEqual(groupInstances([]), []);
});
