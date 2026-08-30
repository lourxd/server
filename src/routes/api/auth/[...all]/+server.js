import { auth } from '$srv/auth.js';

function withClientIp(event) {
  const headers = new Headers(event.request.headers);
  headers.set('x-scp-client-ip', event.getClientAddress());
  return new Request(event.request, { headers, duplex: 'half' });
}

export const GET = (event) => auth.handler(withClientIp(event));
export const POST = (event) => auth.handler(withClientIp(event));
