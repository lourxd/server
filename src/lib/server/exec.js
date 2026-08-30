import { spawn } from 'node:child_process';
import path from 'node:path';

const NODE_BIN_DIR = path.dirname(process.execPath);

function withNodeOnPath(pathValue) {
  const parts = (pathValue || '').split(path.delimiter).filter(Boolean);
  if (parts.includes(NODE_BIN_DIR)) return pathValue;
  return [NODE_BIN_DIR, ...parts].join(path.delimiter);
}

function childEnv(env) {
  const merged = { ...process.env, ...env };
  for (const [key, value] of Object.entries(merged)) {
    if (value == null) delete merged[key];
  }
  merged.PATH = withNodeOnPath(merged.PATH);
  return merged;
}

export function run(cmd, args = [], opts = {}) {
  const { cwd, env, timeout = 120_000, input, maxBuffer = 8 * 1024 * 1024 } = opts;
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, args, { cwd, env: childEnv(env), shell: false });
    } catch (err) {
      return resolve({ ok: false, code: -1, stdout: '', stderr: err.message, cmd: `${cmd} ${args.join(' ')}` });
    }
    let stdout = '', stderr = '', killed = false, truncated = false;
    const timer = setTimeout(() => { killed = true; child.kill('SIGKILL'); }, timeout);

    child.stdout.on('data', (d) => {
      if (stdout.length < maxBuffer) stdout += d.toString(); else truncated = true;
    });
    child.stderr.on('data', (d) => {
      if (stderr.length < maxBuffer) stderr += d.toString(); else truncated = true;
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ ok: false, code: -1, stdout, stderr: stderr + err.message, cmd: `${cmd} ${args.join(' ')}` });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        ok: code === 0 && !killed,
        code: killed ? 124 : code,
        stdout: stdout.trim(),
        stderr: (killed ? `timed out after ${timeout}ms\n` : '') + stderr.trim(),
        truncated,
        cmd: `${cmd} ${args.join(' ')}`,
      });
    });
    if (input != null) { child.stdin.write(input); }
    child.stdin.end();
  });
}

export function runStreaming(cmd, args = [], opts = {}, onLine = () => {}) {
  const { cwd, env, timeout = 600_000 } = opts;
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, args, { cwd, env: childEnv(env), shell: false });
    } catch (err) {
      onLine({ stream: 'err', line: err.message });
      return resolve({ ok: false, code: -1 });
    }
    let killed = false;
    const timer = setTimeout(() => { killed = true; child.kill('SIGKILL'); }, timeout);
    const lastFrame = (line) => (line.includes('\r') ? line.slice(line.lastIndexOf('\r') + 1) : line);

    const wire = (streamName, stream) => {
      let buf = '';
      stream.on('data', (d) => {
        buf += d.toString();
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const line of lines) onLine({ stream: streamName, line: lastFrame(line) });
      });
      stream.on('end', () => { if (buf) onLine({ stream: streamName, line: lastFrame(buf) }); });
    };
    wire('out', child.stdout);
    wire('err', child.stderr);
    child.on('error', (err) => { clearTimeout(timer); onLine({ stream: 'err', line: err.message }); resolve({ ok: false, code: -1 }); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (killed) onLine({ stream: 'err', line: `timed out after ${timeout}ms` });
      resolve({ ok: code === 0 && !killed, code: killed ? 124 : code });
    });
    child.stdin.end();
  });
}
