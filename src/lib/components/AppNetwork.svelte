<script>
  import { invalidateAll } from '$app/navigation';
  import { api, toasts } from '$lib/live.svelte.js';
  import { cn } from '$lib/utils.js';

  import { Button } from '$lib/components/ui/button/index.js';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import * as Select from '$lib/components/ui/select/index.js';
  import * as Alert from '$lib/components/ui/alert/index.js';
  import ConfirmDialog from './ConfirmDialog.svelte';

  import Globe from '@lucide/svelte/icons/globe';
  import Cloud from '@lucide/svelte/icons/cloud';
  import Plus from '@lucide/svelte/icons/plus';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import ExternalLink from '@lucide/svelte/icons/external-link';
  import LoaderCircle from '@lucide/svelte/icons/loader-circle';
  import CircleAlert from '@lucide/svelte/icons/circle-alert';

  let { data, app } = $props();

  let open = $state(false);
  let busy = $state(false);
  let hostname = $state('');
  let tunnelId = $state('');
  let confirmOpen = $state(false);
  let removeTarget = $state(null);

  const port = $derived(data.port);
  const service = $derived(port ? `http://localhost:${port}` : null);

  const named = $derived(data.tunnels.filter((t) => t.kind === 'named'));

  const routes = $derived(
    data.tunnels.flatMap((t) =>
      t.routes
        .filter((r) => port && new RegExp(`(localhost|127\\.0\\.0\\.1):${port}\\b`).test(r.service))
        .map((r) => ({ ...r, tunnel: t })),
    ),
  );

  const ready = $derived(data.cloudflare.connected && data.binary.installed && named.length > 0);

  function openDialog() {
    hostname = '';
    tunnelId = named[0]?.id ?? '';
    open = true;
  }

  async function addRoute() {
    busy = true;
    try {
      await api('/api/tunnels', {
        action: 'add-route',
        id: tunnelId,
        hostname: hostname.trim(),
        service,
      });
      toasts.ok('Hostname routed', `${hostname.trim()} → ${service}`);
      open = false;
      await invalidateAll();
    } finally {
      busy = false;
    }
  }

  function askRemove(route) {
    removeTarget = route;
    confirmOpen = true;
  }

  async function removeRoute() {
    await api('/api/tunnels', { action: 'remove-route', routeId: removeTarget.id });
    toasts.ok('Route removed', removeTarget.hostname);
    await invalidateAll();
  }
</script>

