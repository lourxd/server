<script>
  import { invalidateAll } from '$app/navigation';
  import { api, streamPost, toasts, live } from '$lib/live.svelte.js';
  import { cn } from '$lib/utils.js';

  import { Button } from '$lib/components/ui/button/index.js';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import * as Alert from '$lib/components/ui/alert/index.js';
  import ConfirmDialog from './ConfirmDialog.svelte';
  import LogStream from './LogStream.svelte';

  import Cloud from '@lucide/svelte/icons/cloud';
  import Plus from '@lucide/svelte/icons/plus';
  import Play from '@lucide/svelte/icons/play';
  import Square from '@lucide/svelte/icons/square';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import ExternalLink from '@lucide/svelte/icons/external-link';
  import LoaderCircle from '@lucide/svelte/icons/loader-circle';
  import CircleAlert from '@lucide/svelte/icons/circle-alert';
  import Download from '@lucide/svelte/icons/download';
  import Link2 from '@lucide/svelte/icons/link-2';

  let { data } = $props();

  let busy = $state(null);
  let installing = $state(false);
  let installLines = $state([]);

  let createOpen = $state(false);
  let kind = $state('named');
  let form = $state({ name: '', service: 'http://localhost:3000' });

  let routeOpen = $state(false);
  let routeTarget = $state(null);
  let route = $state({ hostname: '', service: 'http://localhost:3000' });

  let confirmOpen = $state(false);
  let confirmState = $state({ title: '', description: '', label: '', action: null });

  const ready = $derived(data.cloudflare.connected && data.binary.installed);

  const appTargets = $derived(
    live.apps
      .map((a) => {
        const port = a.env?.PORT;
        return port ? { name: a.name, service: `http://localhost:${port}` } : null;
      })
      .filter(Boolean),
  );

  async function installBinary() {
    installing = true;
    installLines = [];
    try {
      await streamPost('/api/tunnels/install', {}, (event, payload) => {
        if (event === 'line') installLines = [...installLines, payload];
      });
      toasts.ok('cloudflared installed');
      await invalidateAll();
    } finally {
      installing = false;
    }
  }

  async function act(id, action, body = {}) {
    busy = id;
    try {
      await api('/api/tunnels', { action, id, ...body });
      await invalidateAll();
    } finally {
      busy = null;
    }
  }

  async function create() {
    busy = 'create';
    try {
      const action = kind === 'quick' ? 'create-quick' : 'create';
      const payload =
        kind === 'quick'
          ? { name: form.name.trim(), service: form.service.trim() }
          : { name: form.name.trim() };
      await api('/api/tunnels', { action, ...payload });
      toasts.ok('Tunnel created', form.name);
      createOpen = false;
      await invalidateAll();
    } finally {
      busy = null;
    }
  }

  function openRoute(tunnel) {
    routeTarget = tunnel;
    route = { hostname: '', service: 'http://localhost:3000' };
    routeOpen = true;
  }

  async function addRoute() {
    busy = routeTarget.id;
    try {
      await api('/api/tunnels', {
        action: 'add-route',
        id: routeTarget.id,
        hostname: route.hostname.trim(),
        service: route.service.trim(),
      });
      toasts.ok('Route added', route.hostname);
      routeOpen = false;
      await invalidateAll();
    } finally {
      busy = null;
    }
  }

  function askRemoveRoute(tunnel, r) {
    confirmState = {
      title: `Remove ${r.hostname}?`,
      description: `The ingress rule is removed from the tunnel and its DNS record is deleted from Cloudflare. ${r.hostname} stops resolving.`,
      label: 'Remove route',
      action: async () => {
        await api('/api/tunnels', { action: 'remove-route', routeId: r.id });
        await invalidateAll();
      },
    };
    confirmOpen = true;
  }

  function askDelete(tunnel) {
    confirmState = {
      title: `Delete ${tunnel.name}?`,
      description: `The connector stops, the tunnel is deleted from Cloudflare, and every hostname routed through it (${tunnel.routes.map((r) => r.hostname).join(', ') || 'none'}) stops resolving.`,
      label: 'Delete tunnel',
      action: async () => {
        await api('/api/tunnels', { action: 'delete', id: tunnel.id });
        toasts.ok('Tunnel deleted', tunnel.name);
        await invalidateAll();
      },
    };
    confirmOpen = true;
  }
</script>

