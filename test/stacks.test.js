import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STACKS, STACK_BY_ID, detectStack } from '../src/lib/stacks.js';

test('every stack is complete and internally consistent', () => {
  for (const s of STACKS) {
    assert.ok(s.id && s.name && s.logo && s.summary, `${s.id} is missing a field`);
    assert.ok(s.defaults, `${s.id} has no defaults`);
    if (s.serve) {
      assert.ok(s.serve.dir, `${s.id} serves but names no directory`);
    } else {
      assert.ok(s.defaults.script, `${s.id} runs but names no script`);
    }
  }
});

test('stack ids are unique', () => {
  assert.equal(new Set(STACKS.map((s) => s.id)).size, STACKS.length);
});

test('a stack that declares a build output also declares proof of a finished build', () => {
  for (const s of STACKS) {
    if (!s.defaults.buildOutput) continue;
    assert.ok(s.defaults.build, `${s.id} has an output but no build command`);
    assert.ok(s.defaults.buildMarker, `${s.id} needs a marker, or a half-written directory passes`);
    assert.ok(
      s.defaults.buildMarker.startsWith(s.defaults.buildOutput),
      `${s.id}: the marker must live inside the output directory`,
    );
  }
});

test('no stack supervises a package manager', () => {
  for (const s of STACKS) {
    assert.ok(
      !/^(npm|npx|yarn|pnpm|bun)$/.test(s.defaults.script ?? ''),
      `${s.id} would supervise a package manager rather than the app`,
    );
  }
});

test('detectStack reads the shape repos.js produces', () => {
  assert.equal(detectStack({ dependencies: ['next', 'react'] }), 'nextjs');
  assert.equal(detectStack({ dependencies: [], devDependencies: ['@sveltejs/kit'] }), 'sveltekit');
  assert.equal(detectStack({ dependencies: [] }), null);
});

test('detectStack also reads a raw package.json', () => {
  assert.equal(detectStack({ dependencies: { next: '15' } }), 'nextjs');
  assert.equal(detectStack({ devDependencies: { '@sveltejs/kit': '2' } }), 'sveltekit');
});

test('detectStack copes with nothing', () => {
  assert.equal(detectStack(null), null);
  assert.equal(detectStack({}), null);
});

test('STACK_BY_ID covers every stack', () => {
  for (const s of STACKS) assert.equal(STACK_BY_ID[s.id], s);
});
