<script>
  import { onMount } from 'svelte';
  import { goto, invalidateAll } from '$app/navigation';
  import { live, api, apiGet, streamPost, toasts } from '$lib/live.svelte.js';
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
  import Link2Off from '@lucide/svelte/icons/link-2-off';
  import Hammer from '@lucide/svelte/icons/hammer';
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

  const stackDefaults = $derived(app.stack ? (STACK_BY_ID[app.stack]?.defaults ?? null) : null);
  const canRebuild = $derived(!!stackDefaults?.build && !!data.relPath && !data.relPath.startsWith('..'));

  let rebuilding = $state(false);
  let rebuildLines = $state([]);
  let rebuildFailed = $state(false);

  async function rebuild() {
    rebuilding = true;
    rebuildFailed = false;
    rebuildLines = [];
    logKind = 'build';
    let ok = false;
    try {
      await streamPost(
        '/api/repos/run',
        {
          action: 'run-script',
          script: 'build',
          path: data.relPath,
          buildLogFor: app.name,
          clean: stackDefaults.buildOutput || undefined,
        },
        (event, payload) => {
          if (event === 'line') rebuildLines = [...rebuildLines, payload];
          if (event === 'done') ok = payload.ok;
        },
      );
    } catch (err) {
      rebuildLines = [...rebuildLines, { stream: 'err', line: err.message }];
    }
    rebuilding = false;
    rebuildFailed = !ok;

    if (!ok) {
      toasts.error('Build failed', 'The app was left as it was — see the output.');
      return;
    }

    try {
      await api('/api/apps', { action: 'restart', id: data.proc.pmId });
      toasts.ok('Rebuilt and restarted', app.name);
      await invalidateAll();
    } catch {
    }
  }

  let logKind = $state('runtime');
  let buildLog = $state(null);
  let buildLoading = $state(false);

  async function loadBuildLog() {
    buildLoading = true;
    try {
      buildLog = await apiGet(`/api/logs/${data.proc.pmId}`, { kind: 'build', name: app.name });
    } finally {
      buildLoading = false;
    }
  }

  function switchLogs(kind) {
    logKind = kind;
    if (kind === 'build' && !buildLog) loadBuildLog();
  }

  let dbBusy = $state(false);
  let detachConfirm = $state(false);

  const attachedDb = $derived(data.databases.find((c) => c.id === data.attached.id) ?? null);
  const logoFor = (conn) => data.catalogue.find((e) => e.type === conn.type)?.logo ?? 'sqlite';

  async function attach(conn) {
    dbBusy = true;
    try {
      await api('/api/apps', { action: 'attach-db', id: data.proc.pmId, connectionId: conn.id });
      toasts.ok('Database attached', `${conn.name} · ${app.name} restarted`);
      await invalidateAll();
    } finally {
      dbBusy = false;
    }
  }

  async function detach() {
    dbBusy = true;
    try {
      await api('/api/apps', { action: 'detach-db', id: data.proc.pmId });
      toasts.ok('Database detached', `${app.name} restarted`);
      await invalidateAll();
    } finally {
      dbBusy = false;
    }
  }

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
      <StatusBadge status={app.status} activity={live.activityFor(app.name)} />
    </div>
    <p class="text-muted-foreground mt-0.5 truncate font-mono text-[11.5px]">
      {app.cwd ?? ''} · {app.execMode}{app.instances > 1 ? ` ×${app.instances}` : ''}
    </p>
  </div>

  <div class="ml-auto flex flex-wrap items-center gap-2">
    {#if canRebuild}
      <Button
        variant="ghost"
        size="sm"
        class="panel h-8.5 rounded-xl"
        disabled={rebuilding}
        onclick={rebuild}
      >
        {#if rebuilding}
          <LoaderCircle class="size-3.5 animate-spin" />
        {:else}
          <Hammer class="size-3.5" />
        {/if}
        {rebuilding ? 'Building…' : 'Rebuild'}
      </Button>
    {/if}
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
          <div class="panel flex items-center gap-0.5 rounded-lg p-0.5">
            <button
              type="button"
              onclick={() => switchLogs('runtime')}
              class={cn(
                'rounded-md px-2.5 py-1 text-[11.5px] font-medium transition-colors',
                logKind === 'runtime' ? 'bg-background text-foreground' : 'text-muted-foreground',
              )}
            >
              Runtime
            </button>
            <button
              type="button"
              onclick={() => switchLogs('build')}
              class={cn(
                'rounded-md px-2.5 py-1 text-[11.5px] font-medium transition-colors',
                logKind === 'build' ? 'bg-background text-foreground' : 'text-muted-foreground',
              )}
            >
              Build
            </button>
          </div>
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
          {#if logKind === 'runtime'}
            <LogStream lines={logs} bind:filter bind:autoscroll height="52vh" />
            <div class="text-muted-foreground mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px]">
              <span>{logs.length} lines buffered · new output appears live</span>
              <span class="ml-auto font-mono">{app.outLog ?? ''}</span>
            </div>
          {:else if rebuilding || rebuildLines.length}
            <LogStream lines={rebuildLines} failed={rebuildFailed} height="52vh" />
            <p class="text-muted-foreground mt-2 flex items-center gap-2 text-[11.5px]">
              {#if rebuilding}
                <LoaderCircle class="size-3.5 animate-spin" /> Building {app.name}…
              {:else if rebuildFailed}
                Build failed — the app was left as it was.
              {:else}
                Build finished.
              {/if}
            </p>
          {:else if buildLoading}
            <p class="text-muted-foreground flex items-center gap-2 py-10 text-center text-sm">
              <LoaderCircle class="size-4 animate-spin" /> Loading build output…
            </p>
          {:else if buildLog?.exists}
            <LogStream lines={buildLog.lines} height="52vh" />
            <div class="text-muted-foreground mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px]">
              <span>{buildLog.lines.length} lines · from {relTime(buildLog.at)}</span>
              <Button variant="ghost" size="sm" class="ml-auto h-7 rounded-lg" onclick={loadBuildLog}>
                Reload
              </Button>
            </div>
          {:else}
            <p class="text-muted-foreground py-14 text-center text-sm">
              No build has been run through the panel for {app.name}.
            </p>
          {/if}
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

    <Tabs.Content value="database" class="space-y-3">
      {#if attachedDb}
        <div class="panel-raised flex flex-wrap items-center gap-3.5 rounded-2xl p-4.5">
          <div class="bg-foreground/8 grid size-10 shrink-0 place-items-center rounded-xl">
            <TechLogo name={logoFor(attachedDb)} class="size-5" />
          </div>
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <p class="truncate text-[14.5px] font-semibold">{attachedDb.name}</p>
              {#if attachedDb.remote}
                <Badge variant="outline" class="border-info/40 text-info font-mono text-[10px]">remote</Badge>
              {/if}
            </div>
            <p class="text-muted-foreground truncate font-mono text-[10.5px]">
              {attachedDb.type === 'sqlite'
                ? attachedDb.file
                : `${attachedDb.host}:${attachedDb.port}${attachedDb.database ? ` / ${attachedDb.database}` : ''}`}
            </p>
          </div>
          <div class="panel rounded-lg px-2.5 py-1.5 font-mono text-[11px]">
            {data.attached.varName ?? 'DATABASE_URL'}
          </div>
          <Button
            variant="ghost"
            size="sm"
            class="h-8 rounded-lg"
            disabled={dbBusy}
            onclick={() => (detachConfirm = true)}
          >
            {#if dbBusy}<LoaderCircle class="size-3.5 animate-spin" />{:else}<Link2Off class="size-3.5" />{/if}
            Detach
          </Button>
        </div>

        <p class="text-muted-foreground text-[11.5px]">
          The connection string is written to <code class="font-mono">.env</code> in the project at
          mode 0600 as
          <code class="font-mono">{data.attached.varName ?? 'DATABASE_URL'}</code>, never passed to
          PM2. Read it with <code class="font-mono">process.env.{data.attached.varName ?? 'DATABASE_URL'}</code>.
        </p>
      {:else if data.databases.length}
        <p class="text-muted-foreground text-[12.5px]">
          Attaching writes the connection string into the project's
          <code class="font-mono">.env</code> and restarts {app.name}.
        </p>

        <div class="grid gap-2.5 lg:grid-cols-2">
          {#each data.databases as conn (conn.id)}
            <div class="panel flex items-center gap-3 rounded-2xl p-3.5">
              <div class="bg-foreground/6 grid size-9 shrink-0 place-items-center rounded-xl">
                <TechLogo name={logoFor(conn)} class="size-4.5" />
              </div>
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2">
                  <p class="truncate text-[13.5px] font-semibold">{conn.name}</p>
                  {#if conn.remote}
                    <Badge variant="outline" class="border-info/40 text-info font-mono text-[9.5px]">
                      remote
                    </Badge>
                  {/if}
                </div>
                <p class="text-muted-foreground truncate font-mono text-[10.5px]">
                  {conn.type === 'sqlite' ? conn.file : `${conn.host}:${conn.port}`}
                </p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                class="panel h-8 shrink-0 rounded-lg px-3"
                disabled={dbBusy}
                onclick={() => attach(conn)}
              >
                Attach
              </Button>
            </div>
          {/each}
        </div>
      {:else}
        <div class="panel flex flex-col items-center gap-3 rounded-2xl px-6 py-16 text-center">
          <div class="panel grid size-12 place-items-center rounded-full">
            <Database class="text-muted-foreground size-5" />
          </div>
          <div>
            <p class="font-semibold">No databases yet</p>
            <p class="text-muted-foreground mx-auto mt-1 max-w-md text-sm">
              Create one on this machine, or connect one you already run elsewhere, then attach it
              here.
            </p>
          </div>
          <Button href="/databases" class="accent-fill mt-1 rounded-xl px-4 font-semibold">
            Go to Databases
          </Button>
        </div>
      {/if}
    </Tabs.Content>

  </Tabs.Root>
</div>

<ConfirmDialog
  bind:open={detachConfirm}
  title="Detach {attachedDb?.name} from {app.name}?"
  description="The connection string is removed from the project's .env and the app restarts. The database itself is untouched."
  confirmLabel="Detach"
  onconfirm={detach}
/>

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
