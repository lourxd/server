import fs from 'node:fs/promises';
import { run } from './exec.js';
import * as pm2 from './pm2.js';

const TS = /^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?)/;

function timestampOf(line) {
  const match = TS.exec(line);
  if (!match) return null;
  const parsed = Date.parse(match[1].replace(' ', 'T'));
  return Number.isNaN(parsed) ? null : parsed;
}

async function readTail(path, stream, lines, meta) {
  try {
    await fs.access(path);
  } catch {
    return [];
  }
  const res = await run('tail', ['-n', String(lines), path], { timeout: 10_000 });
  if (!res.ok) return [];

  return res.stdout
    .split('\n')
    .filter((l) => l.length)
    .map((line, index) => ({ ...meta, stream, line, at: timestampOf(line), index }));
}

export async function tail(idOrName, lines = 200) {
  const proc = await pm2.describe(idOrName);
  const capped = Math.min(Math.max(lines, 1), 5000);
  const meta = { name: proc.name, pmId: proc.pmId };

  const [out, err] = await Promise.all([
    proc.outLog ? readTail(proc.outLog, 'out', capped, meta) : [],
    proc.errLog ? readTail(proc.errLog, 'err', capped, meta) : [],
  ]);

  for (const group of [out, err]) {
    let last = 0;
    for (const entry of group) {
      if (entry.at == null) entry.at = last;
      else last = entry.at;
    }
  }

  const merged = [...out, ...err].sort((a, b) => a.at - b.at || a.index - b.index);

  return {
    process: {
      name: proc.name,
      pmId: proc.pmId,
      status: proc.status,
      outLog: proc.outLog,
      errLog: proc.errLog,
    },
    lines: merged.slice(-capped).map(({ index, ...line }) => line),
  };
}

export async function daemonLog(lines = 200) {
  const path = `${process.env.PM2_HOME || `${process.env.HOME}/.pm2`}/pm2.log`;
  const res = await run('tail', ['-n', String(Math.min(lines, 2000)), path], { timeout: 10_000 });
  return res.ok ? res.stdout.split('\n').filter(Boolean) : [`Could not read ${path}: ${res.stderr}`];
}
