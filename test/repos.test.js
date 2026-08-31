import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { loadSettings } from '../src/lib/server/store/settings.js';
import { safeRepoPath } from '../src/lib/server/repos.js';

const settings = await loadSettings();
const root = path.resolve(settings.projectsDir);

test('a plain name resolves inside the projects directory', () => {
  assert.equal(safeRepoPath('my-app'), path.join(root, 'my-app'));
});

test('an empty path is the projects directory itself', () => {
  assert.equal(safeRepoPath(''), root);
});

test('traversal is refused', () => {
  for (const bad of ['../etc', '../../etc/passwd', 'a/../../../etc', './../x']) {
    assert.throws(() => safeRepoPath(bad), `${bad} should be refused`);
  }
});

test('an absolute path is refused', () => {
  assert.throws(() => safeRepoPath('/etc/passwd'));
  assert.throws(() => safeRepoPath('/'));
});

test('a nested path inside the root is allowed', () => {
  assert.equal(safeRepoPath('group/app'), path.join(root, 'group', 'app'));
});
