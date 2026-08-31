import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { eq } from 'drizzle-orm';
import { db, schema, DATA_DIR } from './index.js';

const KEY_FILE = path.join(DATA_DIR, 'secret.key');

function secretKey() {
  if (process.env.PM2D_SECRET_KEY) {
    return crypto.createHash('sha256').update(process.env.PM2D_SECRET_KEY).digest();
  }
  if (!fs.existsSync(KEY_FILE)) {
    fs.writeFileSync(KEY_FILE, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  }
  return crypto.createHash('sha256').update(fs.readFileSync(KEY_FILE, 'utf8').trim()).digest();
}

let keyCache = null;
const key = () => (keyCache ??= secretKey());

export function encrypt(plain) {
  if (plain == null || plain === '') return '';
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return `v1:${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${enc.toString('base64')}`;
}

export function decrypt(blob) {
  if (!blob) return '';
  if (!String(blob).startsWith('v1:')) return String(blob);
  try {
    const [, ivB, tagB, dataB] = String(blob).split(':');
    const d = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(ivB, 'base64'));
    d.setAuthTag(Buffer.from(tagB, 'base64'));
    return Buffer.concat([d.update(Buffer.from(dataB, 'base64')), d.final()]).toString('utf8');
  } catch {
    return '';
  }
}

const DEFAULTS = {
  projectsDir: process.env.PM2D_PROJECTS_DIR || path.join(os.homedir(), 'projects'),
  githubToken: '',
  githubUser: '',
  cloudflareToken: '',
  cloudflareAccountId: '',
  watchedDomains: [],
  theme: 'dark',
};

export const SECRET_KEYS = new Set(['githubToken', 'cloudflareToken']);

let cache = null;

export async function loadSettings() {
  if (cache) return cache;
  const rows = await db.select().from(schema.settings);
  const out = { ...DEFAULTS };
  for (const row of rows) {
    let value;
    try {
      value = row.value == null ? null : JSON.parse(row.value);
    } catch {
      value = row.value;
    }
    out[row.key] = row.encrypted ? decrypt(value) : value;
  }
  cache = out;
  return out;
}

export function settings() {
  if (!cache) throw new Error('Settings not loaded. loadSettings() must run during boot.');
  return cache;
}

export async function setSetting(key2, value) {
  const isSecret = SECRET_KEYS.has(key2);
  const stored = JSON.stringify(isSecret ? encrypt(value) : value);
  await db
    .insert(schema.settings)
    .values({ key: key2, value: stored, encrypted: isSecret, updatedAt: Date.now() })
    .onConflictDoUpdate({
      target: schema.settings.key,
      set: { value: stored, encrypted: isSecret, updatedAt: Date.now() },
    });
  if (cache) cache[key2] = value;
  return value;
}

export async function publicSettings() {
  const s = await loadSettings();
  return {
    projectsDir: s.projectsDir,
    githubUser: s.githubUser,
    hasGithubToken: !!s.githubToken,
    hasCloudflareToken: !!s.cloudflareToken,
    cloudflareTokenTail: s.cloudflareToken ? s.cloudflareToken.slice(-4) : null,
    cloudflareAccountId: s.cloudflareAccountId,
    watchedDomains: Array.isArray(s.watchedDomains) ? s.watchedDomains : [],
    theme: s.theme,
  };
}

export async function ensureProjectsDir() {
  const dir = (await loadSettings()).projectsDir;
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (err) {
    console.error('[settings] could not create projects dir:', err.message);
  }
  return dir;
}
