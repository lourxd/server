import { test } from 'node:test';
import assert from 'node:assert/strict';
import { begin, isBusy, snapshot, activityBus } from '../src/lib/server/activity.js';

test('an activity is visible while it runs and gone after', () => {
  const end = begin('my-app', 'building');
  assert.equal(isBusy('my-app'), true);
  assert.equal(snapshot()['my-app'].kind, 'building');
  end();
  assert.equal(isBusy('my-app'), false);
});

test('ending twice is harmless', () => {
  const end = begin('twice', 'building');
  end();
  end();
  assert.equal(isBusy('twice'), false);
});

test('an activity with no name or kind is a no-op', () => {
  begin(null, 'building')();
  begin('x', null)();
  assert.deepEqual(snapshot(), {});
});

test('every change is broadcast', () => {
  const seen = [];
  const listener = (map) => seen.push(Object.keys(map).length);
  activityBus.on('change', listener);
  const end = begin('watched', 'installing');
  end();
  activityBus.off('change', listener);
  assert.deepEqual(seen, [1, 0]);
});

test('two apps can be busy at once', () => {
  const a = begin('one', 'building');
  const b = begin('two', 'installing');
  assert.equal(Object.keys(snapshot()).length, 2);
  a();
  b();
  assert.deepEqual(snapshot(), {});
});
