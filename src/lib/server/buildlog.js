import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './store/index.js';

const DIR = path.join(DATA_DIR, 'build-logs');
const MAX_BYTES = 512 * 1024;

const safeName = (name) =>
  String(name ?? '')
    .replace(/[^A-Za-z0-9._@-]/g, '_')
    .replace(/^[.]+/, '')
    .slice(0, 96);

function fileFor(name) {
  const clean = safeName(name);
  if (!clean) return null;
  return path.join(DIR, `${clean}.log`);
}

export function startBuildLog(name, header) {
  const file = fileFor(name);
  if (!file) return null;
  fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, `${new Date().toISOString()} ${header}\n`, { mode: 0o600 });
  return file;
}

export function appendBuildLog(file, line) {
  if (!file) return;
  try {
    if (fs.statSync(file).size > MAX_BYTES) return;
    fs.appendFileSync(file, `${line}\n`);
  } catch {
  }
}

export function readBuildLog(name) {
  const file = fileFor(name);
  if (!file || !fs.existsSync(file)) return { exists: false, lines: [] };
  const text = fs.readFileSync(file, 'utf8');
  return {
    exists: true,
    at: fs.statSync(file).mtimeMs,
    lines: text.split('\n').filter(Boolean).map((line) => ({
      stream: /error|failed|ERR!|✗/i.test(line) ? 'err' : 'out',
      line,
    })),
  };
}

export function clearBuildLog(name) {
  const file = fileFor(name);
  if (file) fs.rmSync(file, { force: true });
}
