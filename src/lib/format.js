export function bytes(n, digits = 1) {
  if (n == null || Number.isNaN(n)) return '—';
  if (n === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.min(Math.floor(Math.log(Math.abs(n)) / Math.log(1024)), units.length - 1);
  const v = n / 1024 ** i;
  return `${v.toFixed(i === 0 ? 0 : digits)} ${units[i]}`;
}

export function duration(ms) {
  if (!ms || ms < 0) return '—';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${sec}s`;
  return `${sec}s`;
}

export function relTime(input) {
  if (!input) return '—';
  const then = typeof input === 'number' ? input : Date.parse(input);
  if (Number.isNaN(then)) return '—';
  const diff = Date.now() - then;
  const abs = Math.abs(diff);
  const units = [
    [86400000 * 365, 'y'],
    [86400000 * 30, 'mo'],
    [86400000, 'd'],
    [3600000, 'h'],
    [60000, 'm'],
    [1000, 's'],
  ];
  for (const [span, label] of units) {
    if (abs >= span) return `${Math.floor(abs / span)}${label}${diff < 0 ? ' from now' : ' ago'}`;
  }
  return 'just now';
}

export function num(n) {
  if (n == null) return '—';
  return Number(n).toLocaleString();
}

export function pct(n, digits = 1) {
  if (n == null) return '—';
  return `${Number(n).toFixed(digits)}%`;
}

export function cell(v) {
  if (v === null) return 'NULL';
  if (v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}
