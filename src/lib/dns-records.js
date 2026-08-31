export const RECORD_TYPES = ['A', 'AAAA', 'CNAME', 'TXT', 'MX', 'NS', 'SRV', 'CAA'];

const PROXYABLE = new Set(['A', 'AAAA', 'CNAME']);

export function isProxyable(type) {
  return PROXYABLE.has(type);
}
