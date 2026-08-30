import si from 'systeminformation';
import os from 'node:os';
import fs from 'node:fs';
import { cached } from './cache.js';

const LOOPBACK = /^lo\d*$/;

function dnsServers() {
  try {
    return fs
      .readFileSync('/etc/resolv.conf', 'utf8')
      .split('\n')
      .filter((l) => l.startsWith('nameserver'))
      .map((l) => l.split(/\s+/)[1])
      .filter(Boolean);
  } catch {
    return [];
  }
}

function addressing() {
  return cached('metrics:addressing', 60_000, async () => {
    const [list, gateway] = await Promise.all([
      si.networkInterfaces().catch(() => []),
      si.networkGatewayDefault().catch(() => null),
    ]);
    const ifaces = Array.isArray(list) ? list : [list];
    return {
      gateway: gateway || null,
      dns: dnsServers(),
      interfaces: ifaces
        .filter((i) => i && i.iface)
        .map((i) => ({
          iface: i.iface,
          ip4: i.ip4 || null,
          ip6: i.ip6 || null,
          mac: i.mac || null,
          mtu: i.mtu ?? null,
          speed: i.speed ?? null,
          type: i.type || null,
          dhcp: !!i.dhcp,
          internal: !!i.internal,
          isDefault: !!i.default,
        })),
    };
  });
}

const SCOPE = (addr) =>
  addr === '0.0.0.0' || addr === '::' || addr === '*'
    ? 'all'
    : /^(127\.|::1$)/.test(addr)
      ? 'local'
      : 'bound';

const HISTORY = 120;

export const history = {
  cpu: [],
  mem: [],
  netRx: [],
  netTx: [],
  diskRead: [],
  diskWrite: [],
  t: [],
};

let staticInfo = null;
let slowCache = { disks: [], processes: [], temperature: null, dockerContainers: [], updatedAt: 0 };
let lastFast = null;

function pushHistory(sample) {
  history.t.push(sample.at);
  history.cpu.push(round(sample.cpu.load));
  history.mem.push(round(sample.memory.usedPercent));
  history.netRx.push(sample.network.rxSec);
  history.netTx.push(sample.network.txSec);
  history.diskRead.push(sample.diskIO.readSec);
  history.diskWrite.push(sample.diskIO.writeSec);
  for (const key of Object.keys(history)) {
    if (history[key].length > HISTORY) history[key].shift();
  }
}

const round = (n, d = 1) => Math.round((Number(n) || 0) * 10 ** d) / 10 ** d;

export async function getStatic() {
  if (staticInfo) return staticInfo;
  const [cpu, osInfo, sys, versions] = await Promise.all([
    si.cpu(), si.osInfo(), si.system(), si.versions(),
  ]);
  staticInfo = {
    hostname: os.hostname(),
    platform: osInfo.platform,
    distro: `${osInfo.distro} ${osInfo.release}`.trim(),
    kernel: osInfo.kernel,
    arch: osInfo.arch,
    cpuModel: `${cpu.manufacturer} ${cpu.brand}`.trim(),
    cpuCores: cpu.cores,
    cpuPhysicalCores: cpu.physicalCores,
    cpuSpeedGhz: cpu.speed,
    totalMemory: os.totalmem(),
    manufacturer: sys.manufacturer,
    model: sys.model,
    virtual: sys.virtual,
    node: versions.node,
    npm: versions.npm,
    git: versions.git,
    docker: versions.docker || null,
  };
  return staticInfo;
}

