<script>
  import { invalidateAll } from '$app/navigation';
  import { api, toasts } from '$lib/live.svelte.js';
  import { cn } from '$lib/utils.js';

  import { Button } from '$lib/components/ui/button/index.js';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import * as Alert from '$lib/components/ui/alert/index.js';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
  import TechLogo from '$lib/components/TechLogo.svelte';

  import Plus from '@lucide/svelte/icons/plus';
  import Database from '@lucide/svelte/icons/database';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import ArrowLeft from '@lucide/svelte/icons/arrow-left';
  import LoaderCircle from '@lucide/svelte/icons/loader-circle';
  import CircleAlert from '@lucide/svelte/icons/circle-alert';

  let { data } = $props();

  let open = $state(false);
  let step = $state(1);
  let picked = $state(null);
  let creating = $state(false);
  let confirmOpen = $state(false);
  let removeTarget = $state(null);

  let form = $state({ name: '', host: '127.0.0.1', port: '', user: '', password: '' });

  const engine = $derived(picked ? data.catalogue.find((e) => e.type === picked) : null);
  const engineState = $derived(
    engine ? (data.engines.find((e) => e.type === engine.type && e.installed) ?? null) : null,
  );
  const running = $derived(engineState?.listening === true);

  const stateOf = (type) => data.engines.find((e) => e.type === type && e.installed) ?? null;

  function openDialog() {
    step = 1;
    picked = null;
    creating = false;
    open = true;
  }

  function choose(type) {
    picked = type;
    const e = data.catalogue.find((x) => x.type === type);
    form = {
      name: '',
      host: '127.0.0.1',
      port: e.defaultPort ? String(e.defaultPort) : '',
      user: e.defaultUser ?? '',
      password: '',
    };
    step = 2;
  }

  async function create() {
    creating = true;
    try {
      const created = await api('/api/db', {
        action: 'create',
        type: picked,
        name: form.name.trim(),
        server: engine.needsServer
          ? { host: form.host, port: form.port, user: form.user, password: form.password }
          : undefined,
      });
      toasts.ok('Database created', created.name);
      open = false;
      await invalidateAll();
    } finally {
      creating = false;
    }
  }

  function askRemove(conn) {
    removeTarget = conn;
    confirmOpen = true;
  }

  async function remove() {
    await api('/api/db', { action: 'delete', id: removeTarget.id });
    toasts.ok('Removed', removeTarget.name);
    await invalidateAll();
  }
</script>

<svelte:head><title>Databases · {data.host?.hostname}</title></svelte:head>

