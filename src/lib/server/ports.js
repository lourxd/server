import net from 'node:net';
import si from 'systeminformation';
import * as pm2 from './pm2.js';

const HOSTS = ['0.0.0.0', '127.0.0.1'];

function tryBind(port, host) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', (err) => resolve(err.code || 'EADDRINUSE'));
    server.once('listening', () => server.close(() => resolve(null)));
    try {
      server.listen({ port, host, exclusive: true });
    } catch {
      resolve('EADDRINUSE');
    }
  });
}

async function holder(port) {
  const conns = await si.networkConnections().catch(() => []);
  const match = (conns || []).find((c) => c.state === 'LISTEN' && Number(c.localPort) === port);
  if (!match) return null;

  let app = null;
  if (match.pid) {
    const list = await pm2.list().catch(() => []);
    const found = list.find((a) => a.pid === match.pid);
    if (found) app = { name: found.name, pmId: found.pmId, status: found.status };
  }
  return { pid: match.pid || null, process: match.process || '', address: match.localAddress, app };
}

export async function checkPort(port) {
  const n = Number(port);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    return { port, valid: false, free: false, reason: 'Not a valid port number.' };
  }
  if (n < 1024) {
    return {
      port: n,
      valid: true,
      free: false,
      privileged: true,
      reason: `Port ${n} is privileged — a process running as your user cannot bind it.`,
    };
  }

  let blocked = null;
  for (const host of HOSTS) {
    const code = await tryBind(n, host);
    if (code === 'EADDRINUSE' || code === 'EACCES') {
      blocked = code;
      break;
    }
  }
  if (!blocked) return { port: n, valid: true, free: true };

  const held = await holder(n);
  return {
    port: n,
    valid: true,
    free: false,
    code: blocked,
    holder: held,
    reason: held?.app
      ? `Port ${n} is already used by your app "${held.app.name}".`
      : held?.process
        ? `Port ${n} is already used by ${held.process} (pid ${held.pid}).`
        : `Port ${n} is already in use.`,
  };
}
