<script>
  import { onMount } from 'svelte';
  import { goto, invalidateAll } from '$app/navigation';
  import { live, api, apiGet, toasts } from '$lib/live.svelte.js';
  import { bytes, duration, num, relTime } from '$lib/format.js';

  import * as Card from '$lib/components/ui/card/index.js';
  import * as Tabs from '$lib/components/ui/tabs/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import { Checkbox } from '$lib/components/ui/checkbox/index.js';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { cn } from '$lib/utils.js';
  import { STACK_BY_ID } from '$lib/stacks.js';
  import TechLogo from '$lib/components/TechLogo.svelte';
  import Boxes from '@lucide/svelte/icons/boxes';

  import PageHeader from '$lib/components/PageHeader.svelte';
  import StatusBadge from '$lib/components/StatusBadge.svelte';
  import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
  import LogStream from '$lib/components/LogStream.svelte';
  import EnvEditor from '$lib/components/EnvEditor.svelte';

  import ArrowLeft from '@lucide/svelte/icons/arrow-left';
  import RotateCw from '@lucide/svelte/icons/rotate-cw';
  import Square from '@lucide/svelte/icons/square';
  import Play from '@lucide/svelte/icons/play';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import RefreshCcw from '@lucide/svelte/icons/refresh-ccw';
  import Eraser from '@lucide/svelte/icons/eraser';
  import Save from '@lucide/svelte/icons/save';
  import Database from '@lucide/svelte/icons/database';
  import LoaderCircle from '@lucide/svelte/icons/loader-circle';

  let { data } = $props();

  let logs = $state([...data.initialLogs]);
  let filter = $state('');
  let autoscroll = $state(true);
  let confirmOpen = $state(false);
  let envVars = $state(structuredClone(data.envVars));
  let savingEnv = $state(false);
  let envConfirm = $state(false);

  const envDirty = $derived(JSON.stringify(envVars) !== JSON.stringify(data.envVars));

  const app = $derived(live.apps.find((x) => x.pmId === data.proc.pmId) ?? data.proc);

  onMount(() =>
    live.onLog((l) => {
      if (l.pmId !== data.proc.pmId) return;
      logs = [...logs, l].slice(-2000);
    }),
  );

  async function act(action) {
    await api('/api/apps', { action, id: data.proc.pmId });
    toasts.ok(`${app.name} ${action}ed`);
    if (action === 'delete') return goto('/apps');
    await invalidateAll();
  }

  async function saveEnv() {
    savingEnv = true;
    try {
      const res = await api('/api/apps', {
        action: 'update-env',
        id: data.proc.pmId,
        envVars: envVars.map(({ key, value, secret }) => ({ key, value, secret })),
      });
      toasts.ok('Environment saved', `${app.name} restarted`);
      const next = res?.result?.[0]?.pm2_env?.pm_id ?? res?.result?.pm_id;
      if (next != null && next !== data.proc.pmId) return goto(`/apps/${next}`, { invalidateAll: true });
      await invalidateAll();
      envVars = structuredClone(data.envVars);
    } finally {
      savingEnv = false;
    }
  }

  async function reloadLogs() {
    const res = await apiGet(`/api/logs/${data.proc.pmId}`, { lines: 500 });
    logs = res.lines;
    toasts.ok('Logs reloaded', `${res.lines.length} lines`);
  }

  async function flush() {
    await api('/api/apps', { action: 'flush', id: data.proc.pmId });
    logs = [];
    toasts.ok('Log files cleared', app.name);
  }

  const envEntries = $derived(Object.entries(data.proc.env ?? {}));

  const TILES = $derived([
    { label: 'CPU', value: app.status === 'online' ? `${app.cpu}%` : '—', sub: `${app.instances} instance${app.instances === 1 ? '' : 's'}` },
    { label: 'Memory', value: bytes(app.memory), sub: app.maxMemoryRestart ? `limit ${bytes(app.maxMemoryRestart)}` : 'no limit' },
    { label: 'Uptime', value: app.status === 'online' ? duration(app.uptime) : '—', sub: app.startedAt ? `since ${relTime(app.startedAt)}` : 'not running' },
    { label: 'Restarts', value: num(app.restarts), sub: `${num(app.unstableRestarts)} unstable` },
  ]);

  const COMMAND = $derived(
    [app.interpreter || 'node', app.script, Array.isArray(app.args) ? app.args.join(' ') : app.args]
      .filter(Boolean)
      .join(' '),
  );

  const PROCESS = $derived([
    ['Working directory', app.cwd],
    ['Runs as', `${app.execMode}${app.instances > 1 ? ` × ${app.instances} copies` : ''}`],
    ['Node', app.nodeVersion ?? '—'],
    ['Deployed', app.createdAt ? new Date(app.createdAt).toLocaleString() : '—'],
  ]);

  const SUPERVISION = $derived([
    ['Restart if it crashes', app.autorestart ? 'yes' : 'no'],
    ['Restart on file change', app.watching ? 'yes' : 'no'],
    ['Memory limit', app.maxMemoryRestart ? bytes(app.maxMemoryRestart) : 'none'],
    ['PM2 id / PID', `${app.pmId} / ${app.pid ?? '—'}`],
  ]);
