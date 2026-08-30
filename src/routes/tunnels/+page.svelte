<script>
  import { untrack } from 'svelte';
  import { invalidateAll } from '$app/navigation';
  import { api, apiGet, streamPost, toasts, live } from '$lib/live.svelte.js';
  import { bytes, duration, relTime } from '$lib/format.js';
  import { cn } from '$lib/utils.js';

  import * as Card from '$lib/components/ui/card/index.js';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import * as Table from '$lib/components/ui/table/index.js';
  import * as Tabs from '$lib/components/ui/tabs/index.js';
  import * as Alert from '$lib/components/ui/alert/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import { Badge } from '$lib/components/ui/badge/index.js';

  import PageHeader from '$lib/components/PageHeader.svelte';
  import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
  import LogStream from '$lib/components/LogStream.svelte';

  import Plus from '@lucide/svelte/icons/plus';
  import Cable from '@lucide/svelte/icons/cable';
  import Play from '@lucide/svelte/icons/play';
  import Square from '@lucide/svelte/icons/square';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import ExternalLink from '@lucide/svelte/icons/external-link';
  import ScrollText from '@lucide/svelte/icons/scroll-text';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import Download from '@lucide/svelte/icons/download';

  let { data } = $props();

  let installOpen = $state(false);
  let installLines = $state([]);
  let installBusy = $state(false);
  let installFilter = $state('');

  let createOpen = $state(false);
  let createMode = $state(untrack(() => (data.cloudflare.connected ? 'named' : 'quick')));
  let newName = $state('');
  let newService = $state('http://localhost:3000');

  let routeOpen = $state(false);
  let routeTunnel = $state(null);
  let routeHost = $state('');
  let routeService = $state('http://localhost:3000');
  let routePath = $state('');
  let routeBusy = $state(false);

  let adoptOpen = $state(false);
  let remoteTunnels = $state([]);

  let confirmOpen = $state(false);
  let confirmState = $state({ title: '', description: '', label: '', action: null });

  let quickUrls = $state({});

  async function pollQuickUrl(tunnel) {
    for (let i = 0; i < 12; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      try {
        const { url } = await apiGet('/api/tunnels', { op: 'quick-url', id: tunnel.id }, { quiet: true });
        if (url) {
          quickUrls = { ...quickUrls, [tunnel.id]: url };
          toasts.ok('Tunnel is live', url);
          await invalidateAll();
          return;
        }
      } catch {
      }
    }
    toasts.error('No URL yet', 'Check the tunnel log.');
  }

  async function installCloudflared() {
    installOpen = true;
    installBusy = true;
    installLines = [];
    let ok = false;
    try {
      await streamPost('/api/tunnels/install', {}, (event, payload) => {
        if (event === 'line') installLines = [...installLines, payload];
        else if (event === 'done') ok = payload.ok;
      });
    } catch (err) {
      installLines = [...installLines, { stream: 'err', line: err.message }];
    } finally {
      installBusy = false;
    }
    if (ok) {
      toasts.ok('cloudflared installed');
      await invalidateAll();
    }
  }

  async function createTunnel() {
    try {
      const body =
        createMode === 'quick'
          ? { action: 'create-quick', name: newName, service: newService }
          : { action: 'create', name: newName };
      await api('/api/tunnels', body);
      toasts.ok('Tunnel created', newName);
      createOpen = false;
      newName = '';
      await invalidateAll();
    } catch {
    }
  }

  async function openAdopt() {
    adoptOpen = true;
    try {
      remoteTunnels = await apiGet('/api/tunnels', { op: 'remote' }, { quiet: true });
    } catch (err) {
      toasts.error('Could not list Cloudflare tunnels', err.message);
    }
  }

  async function adopt(remote) {
    await api('/api/tunnels', { action: 'adopt', cfTunnelId: remote.id });
    toasts.ok('Tunnel adopted', remote.name);
    adoptOpen = false;
    await invalidateAll();
  }

  async function toggle(tunnel) {
    const action = tunnel.running ? 'stop' : 'start';
    await api('/api/tunnels', { action, id: tunnel.id });
    toasts.ok(`Tunnel ${action}ed`, tunnel.name);
    await invalidateAll();
    if (action === 'start' && tunnel.kind === 'quick') pollQuickUrl(tunnel);
  }

  function openRoute(tunnel) {
    routeTunnel = tunnel;
    routeHost = '';
    routeService = 'http://localhost:3000';
    routePath = '';
    routeOpen = true;
  }

  async function addRoute() {
    routeBusy = true;
    try {
      const res = await api('/api/tunnels', {
        action: 'add-route',
        id: routeTunnel.id,
        hostname: routeHost,
        service: routeService,
        path: routePath || undefined,
      });
      toasts.ok('Route added', `${res.hostname} → ${routeService}`);
      routeOpen = false;
      await invalidateAll();
    } catch {
    } finally {
      routeBusy = false;
    }
  }

  function askRemoveRoute(route) {
    confirmState = {
      title: `Remove ${route.hostname}?`,
      description:
        'This deletes the ingress rule and its Cloudflare DNS record. The local app keeps running.',
      label: 'Remove route',
      action: async () => {
        await api('/api/tunnels', { action: 'remove-route', routeId: route.id });
        toasts.ok('Route removed', route.hostname);
        await invalidateAll();
      },
    };
    confirmOpen = true;
  }

  function askDelete(tunnel) {
    confirmState = {
      title: `Delete ${tunnel.name}?`,
      description: `This stops the connector, removes every DNS record it created${
        tunnel.kind === 'named' ? ', and deletes the tunnel from Cloudflare' : ''
      }. Anything published through it stops being reachable.`,
      label: 'Delete tunnel',
      action: async () => {
        await api('/api/tunnels', { action: 'delete', id: tunnel.id });
        toasts.ok('Tunnel deleted', tunnel.name);
        await invalidateAll();
      },
    };
    confirmOpen = true;
  }

  const runningApps = $derived(live.apps.filter((a) => a.status === 'online').map((a) => a.name));