<PageHeader title="Databases" subtitle="{data.connections.length} on this server">
  {#snippet actions()}
    <Button onclick={openDialog} class="accent-fill h-8.5 rounded-xl px-4 font-semibold">
      <Plus class="size-4" /> Create database
    </Button>
  {/snippet}
</PageHeader>

<div class="flex flex-col gap-3.5 p-5 pt-3.5 md:p-6 md:pt-3.5">
  {#if !data.connections.length}
    <div class="panel flex flex-col items-center gap-3 rounded-2xl px-6 py-16 text-center">
      <div class="panel grid size-12 place-items-center rounded-full">
        <Database class="text-muted-foreground size-5" />
      </div>
      <div>
        <p class="font-semibold">No databases yet</p>
        <p class="text-muted-foreground mt-1 text-sm">
          Create one here, then point an app at it from its Database tab.
        </p>
      </div>
      <Button onclick={openDialog} class="accent-fill mt-1 rounded-xl px-4 font-semibold">
        <Plus class="size-4" /> Create database
      </Button>
    </div>
  {:else}
    <div class="grid gap-3 xl:grid-cols-2">
      {#each data.connections as conn (conn.id)}
        {@const meta = data.catalogue.find((e) => e.type === conn.type)}
        <div class="panel-raised flex items-center gap-3.5 rounded-2xl p-4.5">
          <div class="bg-foreground/6 grid size-10 shrink-0 place-items-center rounded-xl">
            <TechLogo name={meta?.logo ?? 'sqlite'} class="size-5" />
          </div>
          <div class="min-w-0 flex-1">
            <p class="truncate text-[14.5px] font-semibold">{conn.name}</p>
            <p class="text-muted-foreground truncate font-mono text-[10.5px]">
              {conn.type === 'sqlite'
                ? conn.file
                : `${conn.host}:${conn.port}${conn.database ? ` / ${conn.database}` : ''}`}
            </p>
          </div>
          <Badge variant="outline" class="shrink-0 font-mono text-[10.5px]">{meta?.label ?? conn.type}</Badge>
          <Button
            variant="ghost"
            size="icon"
            class="hover:text-bad size-8 shrink-0 rounded-lg"
            onclick={() => askRemove(conn)}
          >
            <Trash2 class="size-3.5" />
          </Button>
        </div>
      {/each}
    </div>
  {/if}

  <div class="panel rounded-2xl p-4.5">
    <span class="eyebrow">Engines on this machine</span>
    <div class="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {#each data.catalogue as e (e.type)}
        {@const st = stateOf(e.type)}
        <div class="flex items-center gap-2.5">
          <TechLogo name={e.logo} class="text-foreground/70 size-4" />
          <span class="text-[12.5px]">{e.label}</span>
          <span class="ml-auto font-mono text-[10.5px]">
            {#if !e.needsServer}
              <span class="text-ok">built in</span>
            {:else if st?.listening}
              <span class="text-ok">running</span>
            {:else if st?.installed}
              <span class="text-warn">stopped</span>
            {:else}
              <span class="text-muted-foreground">not installed</span>
            {/if}
          </span>
        </div>
      {/each}
    </div>
  </div>
</div>

<Dialog.Root bind:open>
  <Dialog.Content class={cn('max-h-[90vh] overflow-y-auto', step === 1 ? 'sm:max-w-2xl' : 'sm:max-w-lg')}>
    <Dialog.Header>
      <Dialog.Title>
        {step === 1 ? 'Which database?' : `New ${engine?.label}`}
      </Dialog.Title>
      <Dialog.Description>
        {step === 1
          ? 'Pick an engine. What is already running on this machine is marked.'
          : engine?.summary}
      </Dialog.Description>
    </Dialog.Header>

    {#if step === 1}
      <div class="grid gap-2 sm:grid-cols-2">
        {#each data.catalogue as e (e.type)}
          {@const st = stateOf(e.type)}
          {@const ready = !e.needsServer || st?.listening}
          <button
            type="button"
            onclick={() => choose(e.type)}
            class="panel hover:accent-wash group flex items-start gap-3 rounded-2xl p-3.5 text-left transition-all"
          >
            <TechLogo name={e.logo} class="mt-0.5 size-6 shrink-0 transition-transform group-hover:scale-110" />
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <p class="text-sm font-medium">{e.label}</p>
                {#if ready}
                  <span class="text-ok flex items-center gap-1 font-mono text-[9.5px]">
                    <span class="dot"></span>ready
                  </span>
                {/if}
              </div>
              <p class="text-muted-foreground mt-0.5 text-xs">{e.summary}</p>
            </div>
          </button>
        {/each}
      </div>
    {:else}
      <div class="space-y-4">
        {#if engine.needsServer && !running}
          <Alert.Root>
            <CircleAlert class="size-4" />
            <Alert.Description class="text-xs">
              {#if engineState?.installed}
                {engine.label} is installed but not listening on port {engine.defaultPort}. Start it
                first, or point this at a server somewhere else.
              {:else}
                No {engine.label} server is running on this machine. Install one with
                <code class="font-mono">{engine.install}</code>, or give the details of a server
                elsewhere.
              {/if}
            </Alert.Description>
          </Alert.Root>
        {/if}

        <div class="space-y-1.5">
          <Label for="db-name">Database name</Label>
          <Input id="db-name" bind:value={form.name} placeholder="my_app" class="font-mono text-xs" />
          <p class="text-muted-foreground text-[11.5px]">
            {#if engine.needsServer}
              Letters, digits and underscores. Also used as the connection name here.
            {:else}
              Created as <code class="font-mono">databases/{form.name || 'name'}.db</code> in your
              projects directory.
            {/if}
          </p>
        </div>

        {#if engine.needsServer}
          <div class="grid grid-cols-[1fr_120px] gap-3">
            <div class="space-y-1.5">
              <Label for="db-host">Server</Label>
              <Input id="db-host" bind:value={form.host} class="font-mono text-xs" />
            </div>
            <div class="space-y-1.5">
              <Label for="db-port">Port</Label>
              <Input id="db-port" bind:value={form.port} class="font-mono text-xs" />
            </div>
          </div>
          <div class="grid gap-3 sm:grid-cols-2">
            <div class="space-y-1.5">
              <Label for="db-user">Admin user</Label>
              <Input id="db-user" bind:value={form.user} class="font-mono text-xs" />
            </div>
            <div class="space-y-1.5">
              <Label for="db-pass">Password</Label>
              <Input id="db-pass" type="password" bind:value={form.password} class="font-mono text-xs" />
            </div>
          </div>
          <p class="text-muted-foreground text-[11.5px]">
            Used once to create the database, then stored encrypted so the panel can browse it.
          </p>
        {/if}
      </div>
    {/if}

    <Dialog.Footer>
      {#if step === 1}
        <Button variant="outline" onclick={() => (open = false)}>Cancel</Button>
      {:else}
        <Button variant="outline" disabled={creating} onclick={() => (step = 1)}>
          <ArrowLeft class="size-4" /> Back
        </Button>
        <Button
          class="accent-fill rounded-xl px-4 font-semibold"
          disabled={creating || !form.name.trim()}
          onclick={create}
        >
          {#if creating}<LoaderCircle class="size-4 animate-spin" />{:else}<Plus class="size-4" />{/if}
          {creating ? 'Creating…' : 'Create'}
        </Button>
      {/if}
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<ConfirmDialog
  bind:open={confirmOpen}
  title="Remove {removeTarget?.name}?"
  description="This removes the saved connection from the panel. The database itself is not deleted."
  confirmLabel="Remove connection"
  destructive
  onconfirm={remove}
/>
