import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  splitEnv,
  envFileBody,
  parseEnvFile,
  readEnvFile,
  writeEnvFile,
  declaredKeys,
} from '../src/lib/server/appenv.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'scp-env-'));

test('splitEnv separates plain from secret', () => {
  const { plain, secret } = splitEnv([
    { key: 'PORT', value: '3000', secret: false },
    { key: 'DATABASE_URL', value: 'postgres://x', secret: true },
  ]);
  assert.deepEqual(plain, { PORT: '3000' });
  assert.deepEqual(secret, { DATABASE_URL: 'postgres://x' });
});

test('splitEnv keeps a stored secret when the row comes back empty', () => {
  const { secret } = splitEnv([{ key: 'API_KEY', value: '', secret: true }], { API_KEY: 'kept' });
  assert.equal(secret.API_KEY, 'kept');
});

test('splitEnv replaces a stored secret when a new value is typed', () => {
  const { secret } = splitEnv([{ key: 'API_KEY', value: 'fresh', secret: true }], { API_KEY: 'old' });
  assert.equal(secret.API_KEY, 'fresh');
});

test('splitEnv clears a secret that has no stored value', () => {
  const { secret } = splitEnv([{ key: 'API_KEY', value: '', secret: true }], {});
  assert.equal(secret.API_KEY, '');
});

test('splitEnv rejects an invalid name', () => {
  assert.throws(() => splitEnv([{ key: '2BAD', value: 'x' }]), /Invalid environment variable name/);
  assert.throws(() => splitEnv([{ key: 'has space', value: 'x' }]), /Invalid environment variable name/);
});

test('splitEnv ignores blank keys and non-arrays', () => {
  assert.deepEqual(splitEnv([{ key: '  ', value: 'x' }]).plain, {});
  assert.deepEqual(splitEnv(null), { plain: {}, secret: {} });
});

test('envFileBody quotes only what needs it', () => {
  assert.equal(envFileBody({ A: 'plain' }), 'A=plain\n');
  assert.equal(envFileBody({ A: 'has space' }), 'A="has space"\n');
  assert.equal(envFileBody({ A: 'a"b' }), 'A="a\\"b"\n');
  assert.equal(envFileBody({ A: 'a$b' }), 'A="a\\$b"\n');
});

test('envFileBody refuses a value with a line break', () => {
  assert.throws(() => envFileBody({ KEY: 'a\nb' }), /line break/);
});

test('envFileBody of nothing is empty, not a stray newline', () => {
  assert.equal(envFileBody({}), '');
});

test('parseEnvFile round-trips what envFileBody writes', () => {
  const vars = {
    SIMPLE: 'value',
    SPACED: 'two words',
    QUOTED: 'a"b',
    DOLLAR: 'pa$$word',
    URL: 'postgres://u:p@host:5432/db?sslmode=require',
  };
  assert.deepEqual(parseEnvFile(envFileBody(vars)), vars);
});

test('parseEnvFile skips comments and blanks, and strips export', () => {
  const parsed = parseEnvFile('# note\n\nexport A=1\nB=2\nnot-a-pair\n');
  assert.deepEqual(parsed, { A: '1', B: '2' });
});

test('parseEnvFile keeps = inside a value', () => {
  assert.deepEqual(parseEnvFile('TOKEN=abc=def=='), { TOKEN: 'abc=def==' });
});

test('writeEnvFile creates the file 0600 and readEnvFile reads it back', () => {
  const dir = tmp();
  const file = writeEnvFile(dir, { DATABASE_URL: 'postgres://u:p@h/db' });
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.deepEqual(readEnvFile(dir), { DATABASE_URL: 'postgres://u:p@h/db' });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('writeEnvFile removes the file when nothing is left', () => {
  const dir = tmp();
  writeEnvFile(dir, { A: '1' });
  assert.equal(writeEnvFile(dir, {}), null);
  assert.equal(fs.existsSync(path.join(dir, '.env')), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('readEnvFile of a directory with no .env is empty', () => {
  const dir = tmp();
  assert.deepEqual(readEnvFile(dir), {});
  fs.rmSync(dir, { recursive: true, force: true });
});

test('declaredKeys omits every panel marker', () => {
  const keys = declaredKeys({ PORT: '1', NODE_ENV: 'production', SCP_DB: 'x', SCP_STACK: 'nextjs' });
  assert.equal(keys, 'PORT,NODE_ENV');
});

test('a secret on disk stays a secret, whatever the client sends', () => {
  const onDisk = { DATABASE_URL: 'postgres://u:p@neon.tech/db' };
  const { plain, secret } = splitEnv(
    [{ key: 'DATABASE_URL', value: '', secret: false, stored: true }],
    onDisk,
  );
  assert.deepEqual(plain, {}, 'it must not reach PM2');
  assert.equal(secret.DATABASE_URL, 'postgres://u:p@neon.tech/db', 'and must keep its value');
});

test('dropping a secret row removes it from .env entirely', () => {
  const { plain, secret } = splitEnv([{ key: 'PORT', value: '3000', secret: false }], { OLD: 'gone' });
  assert.deepEqual(plain, { PORT: '3000' });
  assert.deepEqual(secret, {}, 'a row that is not sent is not written back');
});

test('keying a plain value moves it into .env with its value intact', () => {
  const { plain, secret } = splitEnv([{ key: 'API_KEY', value: 'live-value', secret: true }], {});
  assert.deepEqual(plain, {});
  assert.equal(secret.API_KEY, 'live-value');
});

test('an empty plain row that was never stored stays empty', () => {
  const { plain } = splitEnv([{ key: 'OPTIONAL', value: '', secret: false }], { OTHER: 'x' });
  assert.equal(plain.OPTIONAL, '');
});

test('a stored secret left alone survives a save', () => {
  const onDisk = { TOKEN: 'kept' };
  const { secret } = splitEnv([{ key: 'TOKEN', value: '', secret: true, stored: true }], onDisk);
  assert.equal(secret.TOKEN, 'kept');
});
