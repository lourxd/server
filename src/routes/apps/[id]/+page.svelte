<script>
  import { onMount } from 'svelte';
  import { goto, invalidateAll } from '$app/navigation';
  import { live, api, apiGet, toasts } from '$lib/live.svelte.js';
  import { bytes, duration, num, relTime } from '$lib/format.js';

  import * as Card from '$lib/components/ui/card/index.js';
  import * as Tabs from '$lib/components/ui/tabs/index.js';
  import * as Table from '$lib/components/ui/table/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import { Checkbox } from '$lib/components/ui/checkbox/index.js';
  import { Badge } from '$lib/components/ui/badge/index.js';

  import PageHeader from '$lib/components/PageHeader.svelte';
  import StatusBadge from '$lib/components/StatusBadge.svelte';
  import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
  import LogStream from '$lib/components/LogStream.svelte';

  import ArrowLeft from '@lucide/svelte/icons/arrow-left';
  import RotateCw from '@lucide/svelte/icons/rotate-cw';
  import Square from '@lucide/svelte/icons/square';
  import Play from '@lucide/svelte/icons/play';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import RefreshCcw from '@lucide/svelte/icons/refresh-ccw';
  import Eraser from '@lucide/svelte/icons/eraser';

  let { data } = $props();

  let logs = $state([...data.initialLogs]);
  let filter = $state('');
  let autoscroll = $state(true);
  let confirmOpen = $state(false);

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

  const CONFIG = $derived([
    ['PM2 id', app.pmId],
    ['PID', app.pid ?? '—'],
    ['Namespace', app.namespace],
    ['Script', app.script],
    ['Working directory', app.cwd],
    ['Interpreter', app.interpreter ?? '—'],
    ['Arguments', Array.isArray(app.args) ? app.args.join(' ') || '—' : app.args || '—'],
    ['Exec mode', `${app.execMode} × ${app.instances}`],
    ['Auto-restart', app.autorestart ? 'yes' : 'no'],
    ['Watching', app.watching ? 'yes' : 'no'],
    ['Node version', app.nodeVersion ?? '—'],
    ['Out log', app.outLog ?? '—'],
    ['Error log', app.errLog ?? '—'],
    ['Created', app.createdAt ? new Date(app.createdAt).toLocaleString() : '—'],
  ]);
</script>

<svelte:head><title>{app.name} · Apps</title></svelte:head>

<PageHeader title={app.name}>
  {#snippet children()}
    <StatusBadge status={app.status} />
  {/snippet}
  {#snippet actions()}
    <Button variant="ghost" size="sm" href="/apps"><ArrowLeft class="size-4" /> Apps</Button>
    <Button variant="outline" size="sm" onclick={() => act('restart')}>
      <RotateCw class="size-3.5" /> Restart
    </Button>
    {#if app.execMode === 'cluster'}
      <Button variant="outline" size="sm" onclick={() => act('reload')}>Reload</Button>
    {/if}
    {#if app.status === 'online'}
      <Button variant="outline" size="sm" onclick={() => act('stop')}><Square class="size-3.5" /> Stop</Button>
    {:else}
      <Button size="sm" onclick={() => act('restart')}><Play class="size-3.5" /> Start</Button>
    {/if}
    <Button
      variant="ghost"
      size="sm"
      class="text-bad hover:text-bad hover:bg-bad/10"
      onclick={() => (confirmOpen = true)}
    >
      <Trash2 class="size-3.5" /> Delete
    </Button>
  {/snippet}
</PageHeader>

<div class="flex-1 space-y-4 p-5">
  <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
    <Card.Root class="py-4">
      <Card.Header class="px-4">
        <Card.Description class="text-[11px] font-semibold tracking-wide uppercase">CPU</Card.Description>
        <Card.Title class="tabular text-2xl">{app.cpu}%</Card.Title>
      </Card.Header>
    </Card.Root>
    <Card.Root class="py-4">
      <Card.Header class="px-4">
        <Card.Description class="text-[11px] font-semibold tracking-wide uppercase">Memory</Card.Description>
        <Card.Title class="tabular text-2xl">{bytes(app.memory)}</Card.Title>
        <p class="text-muted-foreground text-xs">
          {app.maxMemoryRestart ? `limit ${bytes(app.maxMemoryRestart)}` : 'no limit'}
        </p>
      </Card.Header>
    </Card.Root>
    <Card.Root class="py-4">
      <Card.Header class="px-4">
        <Card.Description class="text-[11px] font-semibold tracking-wide uppercase">Uptime</Card.Description>
        <Card.Title class="tabular text-2xl">
          {app.status === 'online' ? duration(app.uptime) : '—'}
        </Card.Title>
        <p class="text-muted-foreground text-xs">
          since {app.startedAt ? relTime(app.startedAt) : '—'}
        </p>
      </Card.Header>
    </Card.Root>
    <Card.Root class="py-4">
      <Card.Header class="px-4">
        <Card.Description class="text-[11px] font-semibold tracking-wide uppercase">Restarts</Card.Description>
        <Card.Title class="tabular text-2xl">{num(app.restarts)}</Card.Title>
        <p class="text-muted-foreground text-xs">{num(app.unstableRestarts)} unstable</p>
      </Card.Header>
    </Card.Root>
  </div>

  <Tabs.Root value="logs">
    <Tabs.List>
      <Tabs.Trigger value="logs">Logs</Tabs.Trigger>
      <Tabs.Trigger value="config">Configuration</Tabs.Trigger>
      <Tabs.Trigger value="env">Environment</Tabs.Trigger>
    </Tabs.List>

    <Tabs.Content value="logs">
      <Card.Root class="gap-0 py-0">
        <Card.Header class="flex-row flex-wrap items-center gap-3 border-b py-3">
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
          <p class="text-muted-foreground mt-2 text-xs">
            {logs.length} lines buffered · new output appears live
          </p>
        </Card.Content>
      </Card.Root>
    </Tabs.Content>

    <Tabs.Content value="config">
      <Card.Root>
        <Card.Content>
          <dl class="grid gap-x-6 gap-y-2.5 text-sm sm:grid-cols-[minmax(9rem,auto)_1fr]">
            {#each CONFIG as [key, value] (key)}
              <dt class="text-muted-foreground">{key}</dt>
              <dd class="font-mono text-xs break-all">{value}</dd>
            {/each}
          </dl>
        </Card.Content>
      </Card.Root>
    </Tabs.Content>

    <Tabs.Content value="env">
      <Card.Root class="gap-0 overflow-hidden py-0">
        <Card.Header class="flex-row items-center gap-3 border-b py-3">
          <Card.Title class="text-base">Environment variables</Card.Title>
          <span class="text-muted-foreground ml-auto text-xs">{envEntries.length} variables</span>
        </Card.Header>
        <Table.Root>
          <Table.Header>
            <Table.Row class="hover:bg-transparent">
              <Table.Head class="w-1/3">Name</Table.Head>
              <Table.Head>Value</Table.Head>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {#each envEntries as [key, value] (key)}
              <Table.Row>
                <Table.Cell class="font-mono text-xs">{key}</Table.Cell>
                <Table.Cell class="max-w-lg truncate font-mono text-xs" title={value}>{value}</Table.Cell>
              </Table.Row>
            {/each}
          </Table.Body>
        </Table.Root>
      </Card.Root>
    </Tabs.Content>
  </Tabs.Root>
</div>

<ConfirmDialog
  bind:open={confirmOpen}
  title="Delete {app.name}?"
  description="This removes the app from PM2. Files on disk are untouched."
  confirmLabel="Delete app"
  destructive
  onconfirm={() => act('delete')}
/>
