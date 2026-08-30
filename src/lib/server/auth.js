import { betterAuth } from 'better-auth';
import { admin as adminPlugin } from 'better-auth/plugins/admin';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { getMigrations } from 'better-auth/db/migration';
import { getRequestEvent } from '$app/server';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { sqlite as db, DATA_DIR } from './store/index.js';
import { settings } from './store/settings.js';

const SECRET_FILE = path.join(DATA_DIR, 'auth.secret');

function authSecret() {
  if (process.env.BETTER_AUTH_SECRET) return process.env.BETTER_AUTH_SECRET;
  if (!fs.existsSync(SECRET_FILE)) {
    fs.writeFileSync(SECRET_FILE, crypto.randomBytes(32).toString('base64url'), { mode: 0o600 });
  }
  return fs.readFileSync(SECRET_FILE, 'utf8').trim();
}

export function userCount() {
  try {
    return db.prepare('select count(*) as n from user').get().n;
  } catch {
    return 0;
  }
}

let setupComplete = false;
export function needsSetup() {
  if (setupComplete) return false;
  if (userCount() > 0) {
    setupComplete = true;
    return false;
  }
  return true;
}

export function allowsSignUp() {
  return !!settings().allowSignUp;
}

export const auth = betterAuth({
  appName: 'Server Control Panel',
  database: db,
  secret: authSecret(),
  baseURL: process.env.BETTER_AUTH_URL || { allowedHosts: ['*'], protocol: 'auto' },

  emailAndPassword: {
    enabled: true,
    minPasswordLength: 10,
    requireEmailVerification: false,
    autoSignIn: true,
  },

  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
    cookieCache: { enabled: true, maxAge: 60 },
  },

  account: {
    accountLinking: { enabled: false },
  },

  trustedOrigins: (request) => {
    const origin = request?.headers.get('origin');
    return origin ? [origin] : [];
  },

  rateLimit: {
    enabled: true,
    window: 60,
    max: 30,
    customRules: {
      '/sign-in/email': { window: 60, max: 8 },
      '/sign-up/email': { window: 300, max: 5 },
    },
  },

  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          if (userCount() === 0) return { data: { ...user, role: 'admin' } };
          if (!allowsSignUp()) {
            throw new Error('Sign-ups are disabled. An administrator must create your account.');
          }
          return { data: user };
        },
      },
    },
  },

  advanced: {
    cookiePrefix: 'scp',
    useSecureCookies: process.env.PM2D_SECURE_COOKIES === 'true',
    ipAddress: { ipAddressHeaders: ['x-scp-client-ip'] },
  },

  plugins: [adminPlugin(), sveltekitCookies(getRequestEvent)],
});

export async function runAuthMigrations() {
  const { runMigrations, toBeCreated, toBeAdded } = await getMigrations(auth.options);
  const pending = (toBeCreated?.length || 0) + (toBeAdded?.length || 0);
  if (pending === 0) return { migrated: false };
  await runMigrations();
  console.log(`[auth] applied schema migrations (${pending} change${pending === 1 ? '' : 's'})`);
  return { migrated: true, pending };
}

export async function getSession(event) {
  try {
    return await auth.api.getSession({ headers: event.request.headers });
  } catch (err) {
    console.error('[auth] getSession failed:', err.message);
    return null;
  }
}

export async function listUsers(headers) {
  try {
    const res = await auth.api.listUsers({ headers, query: { limit: 200, sortBy: 'createdAt' } });
    return (res?.users ?? []).map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role ?? 'user',
      banned: !!u.banned,
      createdAt: u.createdAt,
      emailVerified: u.emailVerified,
    }));
  } catch (err) {
    if (err?.status !== 'FORBIDDEN' && err?.statusCode !== 403) {
      console.error('[auth] listUsers failed:', err.message);
    }
    return [];
  }
}

export function activeSessionCount() {
  try {
    const row = db.prepare('select count(*) as n from session where expiresAt > ?').get(Date.now());
    return Number(row?.n ?? 0);
  } catch {
    return 0;
  }
}
