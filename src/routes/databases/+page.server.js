import { listConnections, detectLocalEngines } from '$srv/db/index.js';
import { ENGINES } from '$srv/db/provision.js';

export async function load() {
  const [connections, engines] = await Promise.all([
    listConnections(),
    detectLocalEngines().catch(() => []),
  ]);
  return { connections, engines, catalogue: ENGINES };
}