<div class="space-y-3">
  {#if !port}
    <div class="panel flex flex-col items-center gap-3 rounded-2xl px-6 py-14 text-center">
      <div class="panel grid size-12 place-items-center rounded-full">
        <Globe class="text-muted-foreground size-5" />
      </div>
      <div>
        <p class="font-semibold">No port to expose</p>
        <p class="text-muted-foreground mx-auto mt-1 max-w-md text-sm">
          {app.name} has no <code class="font-mono">PORT</code> variable, so there is nothing for a
          hostname to point at. Set one on the Environment tab.
        </p>
      </div>
    </div>
  {:else}
    {#if routes.length}
      <div class="space-y-2">
        {#each routes as r (r.id)}
          <div class="panel-raised flex flex-wrap items-center gap-3.5 rounded-2xl p-4">
            <div
              class={cn(
                'grid size-9.5 shrink-0 place-items-center rounded-xl',
                r.tunnel.running ? 'bg-ok/14 text-ok' : 'bg-warn/14 text-warn',
              )}
            >
              <Globe class="size-5" />
            </div>
            <div class="min-w-0 flex-1">
              <a
                href="https://{r.hostname}"
                target="_blank"
                rel="noreferrer"
                class="flex items-center gap-1.5 text-[14.5px] font-semibold hover:underline"
              >
                {r.hostname}
                <ExternalLink class="text-muted-foreground size-3.5 shrink-0" />
              </a>
              <p class="text-muted-foreground mt-0.5 flex items-center gap-1.5 font-mono text-[10.5px]">
                <span class="dot" style="color:{r.tunnel.running ? 'var(--ok)' : 'var(--warn)'}"></span>
                {r.tunnel.running ? 'connected' : 'connector stopped'} · {r.tunnel.name} → {r.service}
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              class="hover:text-bad size-8 shrink-0 rounded-lg"
              onclick={() => askRemove(r)}
            >
              <Trash2 class="size-3.5" />
            </Button>
          </div>
        {/each}
      </div>
    {/if}

    {#if !data.cloudflare.connected}
      <Alert.Root>
        <CircleAlert class="size-4" />
        <Alert.Description class="space-y-2 text-xs">
          <p>{data.cloudflare.reason ?? 'Cloudflare is not connected.'}</p>
          <Button variant="outline" size="sm" class="h-7" href="/settings?tab=cloudflare">
            Add a token
          </Button>
        </Alert.Description>
      </Alert.Root>
    {:else if !data.binary.installed}
      <Alert.Root>
        <CircleAlert class="size-4" />
        <Alert.Description class="space-y-2 text-xs">
          <p>cloudflared is not installed, so no tunnel can run on this machine.</p>
          <Button variant="outline" size="sm" class="h-7" href="/network">Install it</Button>
        </Alert.Description>
      </Alert.Root>
    {:else if !named.length}
      <Alert.Root>
        <CircleAlert class="size-4" />
        <Alert.Description class="space-y-2 text-xs">
          <p>No named tunnel exists yet. One tunnel can carry every hostname on this machine.</p>
          <Button variant="outline" size="sm" class="h-7" href="/network">Create one</Button>
        </Alert.Description>
      </Alert.Root>
    {/if}

    <div class="panel flex flex-wrap items-center gap-3 rounded-2xl p-4">
      <div class="min-w-0 flex-1">
        <p class="text-[13.5px] font-medium">
          {routes.length ? 'Route another hostname' : 'Reach this app from the internet'}
        </p>
        <p class="text-muted-foreground mt-0.5 text-[11.5px]">
          Cloudflare connects inward to <code class="font-mono">{service}</code>. No inbound port is
          opened on this machine.
        </p>
      </div>
      <Button
        size="sm"
        class="accent-fill h-8.5 shrink-0 rounded-xl px-4 font-semibold"
        disabled={!ready}
        onclick={openDialog}
      >
        <Plus class="size-3.5" /> Add hostname
      </Button>
    </div>
  {/if}
</div>

<Dialog.Root bind:open>
  <Dialog.Content class="sm:max-w-lg">
    <Dialog.Header>
      <Dialog.Title>Route a hostname to {app.name}</Dialog.Title>
      <Dialog.Description>
        A proxied CNAME is written to Cloudflare and the ingress rule is pushed to the tunnel.
      </Dialog.Description>
    </Dialog.Header>

    <div class="space-y-4">
      <div class="space-y-1.5">
        <Label for="app-hostname">Hostname</Label>
        <Input
          id="app-hostname"
          bind:value={hostname}
          placeholder="app.example.com"
          spellcheck="false"
          class="font-mono text-xs"
        />
      </div>

      <div class="space-y-1.5">
        <Label>Tunnel</Label>
        <Select.Root type="single" bind:value={tunnelId}>
          <Select.Trigger>
            {named.find((t) => t.id === tunnelId)?.name ?? 'Pick a tunnel'}
          </Select.Trigger>
          <Select.Content>
            {#each named as t (t.id)}
              <Select.Item value={t.id}>{t.name}{t.running ? '' : ' (stopped)'}</Select.Item>
            {/each}
          </Select.Content>
        </Select.Root>
      </div>

      <div class="accent-wash rounded-xl p-3">
        <p class="eyebrow mb-1">Traffic will go to</p>
        <p class="font-mono text-[12px]">{service}</p>
      </div>
    </div>

    <Dialog.Footer>
      <Button variant="ghost" disabled={busy} onclick={() => (open = false)}>Cancel</Button>
      <Button
        class="accent-fill rounded-xl px-4 font-semibold"
        disabled={busy || !hostname.trim() || !tunnelId}
        onclick={addRoute}
      >
        {#if busy}<LoaderCircle class="size-4 animate-spin" />{:else}<Cloud class="size-4" />{/if}
        Add hostname
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<ConfirmDialog
  bind:open={confirmOpen}
  title="Remove {removeTarget?.hostname}?"
  description="The ingress rule is removed from the tunnel and its DNS record is deleted from Cloudflare. {removeTarget?.hostname} stops resolving. {app.name} keeps running."
  confirmLabel="Remove hostname"
  destructive
  onconfirm={removeRoute}
/>
