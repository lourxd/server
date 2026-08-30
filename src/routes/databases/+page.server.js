import { listConnections, detectLocalEngines } from '$srv/db/index.js';
import { ENGINES, isRemote } from '$srv/db/provision.js';

export async function load() {
  const [connections, engines] = await Promise.all([
    listConnections(),
    detectLocalEngines().catch(() => []),
  ]);
  return {
    connections: connections.map((c) => ({ ...c, remote: isRemote(c) })),
    engines,
    catalogue: ENGINES,
  };
}
