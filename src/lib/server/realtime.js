import * as metrics from './metrics.js';
import * as pm2 from './pm2.js';
import { shutdownAll } from './db/index.js';
import { closeStore } from './store/index.js';
import { activityBus, snapshot as activitySnapshot } from './activity.js';

const clients = new Set();
let started = false;
let stopMetrics = null;

const recentEvents = [];
const MAX_EVENTS = 100;

function broadcast(event, data) {
  for (const c of clients) {
    if (c.closed) { clients.delete(c); continue; }
    try {
      c.send(event, data);
    } catch {
      clients.delete(c);
    }
  }
}

export function subscribe(client) {
  clients.add(client);
  return () => clients.delete(client);
}

export function getRecentEvents() {
  return recentEvents;
}

export function getActivity() {
  return activitySnapshot();
}

export function startRealtime({ intervalMs = 2000 } = {}) {
  if (started) return;
  started = true;

  stopMetrics = metrics.start(intervalMs, 10_000);

  pm2.connect().catch((err) => console.error('[realtime] pm2 connect failed:', err.message));

  pm2.bus.on('event', (e) => {
    recentEvents.unshift(e);
    if (recentEvents.length > MAX_EVENTS) recentEvents.pop();
    broadcast('pm2:event', e);
    pushApps().catch(() => {});
  });

  pm2.bus.on('log', (l) => broadcast('pm2:log', l));

  activityBus.on('change', (map) => broadcast('activity', map));

  const tick = setInterval(async () => {
    if (clients.size === 0) return;
    broadcast('metrics', metrics.snapshot());
    await pushApps().catch(() => {});
  }, intervalMs);
  tick.unref?.();

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;

    stopMetrics?.();
    clearInterval(tick);
    for (const c of clients) c.close?.();
    clients.clear();

    try {
      pm2.disconnect();
    } catch {
    }

    const bail = setTimeout(() => process.exit(0), 3000);
    bail.unref?.();

    try {
      await shutdownAll();
      closeStore();
    } catch (err) {
      console.error('[shutdown] cleanup failed:', err.message);
    }
    clearTimeout(bail);
    process.exit(0);
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

let lastAppsJson = '';
async function pushApps() {
  const list = await pm2.list();
  const json = JSON.stringify(list);
  if (json === lastAppsJson) return;
  lastAppsJson = json;
  broadcast('apps', list);
}