{#if !data.cloudflare.connected}
  <Alert.Root>
    <CircleAlert class="size-4" />
    <Alert.Description class="space-y-2 text-xs">
      <p>{data.cloudflare.reason ?? 'Cloudflare is not connected.'}</p>
      <Button variant="outline" size="sm" class="h-7" href="/settings?tab=cloudflare">Add a token</Button>
    </Alert.Description>
  </Alert.Root>
{/if}

{#if !data.binary.installed}
  <div class="panel space-y-3 rounded-2xl p-4.5">
    <div class="flex flex-wrap items-center gap-3">
      <div class="min-w-0 flex-1">
        <p class="text-[14px] font-semibold">cloudflared is not installed</p>
        <p class="text-muted-foreground mt-0.5 text-[12px]">
          The connector that holds the outbound link to Cloudflare. Downloads into
          <code class="font-mono">~/.local/bin</code> — no sudo.
        </p>
      </div>
      <Button
        size="sm"
        class="accent-fill h-8.5 rounded-xl px-4 font-semibold"
        disabled={installing}
        onclick={installBinary}
      >
        {#if installing}<LoaderCircle class="size-3.5 animate-spin" />{:else}<Download class="size-3.5" />{/if}
        {installing ? 'Installing…' : 'Install'}
      </Button>
    </div>
    {#if installLines.length}
      <LogStream lines={installLines} height="200px" />
    {/if}
  </div>
{:else}
  <div class="text-muted-foreground flex flex-wrap items-center gap-2 font-mono text-[10.5px]">
    <span class="dot text-ok"></span>
    <span>{data.binary.version}</span>
    <span class="ml-auto">{data.binary.path}</span>
  </div>
{/if}

<div class="flex items-center gap-2.5">
  <span class="eyebrow">Tunnels</span>
  <span class="text-muted-foreground ml-auto font-mono text-[10.5px]">
    {data.tunnels.filter((t) => t.running).length} of {data.tunnels.length} running
  </span>
  <Button
    size="sm"
    class="accent-fill h-8 rounded-xl px-3 font-semibold"
    disabled={!ready}
    onclick={() => ((form = { name: '', service: 'http://localhost:3000' }), (kind = 'named'), (createOpen = true))}
  >
    <Plus class="size-3.5" /> New tunnel
  </Button>
</div>

{#if !data.tunnels.length}
  <div class="panel flex flex-col items-center gap-3 rounded-2xl px-6 py-14 text-center">
    <div class="panel grid size-12 place-items-center rounded-full">
      <Cloud class="text-muted-foreground size-5" />
    </div>
    <div>
      <p class="font-semibold">Nothing exposed</p>
      <p class="text-muted-foreground mx-auto mt-1 max-w-md text-sm">
        A tunnel publishes an app on this machine to the internet without opening a single inbound
        port. Cloudflare reaches in; nothing reaches back.
      </p>
    </div>
  </div>
{:else}
  <div class="space-y-3">
    {#each data.tunnels as t (t.id)}
      <div class="panel-raised space-y-3.5 rounded-2xl p-4.5">
        <div class="flex flex-wrap items-center gap-3">
          <div
            class={cn(
              'grid size-9.5 shrink-0 place-items-center rounded-xl',
              t.running ? 'bg-ok/14 text-ok' : 'bg-foreground/6 text-foreground/60',
            )}
          >
            <Cloud class="size-5" />
          </div>
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <p class="truncate text-[14.5px] font-semibold">{t.name}</p>
              <Badge variant="outline" class="font-mono text-[10px]">{t.kind}</Badge>
            </div>
            <p class="text-muted-foreground mt-0.5 flex items-center gap-1.5 font-mono text-[10.5px]">
              <span class="dot" style="color:{t.running ? 'var(--ok)' : 'var(--idle)'}"></span>
              {t.running ? 'connected' : 'stopped'}
              {#if t.quickUrl}· <a href={t.quickUrl} target="_blank" rel="noreferrer" class="underline">{t.quickUrl}</a>{/if}
            </p>
          </div>

          <div class="flex flex-wrap items-center gap-1.5">
            {#if t.kind === 'named'}
              <Button
                variant="ghost"
                size="sm"
                class="panel h-8 rounded-lg px-2.5"
                disabled={busy === t.id}
                onclick={() => openRoute(t)}
              >
                <Link2 class="size-3.5" /> Route
              </Button>
            {/if}
            <Button
              variant="ghost"
              size="icon"
              class="panel size-8 rounded-lg"
              disabled={busy === t.id}
              onclick={() => act(t.id, t.running ? 'stop' : 'start')}
            >
              {#if busy === t.id}
                <LoaderCircle class="size-3.5 animate-spin" />
              {:else if t.running}
                <Square class="size-3.5" />
              {:else}
                <Play class="size-3.5" />
              {/if}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              class="bg-bad/10 text-bad hover:bg-bad/20 hover:text-bad size-8 rounded-lg"
              onclick={() => askDelete(t)}
            >
              <Trash2 class="size-3.5" />
            </Button>
          </div>
        </div>

        {#if t.routes.length}
          <div class="space-y-1.5">
            {#each t.routes as r (r.id)}
              <div class="panel flex flex-wrap items-center gap-2.5 rounded-xl px-3 py-2">
                <a
                  href="https://{r.hostname}"
                  target="_blank"
                  rel="noreferrer"
                  class="flex min-w-0 items-center gap-1.5 font-mono text-[12px] hover:underline"
                >
                  {r.hostname}
                  <ExternalLink class="text-muted-foreground size-3 shrink-0" />
                </a>
                <span class="text-muted-foreground font-mono text-[10.5px]">→ {r.service}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  class="hover:text-bad ml-auto size-7 rounded-lg"
                  onclick={() => askRemoveRoute(t, r)}
                >
                  <Trash2 class="size-3" />
                </Button>
              </div>
            {/each}
          </div>
        {:else if t.kind === 'named'}
          <p class="text-muted-foreground text-[11.5px]">
            No hostnames yet — add a route to point one of your domains at an app.
          </p>
        {/if}
      </div>
    {/each}
  </div>
{/if}

<Dialog.Root bind:open={createOpen}>
  <Dialog.Content class="sm:max-w-lg">
    <Dialog.Header>
      <Dialog.Title>New tunnel</Dialog.Title>
      <Dialog.Description>
        Cloudflare connects inward to this machine. No inbound port is opened.
      </Dialog.Description>
    </Dialog.Header>

    <div class="space-y-4">
      <div class="grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          onclick={() => (kind = 'named')}
          class={cn(
            'rounded-2xl p-3.5 text-left transition-all',
            kind === 'named' ? 'accent-wash' : 'panel hover:brightness-125',
          )}
        >
          <p class="text-sm font-medium">Named</p>
          <p class="text-muted-foreground mt-0.5 text-xs">
            Your own hostnames, kept across restarts. Needs a zone on your account.
          </p>
        </button>
        <button
          type="button"
          onclick={() => (kind = 'quick')}
          class={cn(
            'rounded-2xl p-3.5 text-left transition-all',
            kind === 'quick' ? 'accent-wash' : 'panel hover:brightness-125',
          )}
        >
          <p class="text-sm font-medium">Quick</p>
          <p class="text-muted-foreground mt-0.5 text-xs">
            A throwaway trycloudflare.com URL. No account needed, no authentication.
          </p>
        </button>
      </div>

      <div class="space-y-1.5">
        <Label for="tunnel-name">Name</Label>
        <Input id="tunnel-name" bind:value={form.name} placeholder="my-site" class="font-mono text-xs" />
      </div>

      {#if kind === 'quick'}
        <div class="space-y-1.5">
          <Label for="tunnel-service">Local service</Label>
          <Input id="tunnel-service" bind:value={form.service} class="font-mono text-xs" />
          {#if appTargets.length}
            <div class="flex flex-wrap gap-1.5 pt-1">
              {#each appTargets as t (t.name)}
                <button
                  type="button"
                  onclick={() => (form.service = t.service)}
                  class="panel hover:brightness-125 rounded-lg px-2 py-1 font-mono text-[10.5px]"
                >
                  {t.name}
                </button>
              {/each}
            </div>
          {/if}
        </div>
        <Alert.Root>
          <CircleAlert class="size-4" />
          <Alert.Description class="text-xs">
            A quick tunnel has no authentication. Anyone with the URL reaches this service.
          </Alert.Description>
        </Alert.Root>
      {/if}
    </div>

    <Dialog.Footer>
      <Button variant="outline" onclick={() => (createOpen = false)}>Cancel</Button>
      <Button
        class="accent-fill rounded-xl px-4 font-semibold"
        disabled={busy === 'create' || !form.name.trim()}
        onclick={create}
      >
        {#if busy === 'create'}<LoaderCircle class="size-4 animate-spin" />{:else}<Plus class="size-4" />{/if}
        Create
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={routeOpen}>
  <Dialog.Content class="sm:max-w-lg">
    <Dialog.Header>
      <Dialog.Title>Route a hostname</Dialog.Title>
      <Dialog.Description>
        A proxied CNAME is written to Cloudflare and the ingress rule is pushed to the tunnel.
      </Dialog.Description>
    </Dialog.Header>

    <div class="space-y-4">
      <div class="space-y-1.5">
        <Label for="route-host">Hostname</Label>
        <Input id="route-host" bind:value={route.hostname} placeholder="app.example.com" class="font-mono text-xs" />
        {#if data.zones.length}
          <p class="text-muted-foreground text-[11.5px]">
            Zones on this account: {data.zones.map((z) => z.name).join(', ')}
          </p>
        {/if}
      </div>
      <div class="space-y-1.5">
        <Label for="route-service">Local service</Label>
        <Input id="route-service" bind:value={route.service} class="font-mono text-xs" />
        {#if appTargets.length}
          <div class="flex flex-wrap gap-1.5 pt-1">
            {#each appTargets as t (t.name)}
              <button
                type="button"
                onclick={() => (route.service = t.service)}
                class="panel hover:brightness-125 rounded-lg px-2 py-1 font-mono text-[10.5px]"
              >
                {t.name}
              </button>
            {/each}
          </div>
        {/if}
      </div>
    </div>

    <Dialog.Footer>
      <Button variant="outline" onclick={() => (routeOpen = false)}>Cancel</Button>
      <Button
        class="accent-fill rounded-xl px-4 font-semibold"
        disabled={!!busy || !route.hostname.trim()}
        onclick={addRoute}
      >
        <Link2 class="size-4" /> Add route
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<ConfirmDialog
  bind:open={confirmOpen}
  title={confirmState.title}
  description={confirmState.description}
  confirmLabel={confirmState.label}
  destructive
  onconfirm={confirmState.action}
/>