</script>

<svelte:head><title>{app.name} · Apps</title></svelte:head>

<div class="px-5 pt-4 md:px-6">
  <a href="/apps" class="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-xs">
    <ArrowLeft class="size-3.5" /> Applications
  </a>
</div>

<header class="flex flex-wrap items-center gap-3.5 px-5 pt-3 pb-1 md:px-6">
  <div
    class={cn(
      'grid size-13 shrink-0 place-items-center rounded-2xl',
      app.status === 'errored' ? 'bg-bad/14 text-bad' : 'panel-raised text-foreground',
    )}
  >
    {#if app.stack && STACK_BY_ID[app.stack]}
      <TechLogo name={STACK_BY_ID[app.stack].logo} class="size-6.5" />
    {:else}
      <Boxes class="size-6.5" />
    {/if}
  </div>
  <div class="min-w-0">
    <div class="flex items-center gap-2.5">
      <h1 class="truncate text-[27px] font-semibold">{app.name}</h1>
      <StatusBadge status={app.status} />
    </div>
    <p class="text-muted-foreground mt-0.5 truncate font-mono text-[11.5px]">
      {app.cwd ?? ''} · {app.execMode}{app.instances > 1 ? ` ×${app.instances}` : ''}
    </p>
  </div>

  <div class="ml-auto flex flex-wrap items-center gap-2">
    <Button variant="ghost" size="sm" class="panel h-8.5 rounded-xl" onclick={() => act('restart')}>
      <RotateCw class="size-3.5" /> Restart
    </Button>
    {#if app.execMode === 'cluster'}
      <Button variant="ghost" size="sm" class="panel h-8.5 rounded-xl" onclick={() => act('reload')}>Reload</Button>
    {/if}
    {#if app.status === 'online'}
      <Button variant="ghost" size="sm" class="panel h-8.5 rounded-xl" onclick={() => act('stop')}>
        <Square class="size-3.5" /> Stop
      </Button>
    {:else}
      <Button size="sm" class="accent-fill h-8.5 rounded-xl px-4 font-semibold" onclick={() => act('restart')}>
        <Play class="size-3.5" /> Start
      </Button>
    {/if}
    <Button
      variant="ghost"
      size="icon"
      class="bg-bad/10 text-bad hover:bg-bad/20 hover:text-bad size-8.5 rounded-xl shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--bad)_22%,transparent)]"
      onclick={() => (confirmOpen = true)}
    >
      <Trash2 class="size-3.5" />
    </Button>
  </div>
</header>

<div class="flex flex-1 flex-col gap-3.5 p-5 pt-3.5 md:p-6 md:pt-3.5">
  <Tabs.Root value="overview">
    <Tabs.List>
      <Tabs.Trigger value="overview">Overview</Tabs.Trigger>
      <Tabs.Trigger value="env" class="gap-1.5">
        Environment
        {#if envDirty}<span class="dot text-primary"></span>{/if}
      </Tabs.Trigger>
      <Tabs.Trigger value="database">Database</Tabs.Trigger>
      <Tabs.Trigger value="logs">Logs</Tabs.Trigger>
    </Tabs.List>

    <Tabs.Content value="overview" class="space-y-3">
      <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {#each TILES as t (t.label)}
          <div class="panel-raised rounded-2xl p-4">
            <p class="eyebrow">{t.label}</p>
            <p class="tabular mt-1 text-[27px] font-semibold">{t.value}</p>
            <p class="text-muted-foreground mt-0.5 font-mono text-[10.5px]">{t.sub}</p>
          </div>
        {/each}
      </div>

      <div class="accent-wash rounded-2xl p-4.5">
        <p class="eyebrow mb-1.5">Command</p>
        <p class="font-mono text-[12.5px] break-all">{COMMAND}</p>
      </div>

      <div class="grid gap-3 lg:grid-cols-2">
        <div class="panel rounded-2xl p-4.5">
          <span class="eyebrow">Process</span>
          <dl class="mt-3 grid gap-x-6 gap-y-2.5 sm:grid-cols-[minmax(8.5rem,auto)_1fr]">
            {#each PROCESS as [key, value] (key)}
              <dt class="text-muted-foreground text-[12.5px]">{key}</dt>
              <dd class="font-mono text-[11.5px] break-all">{value}</dd>
            {/each}
          </dl>
        </div>

        <div class="panel rounded-2xl p-4.5">
          <span class="eyebrow">Supervision</span>
          <dl class="mt-3 grid gap-x-6 gap-y-2.5 sm:grid-cols-[minmax(8.5rem,auto)_1fr]">
            {#each SUPERVISION as [key, value] (key)}
              <dt class="text-muted-foreground text-[12.5px]">{key}</dt>
              <dd class="font-mono text-[11.5px] break-all">{value}</dd>
            {/each}
          </dl>
        </div>
      </div>
    </Tabs.Content>

    <Tabs.Content value="logs">
      <Card.Root class="gap-0 py-0">
        <Card.Header class="border-border flex-row flex-wrap items-center gap-3 border-b py-3.5">
          <Card.Title class="text-base">Output</Card.Title>
          <Badge
            variant="outline"
            class={live.connected ? 'border-ok/40 text-ok gap-1.5' : 'border-bad/40 text-bad gap-1.5'}
          >
            <span class="size-1.5 rounded-full bg-current"></span>
            {live.connected ? 'streaming' : 'offline'}
          </Badge>
          <div class="ml-auto flex flex-wrap items-center gap-2">
            <Input placeholder="Filter lines…" bind:value={filter} class="h-8 w-44" />
            <div class="flex items-center gap-2">
              <Checkbox id="follow" bind:checked={autoscroll} />
              <Label for="follow" class="text-xs font-normal">Follow</Label>
            </div>
            <Button variant="outline" size="sm" class="h-8" onclick={reloadLogs}>
              <RefreshCcw class="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              class="text-bad hover:text-bad hover:bg-bad/10 h-8"
              onclick={flush}
            >
              <Eraser class="size-3.5" />
            </Button>
          </div>
        </Card.Header>
        <Card.Content class="p-3">
          <LogStream lines={logs} bind:filter bind:autoscroll height="52vh" />
          <div class="text-muted-foreground mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px]">
            <span>{logs.length} lines buffered · new output appears live</span>
            <span class="ml-auto font-mono">{app.outLog ?? ''}</span>
          </div>
        </Card.Content>
      </Card.Root>
    </Tabs.Content>


    <Tabs.Content value="env" class="space-y-3">
      <div class="panel-raised rounded-2xl p-4.5">
        <EnvEditor bind:vars={envVars} />
      </div>

      <div class="flex flex-wrap items-center gap-3">
        <p class="text-muted-foreground text-[11.5px]">
          Saving restarts {app.name} — it has to start again to pick up a new environment.
        </p>
        <div class="ml-auto flex items-center gap-2">
          {#if envDirty}
            <Button
              variant="ghost"
              size="sm"
              class="h-8.5 rounded-xl"
              disabled={savingEnv}
              onclick={() => (envVars = structuredClone(data.envVars))}
            >
              Discard
            </Button>
          {/if}
          <Button
            size="sm"
            class="accent-fill h-8.5 rounded-xl px-4 font-semibold"
            disabled={!envDirty || savingEnv}
            onclick={() => (envConfirm = true)}
          >
            {#if savingEnv}
              <LoaderCircle class="size-3.5 animate-spin" /> Saving…
            {:else}
              <Save class="size-3.5" /> Save and restart
            {/if}
          </Button>
        </div>
      </div>
    </Tabs.Content>

    <Tabs.Content value="database">
      <div class="panel flex flex-col items-center gap-3 rounded-2xl px-6 py-16 text-center">
        <div class="panel grid size-12 place-items-center rounded-full">
          <Database class="text-muted-foreground size-5" />
        </div>
        <div>
          <p class="font-semibold">No database attached</p>
          <p class="text-muted-foreground mx-auto mt-1 max-w-md text-sm">
            Databases are not implemented yet. This is where you will attach one to {app.name} and
            have its connection details injected as environment variables.
          </p>
        </div>
      </div>
    </Tabs.Content>

  </Tabs.Root>
</div>

<ConfirmDialog
  bind:open={envConfirm}
  title="Save environment and restart {app.name}?"
  description="The app is removed from PM2 and started again with the new environment, so it will be briefly unreachable. Variables marked secret are written to a .env file in the project at mode 0600; the rest are passed to PM2."
  confirmLabel="Save and restart"
  onconfirm={saveEnv}
/>

<ConfirmDialog
  bind:open={confirmOpen}
  title="Delete {app.name}?"
  description="This removes the app from PM2. Files on disk are untouched."
  confirmLabel="Delete app"
  destructive
  onconfirm={() => act('delete')}
/>