</script>

<svelte:head><title>Tunnels · {data.host?.hostname}</title></svelte:head>

<PageHeader title="Tunnels">
  {#snippet children()}
    <Badge variant="outline">{data.tunnels.length}</Badge>
    {#if data.binary.installed}
      <Badge variant="outline" class="border-ok/40 text-ok gap-1.5">
        <span class="size-1.5 rounded-full bg-current"></span>cloudflared
      </Badge>
    {:else}
      <Badge variant="outline" class="border-warn/40 text-warn">cloudflared missing</Badge>
    {/if}
    {#if data.cloudflare.connected}
      <Badge variant="outline" class="border-info/40 text-info">
        {data.cloudflare.accountName ?? 'Cloudflare'}
      </Badge>
    {/if}
  {/snippet}
  {#snippet actions()}
    {#if data.cloudflare.connected}
      <Button variant="outline" size="sm" onclick={openAdopt}>Adopt existing</Button>
    {/if}
    <Button size="sm" disabled={!data.binary.installed} onclick={() => (createOpen = true)}>
      <Plus class="size-4" /> New tunnel
    </Button>
  {/snippet}
</PageHeader>

<div class="flex-1 space-y-4 p-5">
  {#if !data.binary.installed}
    <Card.Root>
      <Card.Header>
        <Card.Title class="text-base">cloudflared is not installed</Card.Title>
        <Card.Description>
          Cloudflare Tunnel exposes a local app to the internet without opening a port on your router
          or firewall — the connector dials out, so nothing inbound is needed.
        </Card.Description>
      </Card.Header>
      <Card.Content class="space-y-3">
        <div class="flex flex-wrap items-center gap-3">
          <Button size="sm" onclick={installCloudflared}>
            <Download class="size-4" /> Install cloudflared
          </Button>
          <span class="text-muted-foreground text-xs">
            downloads the {data.binary.installHint?.arch} binary into ~/.local/bin — no sudo
          </span>
        </div>
        <details class="text-sm">
          <summary class="text-muted-foreground cursor-pointer text-xs">Prefer to install it yourself?</summary>
          <pre class="bg-muted/40 mt-2 overflow-auto rounded-md border p-3 font-mono text-xs">{data.binary
              .installHint?.deb}</pre>
        </details>
      </Card.Content>
    </Card.Root>
  {/if}

  {#if !data.cloudflare.connected}
    <Alert.Root>
      <TriangleAlert class="size-4" />
      <Alert.Description>
        No Cloudflare API token configured, so only <strong>quick tunnels</strong> are available: a random
        <code class="font-mono text-xs">*.trycloudflare.com</code> URL, no account needed.
        <a href="/settings" class="underline">Add a token</a> to use your own domains.
      </Alert.Description>
    </Alert.Root>
  {/if}

  {#if !data.tunnels.length}
    <Card.Root>
      <div class="flex flex-col items-center gap-3 px-6 py-16 text-center">
        <div class="bg-muted grid size-11 place-items-center rounded-full">
          <Cable class="text-muted-foreground size-5" />
        </div>
        <div>
          <h3 class="font-medium">No tunnels yet</h3>
          <p class="text-muted-foreground mt-1 text-sm">
            Publish a local app to the internet without opening any inbound ports.
          </p>
        </div>
        <Button size="sm" disabled={!data.binary.installed} onclick={() => (createOpen = true)}>
          <Plus class="size-4" /> Create a tunnel
        </Button>
      </div>
    </Card.Root>
  {:else}
    {#each data.tunnels as t (t.id)}
      <Card.Root class="gap-0 py-0">
        <Card.Header class="flex-row flex-wrap items-center gap-2 border-b py-3">
          <Card.Title class="text-base">{t.name}</Card.Title>
          <Badge variant={t.kind === 'quick' ? 'secondary' : 'outline'} class={t.kind === 'named' ? 'border-info/40 text-info' : ''}>
            {t.kind}
          </Badge>
          <Badge
            variant="outline"
            class={cn('gap-1.5', t.running ? 'border-ok/40 text-ok' : 'text-muted-foreground')}
          >
            <span class="size-1.5 rounded-full bg-current"></span>
            {t.running ? 'connected' : (t.lastStatus ?? 'stopped')}
          </Badge>
          {#if t.process}
            <Badge variant="outline" class="tabular">{t.process.cpu}% · {bytes(t.process.memory)}</Badge>
            <Badge variant="outline" class="tabular">up {duration(t.process.uptime)}</Badge>
          {/if}
          <div class="ml-auto flex flex-wrap gap-1.5">
            {#if t.process}
              <Button variant="ghost" size="sm" class="h-7 px-2" href="/apps/{t.process.pmId}">
                <ScrollText class="size-3.5" />
              </Button>
            {/if}
            <Button variant="outline" size="sm" class="h-7" onclick={() => toggle(t)}>
              {#if t.running}<Square class="size-3.5" /> Stop{:else}<Play class="size-3.5" /> Start{/if}
            </Button>
            {#if t.kind === 'named'}
              <Button variant="outline" size="sm" class="h-7" onclick={() => openRoute(t)}>
                <Plus class="size-3.5" /> Route
              </Button>
            {/if}
            <Button
              variant="ghost"
              size="sm"
              class="text-bad hover:text-bad hover:bg-bad/10 h-7 px-2"
              onclick={() => askDelete(t)}
            >
              <Trash2 class="size-3.5" />
            </Button>
          </div>
        </Card.Header>

        {#if t.kind === 'quick'}
          {@const url = quickUrls[t.id] ?? t.quickUrl}
          <Card.Content class="space-y-1 py-4">
            {#if url}
              <div class="flex items-center gap-2 text-sm">
                <span class="text-muted-foreground">Public URL</span>
                <a href={url} target="_blank" rel="noreferrer" class="font-mono hover:underline">{url}</a>
                <ExternalLink class="text-muted-foreground size-3" />
              </div>
            {:else if t.running}
              <p class="text-muted-foreground text-sm">Waiting for Cloudflare to assign a URL…</p>
            {:else}
              <p class="text-muted-foreground text-sm">Start the tunnel to get a public URL.</p>
            {/if}
            <p class="text-muted-foreground text-xs">
              Forwards to <code class="font-mono">{t.routes[0]?.service}</code>
            </p>
          </Card.Content>
        {:else if !t.routes.length}
          <div class="flex flex-col items-center gap-3 py-10 text-center">
            <p class="text-muted-foreground text-sm">No hostnames routed yet.</p>
            <Button size="sm" onclick={() => openRoute(t)}>Add a route</Button>
          </div>
        {:else}
          <Table.Root>
            <Table.Header>
              <Table.Row class="hover:bg-transparent">
                <Table.Head>Public hostname</Table.Head>
                <Table.Head class="w-24">Path</Table.Head>
                <Table.Head>Local service</Table.Head>
                <Table.Head class="w-20">DNS</Table.Head>
                <Table.Head class="w-24"></Table.Head>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {#each t.routes as r (r.id)}
                <Table.Row>
                  <Table.Cell>
                    <a href="https://{r.hostname}" target="_blank" rel="noreferrer" class="hover:underline">
                      {r.hostname}
                    </a>
                  </Table.Cell>
                  <Table.Cell class="text-muted-foreground text-xs">{r.path ?? '/*'}</Table.Cell>
                  <Table.Cell class="font-mono text-xs">{r.service}</Table.Cell>
                  <Table.Cell>
                    {#if r.dnsRecordId}
                      <Badge variant="outline" class="border-ok/40 text-ok text-[10px]">CNAME</Badge>
                    {:else}
                      <Badge variant="outline" class="border-warn/40 text-warn text-[10px]">none</Badge>
                    {/if}
                  </Table.Cell>
                  <Table.Cell class="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      class="text-bad hover:text-bad hover:bg-bad/10 h-7 px-2"
                      onclick={() => askRemoveRoute(r)}
                    >
                      <Trash2 class="size-3.5" />
                    </Button>
                  </Table.Cell>
                </Table.Row>
              {/each}
            </Table.Body>
          </Table.Root>
        {/if}
      </Card.Root>
    {/each}
  {/if}
</div>

<Dialog.Root bind:open={createOpen}>
  <Dialog.Content>
    <Dialog.Header>
      <Dialog.Title>New tunnel</Dialog.Title>
    </Dialog.Header>

    <Tabs.Root bind:value={createMode}>
      <Tabs.List class="w-full">
        <Tabs.Trigger value="quick" class="flex-1">Quick</Tabs.Trigger>
        <Tabs.Trigger value="named" class="flex-1" disabled={!data.cloudflare.connected}>Named</Tabs.Trigger>
      </Tabs.List>
    </Tabs.Root>

    <div class="space-y-4">
      <div class="space-y-2">
        <Label for="tunnel-name">Name</Label>
        <Input
          id="tunnel-name"
          bind:value={newName}
          placeholder={createMode === 'quick' ? 'demo-share' : 'home-server'}
        />
      </div>

      {#if createMode === 'quick'}
        <div class="space-y-2">
          <Label for="tunnel-service">Local app to expose</Label>
          <Input id="tunnel-service" bind:value={newService} placeholder="http://localhost:3000" />
          {#if runningApps.length}
            <p class="text-muted-foreground text-xs">Running now: {runningApps.join(', ')}</p>
          {/if}
        </div>
        <Alert.Root variant="destructive">
          <TriangleAlert class="size-4" />
          <Alert.Description class="text-xs">
            A quick tunnel makes this app <strong>publicly reachable by anyone with the URL</strong>, with
            no authentication in front of it. The URL changes each time it starts.
          </Alert.Description>
        </Alert.Root>
      {:else}
        <Alert.Root>
          <Alert.Description class="text-xs">
            A named tunnel is created in your Cloudflare account and persists across restarts. You then
            map hostnames from your own domains to local apps, and this panel creates the DNS records.
          </Alert.Description>
        </Alert.Root>
      {/if}
    </div>

    <Dialog.Footer>
      <Button variant="outline" onclick={() => (createOpen = false)}>Cancel</Button>
      <Button disabled={!newName.trim()} onclick={createTunnel}>Create</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={routeOpen}>
  <Dialog.Content>
    <Dialog.Header>
      <Dialog.Title>Route a hostname</Dialog.Title>
      <Dialog.Description>Point a public hostname at a local app.</Dialog.Description>
    </Dialog.Header>
    <div class="space-y-4">
      <div class="space-y-2">
        <Label for="route-host">Public hostname</Label>
        <Input id="route-host" bind:value={routeHost} placeholder="app.example.com" />
      </div>
      <div class="space-y-2">
        <Label for="route-service">Local service</Label>
        <Input id="route-service" bind:value={routeService} placeholder="http://localhost:3000" />
      </div>
      <div class="space-y-2">
        <Label for="route-path">Path <span class="text-muted-foreground">(optional)</span></Label>
        <Input id="route-path" bind:value={routePath} placeholder="/api/* — blank matches everything" />
      </div>
      <Alert.Root>
        <Alert.Description class="text-xs">
          The hostname's zone must already be in this Cloudflare account. A proxied CNAME pointing at
          the tunnel is created automatically, and removed if you delete the route.
        </Alert.Description>
      </Alert.Root>
    </div>
    <Dialog.Footer>
      <Button variant="outline" onclick={() => (routeOpen = false)}>Cancel</Button>
      <Button disabled={routeBusy || !routeHost.trim()} onclick={addRoute}>
        {routeBusy ? 'Adding…' : 'Add route'}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={adoptOpen}>
  <Dialog.Content class="sm:max-w-2xl">
    <Dialog.Header>
      <Dialog.Title>Adopt an existing tunnel</Dialog.Title>
      <Dialog.Description>Tunnels already in your Cloudflare account.</Dialog.Description>
    </Dialog.Header>
    {#if !remoteTunnels.length}
      <p class="text-muted-foreground py-10 text-center text-sm">No tunnels found in this account.</p>
    {:else}
      <Table.Root>
        <Table.Header>
          <Table.Row class="hover:bg-transparent">
            <Table.Head>Name</Table.Head>
            <Table.Head class="w-24">Status</Table.Head>
            <Table.Head class="w-24 text-right">Conns</Table.Head>
            <Table.Head class="w-24">Created</Table.Head>
            <Table.Head class="w-28"></Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {#each remoteTunnels as r (r.id)}
            {@const known = data.tunnels.some((t) => t.cfTunnelId === r.id)}
            <Table.Row>
              <Table.Cell class="font-medium">{r.name}</Table.Cell>
              <Table.Cell>
                <Badge variant="outline" class={r.status === 'healthy' ? 'border-ok/40 text-ok' : ''}>
                  {r.status}
                </Badge>
              </Table.Cell>
              <Table.Cell class="tabular text-right">{r.connections}</Table.Cell>
              <Table.Cell class="text-muted-foreground text-xs">{relTime(r.createdAt)}</Table.Cell>
              <Table.Cell class="text-right">
                {#if known}
                  <Badge variant="outline" class="border-ok/40 text-ok">managed</Badge>
                {:else}
                  <Button size="sm" class="h-7" onclick={() => adopt(r)}>Adopt</Button>
                {/if}
              </Table.Cell>
            </Table.Row>
          {/each}
        </Table.Body>
      </Table.Root>
    {/if}
  </Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={installOpen}>
  <Dialog.Content class="sm:max-w-3xl">
    <Dialog.Header>
      <Dialog.Title>Installing cloudflared</Dialog.Title>
      <Dialog.Description>{installBusy ? 'Downloading…' : 'Finished'}</Dialog.Description>
    </Dialog.Header>
    <LogStream lines={installLines} bind:filter={installFilter} height="40vh" />
    <Dialog.Footer>
      <Button variant="outline" disabled={installBusy} onclick={() => (installOpen = false)}>Close</Button>
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
