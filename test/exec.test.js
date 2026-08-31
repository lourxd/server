import { test } from 'node:test';
import assert from 'node:assert/strict';
import { which } from '../src/lib/server/exec.js';

test('which finds a binary on PATH', () => {
  assert.match(which('node') ?? '', /\/node$/);
  assert.ok(which('git'));
});

test('which returns null rather than guessing', () => {
  assert.equal(which('definitely-not-installed-anywhere'), null);
});

test('which refuses anything that is not a bare binary name', () => {
  for (const hostile of ['../../bin/sh', '/bin/sh', 'a;b', 'a b', 'a|b', '$(id)', '', null]) {
    assert.equal(which(hostile), null, `${hostile} must be refused`);
  }
});