export async function collectFast() {
  const [load, mem, net, disk] = await Promise.all([
    si.currentLoad(),
    si.mem(),
    si.networkStats('*').catch(() => []),
    si.disksIO().catch(() => null),
  ]);

  const external = (net || []).filter((n) => !LOOPBACK.test(n.iface));

  const netAgg = external.reduce((acc, n) => {
    acc.rxSec += Math.max(0, n.rx_sec || 0);
    acc.txSec += Math.max(0, n.tx_sec || 0);
    acc.rxTotal += n.rx_bytes || 0;
    acc.txTotal += n.tx_bytes || 0;
    return acc;
  }, { rxSec: 0, txSec: 0, rxTotal: 0, txTotal: 0 });

  const sample = {
    at: Date.now(),
    uptime: os.uptime(),
    cpu: {
      load: round(load.currentLoad),
      user: round(load.currentLoadUser),
      system: round(load.currentLoadSystem),
      idle: round(load.currentLoadIdle),
      cores: (load.cpus || []).map((c) => round(c.load)),
      loadavg: os.loadavg().map((n) => round(n, 2)),
    },
    memory: {
      total: mem.total,
      used: mem.active,
      free: mem.available,
      cached: mem.cached + mem.buffers,
      usedPercent: round((mem.active / mem.total) * 100),
      swapTotal: mem.swaptotal,
      swapUsed: mem.swapused,
      swapPercent: mem.swaptotal ? round((mem.swapused / mem.swaptotal) * 100) : 0,
    },
    network: {
      rxSec: Math.round(netAgg.rxSec),
      txSec: Math.round(netAgg.txSec),
      rxTotal: netAgg.rxTotal,
      txTotal: netAgg.txTotal,
      interfaces: (net || []).map((n) => ({
        iface: n.iface, rxSec: Math.round(Math.max(0, n.rx_sec || 0)),
        txSec: Math.round(Math.max(0, n.tx_sec || 0)),
        rxTotal: n.rx_bytes, txTotal: n.tx_bytes, state: n.operstate,
        rxErrors: n.rx_errors || 0, txErrors: n.tx_errors || 0,
        rxDropped: n.rx_dropped || 0, txDropped: n.tx_dropped || 0,
        loopback: LOOPBACK.test(n.iface),
      })),
    },
    diskIO: {
      readSec: Math.round(Math.max(0, disk?.rIO_sec || 0)),
      writeSec: Math.round(Math.max(0, disk?.wIO_sec || 0)),
    },
  };
  lastFast = sample;
  pushHistory(sample);
  return sample;
}

export async function collectSlow() {
  const [disks, procs, temp, conns, net] = await Promise.all([
    si.fsSize().catch(() => []),
    si.processes().catch(() => ({ list: [], all: 0, running: 0, sleeping: 0 })),
    si.cpuTemperature().catch(() => null),
    si.networkConnections().catch(() => []),
    addressing().catch(() => ({ gateway: null, dns: [], interfaces: [] })),
  ]);

  const seen = new Set();
  const listening = (conns || [])
    .filter((c) => c.state === 'LISTEN')
    .map((c) => ({
      protocol: c.protocol,
      address: c.localAddress,
      port: Number(c.localPort),
      scope: SCOPE(c.localAddress),
      pid: c.pid || null,
      process: c.process || '',
    }))
    .filter((c) => {
      const key = `${c.protocol}:${c.address}:${c.port}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.port - b.port || a.protocol.localeCompare(b.protocol));

  slowCache = {
    updatedAt: Date.now(),
    network: net,
    listening,
    disks: (disks || [])
      .filter((d) => d.size > 0 && !/^\/(snap|sys|proc|run)/.test(d.mount))
      .map((d) => ({
        fs: d.fs, mount: d.mount, type: d.type, size: d.size,
        used: d.used, available: d.available, usePercent: round(d.use),
      })),
    processCounts: { all: procs.all, running: procs.running, sleeping: procs.sleeping, blocked: procs.blocked },
    processes: (procs.list || [])
      .sort((a, b) => (b.cpu || 0) - (a.cpu || 0))
      .slice(0, 25)
      .map((p) => ({
        pid: p.pid, name: p.name, cpu: round(p.cpu), mem: round(p.mem),
        memRss: (p.memRss || 0) * 1024, user: p.user,
        started: p.started, state: p.state,
        command: (p.command || '').slice(0, 120),
        params: (p.params || '').slice(0, 160),
      })),
    temperature: temp && temp.main != null ? { main: round(temp.main), max: round(temp.max), cores: (temp.cores || []).map((c) => round(c)) } : null,
  };
  return slowCache;
}

export function snapshot() {
  return {
    at: Date.now(),
    fast: lastFast,
    slow: slowCache,
    history,
  };
}

export function start(fastMs = 2000, slowMs = 10000) {
  collectFast().catch((e) => console.error('[metrics] fast:', e.message));
  collectSlow().catch((e) => console.error('[metrics] slow:', e.message));
  const f = setInterval(() => collectFast().catch((e) => console.error('[metrics] fast:', e.message)), fastMs);
  const s = setInterval(() => collectSlow().catch((e) => console.error('[metrics] slow:', e.message)), slowMs);
  f.unref(); s.unref();
  return () => { clearInterval(f); clearInterval(s); };
}
