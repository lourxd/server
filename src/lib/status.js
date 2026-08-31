const STATES = {
  online: { label: 'online', tone: 'ok' },
  healthy: { label: 'healthy', tone: 'ok' },
  active: { label: 'active', tone: 'ok' },
  streaming: { label: 'streaming', tone: 'ok' },
  launching: { label: 'starting', tone: 'warn', busy: true },
  stopping: { label: 'stopping', tone: 'warn', busy: true },
  'waiting restart': { label: 'restarting', tone: 'warn', busy: true },
  'one-launch-status': { label: 'ran once', tone: 'idle' },
  stopped: { label: 'stopped', tone: 'idle' },
  errored: { label: 'errored', tone: 'bad' },
  error: { label: 'error', tone: 'bad' },
};

const ACTIVITIES = {
  building: { label: 'building', tone: 'info', busy: true },
  deploying: { label: 'deploying', tone: 'info', busy: true },
  installing: { label: 'installing', tone: 'info', busy: true },
};

export function describeStatus(status, activity) {
  if (activity && ACTIVITIES[activity.kind]) {
    return { ...ACTIVITIES[activity.kind], key: activity.kind, raw: status };
  }
  const state = STATES[status] ?? { label: status ?? 'unknown', tone: 'idle' };
  return { ...state, key: status, raw: status };
}

export const TONE_CLASS = {
  ok: 'bg-ok/14 text-ok',
  warn: 'bg-warn/15 text-warn',
  bad: 'bg-bad/16 text-bad',
  info: 'bg-info/15 text-info',
  idle: 'bg-foreground/7 text-idle',
};
