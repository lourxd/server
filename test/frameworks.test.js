import { test } from 'node:test';
import assert from 'node:assert/strict';
import { frameworkFor } from '../src/lib/frameworks.js';

test('a dependency identifies the framework', () => {
  const f = frameworkFor({ pkg: { dependencies: ['next', 'react'] }, files: ['package.json'] });
  assert.equal(f.id, 'nextjs');
  assert.equal(f.deployable, true);
  assert.equal(f.via, 'dependencies');
});

test('a config file identifies it when dependencies do not', () => {
  const f = frameworkFor({ pkg: { dependencies: [] }, files: ['package.json', 'astro.config.mjs'] });
  assert.equal(f.id, 'astro');
  assert.equal(f.via, 'config file');
});

test('a project with no package.json is still recognised', () => {
  assert.equal(frameworkFor({ files: ['go.mod'] }).id, 'go');
  assert.equal(frameworkFor({ files: ['requirements.txt'] }).id, 'python');
  assert.equal(frameworkFor({ files: ['manage.py'] }).id, 'python');
});

test('Cloudflare Workers is refused, whatever else it looks like', () => {
  const f = frameworkFor({
    pkg: { dependencies: ['react'], devDependencies: ['vite'] },
    files: ['package.json', 'wrangler.jsonc'],
  });
  assert.equal(f.id, 'workers');
  assert.equal(f.deployable, false);
  assert.match(f.reason, /wrangler/);
});

test('every wrangler spelling is caught', () => {
  for (const f of ['wrangler.toml', 'wrangler.json', 'wrangler.jsonc']) {
    assert.equal(frameworkFor({ files: ['package.json', f] }).deployable, false, f);
  }
});

test('a provider-built project is refused too', () => {
  assert.equal(frameworkFor({ files: ['package.json', 'vercel.json'] }).deployable, false);
  assert.equal(frameworkFor({ files: ['package.json', 'netlify.toml'] }).deployable, false);
});

test('an unremarkable node project falls back to node', () => {
  const f = frameworkFor({ pkg: { dependencies: ['lodash'] }, files: ['package.json'] });
  assert.equal(f.id, 'node');
  assert.equal(f.deployable, true);
});

test('nothing recognisable is null, not a guess', () => {
  assert.equal(frameworkFor({ files: ['README.md'] }), null);
  assert.equal(frameworkFor(), null);
});
