export function serviceUrl(port) {
  return port ? `http://localhost:${port}` : null;
}

export function servesPort(service, port) {
  if (!service || !port) return false;
  const match = String(service).match(/^[a-z]+:\/\/([^/]+)/i);
  if (!match) return false;
  const [host, hostPort] = match[1].split(':');
  return (
    hostPort === String(port) && ['localhost', '127.0.0.1', '0.0.0.0', '[::1]'].includes(host)
  );
}

export function routesForPort(tunnels, port) {
  if (!port) return [];
  return (tunnels ?? []).flatMap((tunnel) =>
    (tunnel.routes ?? [])
      .filter((route) => servesPort(route.service, port))
      .map((route) => ({ ...route, tunnel })),
  );
}
