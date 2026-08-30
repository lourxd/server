import { listConnections, detectLocalEngines, DRIVER_META } from '$srv/db/index.js';

export async function load() {
  const [connections, engines] = await Promise.all([listConnections(), detectLocalEngines()]);
  return { connections, engines, drivers: DRIVER_META };
}
