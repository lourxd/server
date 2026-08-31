const WORST = ['errored', 'stopped', 'stopping', 'launching', 'waiting restart', 'online'];

export function groupInstances(list) {
  const byName = new Map();

  for (const proc of list) {
    const found = byName.get(proc.name);
    if (!found) {
      byName.set(proc.name, { ...proc, instances: 1, pmIds: [proc.pmId] });
      continue;
    }
    found.instances += 1;
    found.pmIds.push(proc.pmId);
    found.cpu += proc.cpu ?? 0;
    found.memory += proc.memory ?? 0;
    found.restarts += proc.restarts ?? 0;
    found.uptime = Math.max(found.uptime ?? 0, proc.uptime ?? 0);
    if (WORST.indexOf(proc.status) < WORST.indexOf(found.status)) found.status = proc.status;
  }
  return [...byName.values()];
}
