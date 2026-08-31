import { browser } from '$app/environment';

class LiveState {
  connected = $state(false);
  metrics = $state(null);
  apps = $state([]);
  events = $state([]);
  activity = $state({});
  lastError = $state(null);

  #source = null;
  #retry = 0;
  #logHandlers = new Set();

  connect() {
    if (!browser || this.#source) return;
    this.#open();
  }

  #open() {
    const es = new EventSource('/api/stream');
    this.#source = es;

    es.addEventListener('open', () => {
      this.connected = true;
      this.#retry = 0;
      this.lastError = null;
    });

    es.addEventListener('metrics', (e) => { this.metrics = JSON.parse(e.data); });
    es.addEventListener('apps', (e) => { this.apps = JSON.parse(e.data); });
    es.addEventListener('activity', (e) => { this.activity = JSON.parse(e.data); });

    es.addEventListener('pm2:event', (e) => {
      const evt = JSON.parse(e.data);
      this.events = [evt, ...this.events].slice(0, 100);
    });

    es.addEventListener('pm2:log', (e) => {
      const log = JSON.parse(e.data);
      for (const fn of this.#logHandlers) fn(log);
    });

    es.addEventListener('error', () => {
      this.connected = false;
      es.close();
      this.#source = null;
      this.#retry += 1;
      const delay = Math.min(1000 * 2 ** this.#retry, 15_000);
      this.lastError = `Disconnected — retrying in ${Math.round(delay / 1000)}s`;
      setTimeout(() => { if (!this.#source) this.#open(); }, delay);
    });
  }

  activityFor(name) {
    return this.activity[name] ?? null;
  }

  onLog(fn) {
    this.#logHandlers.add(fn);
    return () => this.#logHandlers.delete(fn);
  }

  get online() { return this.apps.filter((a) => a.status === 'online').length; }
  get stopped() { return this.apps.filter((a) => a.status === 'stopped').length; }
  get errored() { return this.apps.filter((a) => a.status === 'errored').length; }
  get totalCpu() { return this.apps.reduce((acc, a) => acc + (a.cpu || 0), 0); }
  get totalMem() { return this.apps.reduce((acc, a) => acc + (a.memory || 0), 0); }
}

export const live = new LiveState();

import { toast } from 'svelte-sonner';

export const toasts = {
  ok: (title, description) => toast.success(title, { description }),
  error: (title, description) => toast.error(title, { description, duration: 8000 }),
  info: (title, description) => toast(title, { description }),
  loading: (title) => toast.loading(title),
  dismiss: (id) => toast.dismiss(id),
};

async function request(url, { method = 'GET', body, quiet = false } = {}) {
  try {
    const res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : {};
    if (!res.ok) throw new Error(data.message || data.error || `Request failed (${res.status})`);
    return data;
  } catch (err) {
    if (!quiet) toasts.error('Action failed', err.message);
    throw err;
  }
}

export function api(url, body, options = {}) {
  return request(url, { method: 'POST', body, ...options });
}

export function apiGet(url, params = {}, options = {}) {
  const qs = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v != null && v !== ''),
  ).toString();
  return request(qs ? `${url}?${qs}` : url, { method: 'GET', ...options });
}

export async function streamPost(url, body, onEvent) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) throw new Error(`Request failed (${res.status})`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';

    for (const frame of frames) {
      let name = null;
      let data = '';
      for (const line of frame.split('\n')) {
        if (line.startsWith('event: ')) name = line.slice(7);
        else if (line.startsWith('data: ')) data += line.slice(6);
      }
      if (!name || !data) continue;
      onEvent(name, JSON.parse(data));
    }
  }
}
