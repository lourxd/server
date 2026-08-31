import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeEnv, appEnv, ENV_KEYS_VAR } from '../src/lib/server/pm2.js';

test('sanitizeEnv strips the control variables that made PM2 relaunch the panel', () => {
  const out = sanitizeEnv({
    PORT: '3000',
    pm_exec_path: '/opt/panel/build/index.js',
    pm_cwd: '/opt/panel',
    pm_id: '0',
    name: 'control-panel',
    status: 'online',
    instances: '1',
    exec_mode: 'fork',
  });
  assert.deepEqual(out, { PORT: '3000' });
});

test('sanitizeEnv keeps PM2_SERVE_*, which configures the static server', () => {
  const out = sanitizeEnv({ PM2_SERVE_PATH: '/srv/dist', PM2_HOME: '/home/x/.pm2' });
  assert.equal(out.PM2_SERVE_PATH, '/srv/dist');
  assert.equal(out.PM2_HOME, undefined);
});

test('sanitizeEnv returns undefined rather than an empty object', () => {
  assert.equal(sanitizeEnv({}), undefined);
  assert.equal(sanitizeEnv({ pm_id: '1' }), undefined);
  assert.equal(sanitizeEnv(null), undefined);
});

test('appEnv returns exactly the declared keys', () => {
  const out = appEnv({
    [ENV_KEYS_VAR]: 'PORT,NODE_ENV',
    PORT: '3000',
    NODE_ENV: 'production',
    SSH_AUTH_SOCK: '/run/x',
    SOMETHING_ELSE: 'y',
  });
  assert.deepEqual(out, { PORT: '3000', NODE_ENV: 'production' });
});

test('appEnv never surfaces a panel marker, even if declared', () => {
  const out = appEnv({
    [ENV_KEYS_VAR]: 'PORT,SCP_DB,SCP_DB_VAR',
    PORT: '3000',
    SCP_DB: 'id',
    SCP_DB_VAR: 'DATABASE_URL',
  });
  assert.deepEqual(out, { PORT: '3000' });
});

test('appEnv drops a declared key that is no longer set', () => {
  assert.deepEqual(appEnv({ [ENV_KEYS_VAR]: 'PORT,GONE', PORT: '3000' }), { PORT: '3000' });
});

test('appEnv falls back to filtering the machine out', () => {
  const out = appEnv({
    PORT: '3000',
    NODE_ENV: 'production',
    HOST: '0.0.0.0',
    SSH_AUTH_SOCK: '/run/x',
    GPG_AGENT_INFO: 'y',
    MANAGERPIDFDID: '1',
    XDG_SESSION_TYPE: 'tty',
    PWD: '/home/x',
    PM2_HOME: '/home/x/.pm2',
    npm_config_x: '1',
    lowercase: 'ignored',
  });
  assert.deepEqual(out, { PORT: '3000', NODE_ENV: 'production', HOST: '0.0.0.0' });
});

test('appEnv copes with nothing', () => {
  assert.deepEqual(appEnv(undefined), {});
});
