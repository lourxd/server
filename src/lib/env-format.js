export const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

const SECRET_HINT =
  /(SECRET|TOKEN|KEY|PASSWORD|PASSWD|CREDENTIAL|PRIVATE|DSN|AUTH|SALT|CERT|SIGNING|API_?KEY|CONNECTION_?STRING|_URL$)/i;

const NEVER_SECRET = /^(NODE_ENV|PORT|HOST|HOSTNAME|TZ|LANG|PATH|BASE_URL|PUBLIC_URL|NEXT_PUBLIC_.*)$/i;

export function looksSecret(key) {
  if (!key || NEVER_SECRET.test(key)) return false;
  return SECRET_HINT.test(key);
}

export function unquote(raw) {
  const value = String(raw ?? '').trim();
  if (value.length > 1 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\(["\\$`])/g, '$1');
  }
  if (value.length > 1 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1);
  }
  return value;
}

export function parseEnvText(text) {
  const rows = [];
  const seen = new Map();

  for (const raw of String(text ?? '').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;

    const eq = line.indexOf('=');
    if (eq < 1) continue;

    const key = line
      .slice(0, eq)
      .replace(/^export\s+/i, '')
      .trim();
    if (!key) continue;

    const row = {
      key,
      value: unquote(line.slice(eq + 1)),
      secret: looksSecret(key),
      valid: ENV_KEY_RE.test(key),
    };

    if (seen.has(key)) {
      rows[seen.get(key)] = row;
      continue;
    }
    seen.set(key, rows.length);
    rows.push(row);
  }
  return rows;
}

export function mergeEnvRows(current, incoming) {
  const keys = new Set(incoming.map((r) => r.key));
  return [...current.filter((v) => !keys.has(v.key)), ...incoming];
}
