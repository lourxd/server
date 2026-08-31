import { EventEmitter } from 'node:events';

const active = new Map();

export const activityBus = new EventEmitter();
activityBus.setMaxListeners(0);

export function snapshot() {
  return Object.fromEntries(active);
}

function publish() {
  activityBus.emit('change', snapshot());
}

export function begin(name, kind) {
  if (!name || !kind) return () => {};
  active.set(name, { kind, since: Date.now() });
  publish();

  let done = false;
  return () => {
    if (done) return;
    done = true;
    active.delete(name);
    publish();
  };
}

export function isBusy(name) {
  return active.has(name);
}
