import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEnvText, looksSecret, unquote } from '../src/lib/env-format.js';

test('parses a pasted .env the way people actually paste it', () => {
  const rows = parseEnvText(`
# database
export DATABASE_URL="postgres://u:p@host/db?sslmode=require"

PORT=3000
  STRIPE_SECRET_KEY = sk_live_abc123
EMPTY=
`);
  assert.deepEqual(rows.map((r) => r.key), ['DATABASE_URL', 'PORT', 'STRIPE_SECRET_KEY', 'EMPTY']);
  assert.equal(rows[0].value, 'postgres://u:p@host/db?sslmode=require');
  assert.equal(rows[2].value, 'sk_live_abc123');
  assert.equal(rows[3].value, '');
});

test('a later line wins over an earlier one, keeping its position', () => {
  const rows = parseEnvText('A=1\nB=2\nA=3');
  assert.deepEqual(rows.map((r) => [r.key, r.value]), [['A', '3'], ['B', '2']]);
});

test('a value keeps every = after the first', () => {
  assert.equal(parseEnvText('TOKEN=a=b==')[0].value, 'a=b==');
});

test('an unusable name is kept but flagged rather than silently dropped', () => {
  const rows = parseEnvText('2BAD=x\nGOOD=y');
  assert.equal(rows[0].valid, false);
  assert.equal(rows[1].valid, true);
});

test('credentials are guessed as secret, plain config is not', () => {
  for (const k of ['DATABASE_URL', 'STRIPE_SECRET_KEY', 'API_TOKEN', 'JWT_SIGNING_KEY', 'DB_PASSWORD']) {
    assert.equal(looksSecret(k), true, `${k} should be secret`);
  }
  for (const k of ['NODE_ENV', 'PORT', 'HOST', 'NEXT_PUBLIC_SITE_URL', 'TZ']) {
    assert.equal(looksSecret(k), false, `${k} should not be secret`);
  }
});

test('unquote handles the three shapes a .env uses', () => {
  assert.equal(unquote('plain'), 'plain');
  assert.equal(unquote('"two words"'), 'two words');
  assert.equal(unquote("'single'"), 'single');
  assert.equal(unquote('"a\\"b"'), 'a"b');
  assert.equal(unquote('"pa\\$\\$"'), 'pa$$');
});

test('nothing in, nothing out', () => {
  assert.deepEqual(parseEnvText(''), []);
  assert.deepEqual(parseEnvText(null), []);
  assert.deepEqual(parseEnvText('# only a comment\n\n'), []);
});
