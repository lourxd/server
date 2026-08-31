import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startBuildLog, appendBuildLog, readBuildLog, clearBuildLog } from '../src/lib/server/buildlog.js';

test('a build log round-trips', () => {
  const file = startBuildLog('round-trip', 'run-script build');
  appendBuildLog(file, '> next build');
  appendBuildLog(file, 'Compiled successfully');
  const log = readBuildLog('round-trip');
  assert.equal(log.exists, true);
  assert.equal(log.lines.length, 3);
  assert.ok(log.at > 0);
  clearBuildLog('round-trip');
  assert.equal(readBuildLog('round-trip').exists, false);
});

test('error lines are marked so they render red', () => {
  const file = startBuildLog('tones', 'build');
  appendBuildLog(file, 'all good');
  appendBuildLog(file, 'Error: it broke');
  const streams = readBuildLog('tones').lines.map((l) => l.stream);
  assert.ok(streams.includes('err'), 'an error line must be marked');
  assert.ok(streams.includes('out'), 'a normal line must not be');
  clearBuildLog('tones');
});

test('an app name cannot escape the log directory', () => {
  for (const hostile of ['../../etc/passwd', '/etc/shadow', 'a/b/c', '..']) {
    const file = startBuildLog(hostile, 'build');
    if (!file) continue;
    const dir = path.dirname(path.resolve(file));
    assert.equal(path.basename(dir), 'build-logs', `${hostile} escaped to ${file}`);
    assert.ok(!path.basename(file).startsWith('.'), `${hostile} produced a hidden file`);
    clearBuildLog(hostile);
  }
});

test('reading a log that was never written is empty, not an error', () => {
  const log = readBuildLog('never-built');
  assert.equal(log.exists, false);
  assert.deepEqual(log.lines, []);
});

test('a starting log replaces the previous run rather than growing', () => {
  const first = startBuildLog('replaced', 'build one');
  appendBuildLog(first, 'from the first run');
  startBuildLog('replaced', 'build two');
  const log = readBuildLog('replaced');
  assert.ok(!log.lines.some((l) => l.line.includes('first run')), 'old output must be cleared');
  clearBuildLog('replaced');
});

test('the log file is not world readable', () => {
  const file = startBuildLog('perms', 'build');
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  clearBuildLog('perms');
});
