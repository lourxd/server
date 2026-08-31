import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeStatus, TONE_CLASS } from '../src/lib/status.js';

test('a known PM2 status keeps its meaning', () => {
  assert.equal(describeStatus('online').label, 'online');
  assert.equal(describeStatus('online').tone, 'ok');
  assert.equal(describeStatus('errored').tone, 'bad');
  assert.equal(describeStatus('stopped').tone, 'idle');
});

test("PM2's internal names get readable labels", () => {
  assert.equal(describeStatus('waiting restart').label, 'restarting');
  assert.equal(describeStatus('one-launch-status').label, 'ran once');
  assert.equal(describeStatus('launching').label, 'starting');
});

test('panel activity wins over the process state', () => {
  const state = describeStatus('online', { kind: 'building' });
  assert.equal(state.label, 'building');
  assert.equal(state.tone, 'info');
  assert.equal(state.busy, true);
  assert.equal(state.raw, 'online');
});

test('an unknown activity falls back to the process state', () => {
  assert.equal(describeStatus('online', { kind: 'nonsense' }).label, 'online');
});

test('an unknown status is passed through rather than hidden', () => {
  const state = describeStatus('some-new-pm2-state');
  assert.equal(state.label, 'some-new-pm2-state');
  assert.equal(state.tone, 'idle');
});

test('a missing status does not crash', () => {
  assert.equal(describeStatus(undefined).label, 'unknown');
});

test('transient states are marked busy, settled ones are not', () => {
  for (const s of ['launching', 'stopping', 'waiting restart']) {
    assert.equal(describeStatus(s).busy, true, `${s} should be busy`);
  }
  for (const s of ['online', 'stopped', 'errored']) {
    assert.ok(!describeStatus(s).busy, `${s} should not be busy`);
  }
});

test('every tone a status can produce has a class', () => {
  const statuses = ['online', 'stopped', 'errored', 'launching', 'waiting restart', 'unknown-x'];
  for (const s of statuses) assert.ok(TONE_CLASS[describeStatus(s).tone], `no class for ${s}`);
  for (const k of ['building', 'deploying', 'installing']) {
    assert.ok(TONE_CLASS[describeStatus('online', { kind: k }).tone], `no class for ${k}`);
  }
});
