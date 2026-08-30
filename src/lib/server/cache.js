const entries = new Map();

export async function cached(key, ttlMs, produce) {
  const hit = entries.get(key);
  const now = Date.now();

  if (hit && hit.expires > now) return hit.value;
  if (hit?.pending) return hit.pending;

  const pending = produce()
    .then((value) => {
      entries.set(key, { value, expires: Date.now() + ttlMs });
      return value;
    })
    .catch((err) => {
      entries.delete(key);
      if (hit && 'value' in hit) return hit.value;
      throw err;
    });

  entries.set(key, { ...hit, pending });
  return pending;
}

export function invalidate(prefix = '') {
  if (!prefix) return entries.clear();
  for (const key of entries.keys()) if (key.startsWith(prefix)) entries.delete(key);
}
