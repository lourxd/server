<script>
  import { onMount, untrack } from 'svelte';
  import { api, apiGet, toasts } from '$lib/live.svelte.js';
  import { cn } from '$lib/utils.js';

  import * as Card from '$lib/components/ui/card/index.js';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import * as Table from '$lib/components/ui/table/index.js';
  import * as Select from '$lib/components/ui/select/index.js';
  import * as Alert from '$lib/components/ui/alert/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { Checkbox } from '$lib/components/ui/checkbox/index.js';

  import PageHeader from '$lib/components/PageHeader.svelte';
  import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';

  import Plus from '@lucide/svelte/icons/plus';
  import Search from '@lucide/svelte/icons/search';
  import Globe from '@lucide/svelte/icons/globe';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import Pencil from '@lucide/svelte/icons/pencil';
  import RadioTower from '@lucide/svelte/icons/radio-tower';
  import RefreshCcw from '@lucide/svelte/icons/refresh-ccw';
  import CircleAlert from '@lucide/svelte/icons/circle-alert';

  let { data } = $props();

  let zoneId = $state(untrack(() => data.zones[0]?.id ?? null));
  let records = $state([]);
  let loading = $state(false);
  let loadError = $state('');
  let filter = $state('');
  let typeFilter = $state('all');

  let editOpen = $state(false);
  let editing = $state(null);
  let saving = $state(false);
  let formError = $state('');

  let confirmOpen = $state(false);
  let confirmState = $state({ title: '', description: '', label: '', action: null });

  let checks = $state({});

  const zone = $derived(data.zones.find((z) => z.id === zoneId) ?? null);

  const shown = $derived(
    records.filter((r) => {
      if (typeFilter !== 'all' && r.type !== typeFilter) return false;
      if (!filter) return true;
      const q = filter.toLowerCase();
      return r.name.toLowerCase().includes(q) || r.content.toLowerCase().includes(q);
    }),
  );

  const typesPresent = $derived([...new Set(records.map((r) => r.type))].sort());

  const BLANK = {
    type: 'A',
    name: '',
    content: '',
    ttl: 1,
    ttlAuto: true,
    proxied: true,
    priority: 10,
    comment: '',
  };

  async function loadRecords() {
    if (!zoneId) return;
    loading = true;
    loadError = '';
    try {
      records = await apiGet('/api/dns', { op: 'records', zoneId }, { quiet: true });
    } catch (err) {
      loadError = err.message;
      records = [];
    } finally {
      loading = false;
    }
  }

  async function selectZone(id) {
    zoneId = id;
    records = [];
    checks = {};
    await loadRecords();
  }

  function openNew() {
    editing = { ...BLANK };
    formError = '';
    editOpen = true;
  }

  function openEdit(r) {
    editing = {
      id: r.id,
      type: r.type,
      name: r.name,
      content: r.content,
      ttl: r.ttl,
      ttlAuto: r.ttlAuto,
      proxied: r.proxied,
      priority: r.priority ?? 10,
      comment: r.comment ?? '',
    };
    formError = '';
    editOpen = true;
  }

  async function useThisServer() {
    try {
      const { ip } = await apiGet('/api/dns', { op: 'public-ip' }, { quiet: true });
      if (!ip) throw new Error('Could not determine this server’s public IP.');
      editing.content = ip;
      editing.type = ip.includes(':') ? 'AAAA' : 'A';
    } catch (err) {
      toasts.error('Could not detect public IP', err.message);
    }
  }

  async function save() {
    saving = true;
    formError = '';
    try {
      const payload = { zoneId, record: editing };
      if (editing.id) {
        await api('/api/dns', { action: 'update', recordId: editing.id, ...payload }, { quiet: true });
      } else {
        await api('/api/dns', { action: 'create', ...payload }, { quiet: true });
      }
      toasts.ok(editing.id ? 'Record updated' : 'Record created', editing.name);
      editOpen = false;
      await loadRecords();
    } catch (err) {
      formError = err.message;
    } finally {
      saving = false;
    }
  }

  function askDelete(r) {
    confirmState = {
      title: `Delete ${r.type} ${r.name}?`,
      description: `This removes the record from Cloudflare immediately. Anything relying on ${r.name} resolving will break.`,
      label: 'Delete record',
      action: async () => {
        await api('/api/dns', { action: 'delete', zoneId, recordId: r.id, name: r.name });
        toasts.ok('Record deleted', r.name);
        await loadRecords();
      },
    };
    confirmOpen = true;
  }

  async function check(r) {
    checks = { ...checks, [r.id]: { pending: true } };
    try {
      const res = await apiGet('/api/dns', { op: 'resolve', hostname: r.name, type: r.type }, { quiet: true });
      checks = { ...checks, [r.id]: res };
    } catch (err) {
      checks = { ...checks, [r.id]: { ok: false, error: err.message } };
    }
  }

  const proxyable = $derived(editing ? ['A', 'AAAA', 'CNAME'].includes(editing.type) : false);

  onMount(() => {
    if (zoneId) loadRecords();
  });
</script>

<svelte:head><title>DNS · {data.host?.hostname}</title></svelte:head>

<PageHeader title="DNS">
  {#snippet children()}
    {#if zone}
      <Badge variant="outline" class="border-info/40 text-info">{zone.name}</Badge>
      <Badge variant="outline">{records.length} records</Badge>
    {/if}
  {/snippet}
  {#snippet actions()}
    {#if data.zones.length}
      <div class="relative">
        <Search class="text-muted-foreground pointer-events-none absolute top-2.5 left-2.5 size-3.5" />
        <Input placeholder="Filter…" bind:value={filter} class="h-9 w-40 pl-8" />
      </div>
      <Select.Root type="single" bind:value={typeFilter}>
        <Select.Trigger class="h-9 w-28">{typeFilter === 'all' ? 'All types' : typeFilter}</Select.Trigger>
        <Select.Content>
          <Select.Item value="all">All types</Select.Item>
          {#each typesPresent as t (t)}<Select.Item value={t}>{t}</Select.Item>{/each}
        </Select.Content>
      </Select.Root>
      <Button size="sm" onclick={openNew}><Plus class="size-4" /> Record</Button>
    {/if}
  {/snippet}
</PageHeader>

<div class="flex-1 space-y-4 p-5">
  {#if !data.cloudflare.connected}
    <Card.Root>
      <div class="flex flex-col items-center gap-3 px-6 py-16 text-center">
        <div class="bg-muted grid size-11 place-items-center rounded-full">
          <Globe class="text-muted-foreground size-5" />
        </div>
        <div>
          <h3 class="font-medium">Cloudflare is not connected</h3>
          <p class="text-muted-foreground mt-1 text-sm">
            Add an API token with <strong>Zone → DNS → Edit</strong> to manage records here.
          </p>
        </div>
        <Button size="sm" href="/settings">Add a Cloudflare token</Button>
      </div>
    </Card.Root>
  {:else if !data.zones.length}
    <Card.Root>
      <div class="flex flex-col items-center gap-3 px-6 py-16 text-center">
        <h3 class="font-medium">No zones visible</h3>
        <p class="text-muted-foreground max-w-md text-sm">
          {data.zonesError ?? 'This token cannot see any active zones. Check its permissions and scope.'}
        </p>
      </div>
    </Card.Root>
  {:else}
    <div class="grid gap-4 lg:grid-cols-[14rem_1fr]">
      <Card.Root class="gap-0 self-start overflow-hidden py-0 lg:sticky lg:top-20">
        <Card.Header class="flex-row items-center gap-2 border-b py-3">
          <Card.Title class="text-sm">Zones</Card.Title>
          <Badge variant="outline" class="ml-auto">{data.zones.length}</Badge>
        </Card.Header>
        <div class="max-h-[70vh] overflow-auto">
          {#each data.zones as z (z.id)}
            <button
              type="button"
              onclick={() => selectZone(z.id)}
              class={cn(
                'flex w-full items-center gap-2 border-b px-3 py-2 text-left text-sm last:border-b-0',
                z.id === zoneId ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/50',
              )}
            >
              <span class="truncate">{z.name}</span>
              {#if z.paused}
                <Badge variant="outline" class="border-warn/40 text-warn ml-auto text-[10px]">paused</Badge>
              {/if}
            </button>
          {/each}
        </div>
      </Card.Root>

      <div class="min-w-0 space-y-3">
        {#if loadError}
          <Alert.Root variant="destructive">
            <CircleAlert class="size-4" />
            <Alert.Description>{loadError}</Alert.Description>
          </Alert.Root>
        {/if}

        <Card.Root class="gap-0 overflow-hidden py-0">
          <Card.Header class="flex-row items-center gap-3 border-b py-3">
            <Card.Title class="text-base">Records</Card.Title>
            {#if loading}<span class="text-muted-foreground text-xs">loading…</span>{/if}
            <Button variant="outline" size="sm" class="ml-auto h-8" disabled={loading} onclick={loadRecords}>
              <RefreshCcw class="size-3.5" />
            </Button>
          </Card.Header>
          <div class="max-h-[62vh] overflow-auto">
            <Table.Root>
              <Table.Header class="bg-card sticky top-0 z-10">
                <Table.Row class="hover:bg-transparent">
                  <Table.Head class="w-20">Type</Table.Head>
                  <Table.Head>Name</Table.Head>
                  <Table.Head>Value</Table.Head>
                  <Table.Head class="w-20">TTL</Table.Head>
                  <Table.Head class="w-24">Proxy</Table.Head>
                  <Table.Head class="w-40"></Table.Head>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {#each shown as r (r.id)}
                  {@const c = checks[r.id]}
                  <Table.Row>
                    <Table.Cell><Badge variant="secondary" class="text-[10px]">{r.type}</Badge></Table.Cell>
                    <Table.Cell class="max-w-56 truncate" title={r.name}>
                      {r.name}
                      {#if r.comment}
                        <p class="text-muted-foreground truncate text-xs">{r.comment}</p>
                      {/if}
                    </Table.Cell>
                    <Table.Cell class="max-w-64 font-mono text-xs" title={r.content}>
                      <div class="truncate">{r.content}</div>
                      {#if c}
                        {#if c.pending}
                          <p class="text-muted-foreground text-xs">checking…</p>
                        {:else if c.ok}
                          <p class="text-ok text-xs">resolves → {c.answers.join(', ')}</p>
                        {:else}
                          <p class="text-bad text-xs">{c.error}</p>
                        {/if}
                      {/if}
                    </Table.Cell>
                    <Table.Cell class="text-muted-foreground tabular text-xs">
                      {r.ttlAuto ? 'auto' : r.ttl}
                    </Table.Cell>
                    <Table.Cell>
                      {#if r.proxied}
                        <Badge variant="outline" class="border-info/40 text-info text-[10px]">proxied</Badge>
                      {:else if r.proxiable}
                        <Badge variant="outline" class="text-muted-foreground text-[10px]">dns only</Badge>
                      {:else}
                        <span class="text-muted-foreground text-xs">—</span>
                      {/if}
                    </Table.Cell>
                    <Table.Cell>
                      <div class="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" class="h-7 px-2" onclick={() => check(r)}>
                          <RadioTower class="size-3.5" />
                        </Button>
                        <Button variant="outline" size="sm" class="h-7 px-2" onclick={() => openEdit(r)}>
                          <Pencil class="size-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          class="text-bad hover:text-bad hover:bg-bad/10 h-7 px-2"
                          onclick={() => askDelete(r)}
                        >
                          <Trash2 class="size-3.5" />
                        </Button>
                      </div>
                    </Table.Cell>
                  </Table.Row>
                {/each}
                {#if !shown.length && !loading}
                  <Table.Row>
                    <Table.Cell colspan={6} class="text-muted-foreground py-10 text-center">
                      {records.length ? 'No record matches the filter.' : 'This zone has no records yet.'}
                    </Table.Cell>
                  </Table.Row>
                {/if}
              </Table.Body>
            </Table.Root>
          </div>
        </Card.Root>

        {#if zone}
          <Card.Root>
            <Card.Header><Card.Title class="text-base">Zone details</Card.Title></Card.Header>
            <Card.Content>
              <dl class="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[minmax(7rem,auto)_1fr]">
                <dt class="text-muted-foreground">Name</dt>
                <dd class="font-mono text-xs">{zone.name}</dd>
                <dt class="text-muted-foreground">Status</dt>
                <dd class="font-mono text-xs">{zone.status}{zone.paused ? ' (paused)' : ''}</dd>
                <dt class="text-muted-foreground">Plan</dt>
                <dd class="font-mono text-xs">{zone.plan ?? '—'}</dd>
                <dt class="text-muted-foreground">Account</dt>
                <dd class="font-mono text-xs">{zone.accountName ?? '—'}</dd>
                <dt class="text-muted-foreground">Nameservers</dt>
                <dd class="font-mono text-xs break-all">{zone.nameServers.join(', ') || '—'}</dd>
              </dl>
            </Card.Content>
          </Card.Root>
        {/if}
      </div>
    </div>
  {/if}
</div>

<Dialog.Root bind:open={editOpen}>
  <Dialog.Content class="max-h-[88vh] overflow-y-auto">
    <Dialog.Header>
      <Dialog.Title>{editing?.id ? `Edit ${editing.name}` : 'New DNS record'}</Dialog.Title>
      <Dialog.Description>{zone?.name}</Dialog.Description>
    </Dialog.Header>

    {#if editing}
      <div class="space-y-4">
        <div class="grid grid-cols-3 gap-3">
          <div class="space-y-2">
            <Label>Type</Label>
            <Select.Root type="single" bind:value={editing.type}>
              <Select.Trigger>{editing.type}</Select.Trigger>
              <Select.Content>
                {#each data.recordTypes as t (t)}<Select.Item value={t}>{t}</Select.Item>{/each}
              </Select.Content>
            </Select.Root>
          </div>
          <div class="col-span-2 space-y-2">
            <Label for="rec-name">Name</Label>
            <Input id="rec-name" bind:value={editing.name} placeholder="app.{zone?.name ?? 'example.com'}" />
          </div>
        </div>

        <div class="space-y-2">
          <div class="flex items-center justify-between">
            <Label for="rec-content">Value</Label>
            {#if editing.type === 'A' || editing.type === 'AAAA'}
              <Button variant="ghost" size="sm" class="h-6 px-2 text-xs" onclick={useThisServer}>
                use this server
              </Button>
            {/if}
          </div>
          <Input
            id="rec-content"
            bind:value={editing.content}
            placeholder={editing.type === 'CNAME' ? 'target.example.com' : '203.0.113.10'}
          />
        </div>

        {#if editing.type === 'MX' || editing.type === 'SRV'}
          <div class="space-y-2">
            <Label for="rec-priority">Priority</Label>
            <Input id="rec-priority" type="number" bind:value={editing.priority} />
          </div>
        {/if}

        <div class="flex items-end gap-3">
          <div class="flex-1 space-y-2">
            <Label for="rec-ttl">TTL</Label>
            <Input
              id="rec-ttl"
              type="number"
              bind:value={editing.ttl}
              disabled={editing.ttlAuto}
              min="60"
              max="86400"
            />
          </div>
          <div class="flex items-center gap-2 pb-2.5">
            <Checkbox id="ttl-auto" bind:checked={editing.ttlAuto} />
            <Label for="ttl-auto" class="font-normal">automatic</Label>
          </div>
        </div>

        {#if proxyable}
          <div class="flex items-center gap-2">
            <Checkbox id="proxied" bind:checked={editing.proxied} />
            <Label for="proxied" class="font-normal">Proxy through Cloudflare</Label>
          </div>
          <Alert.Root>
            <Alert.Description class="text-xs">
              {#if editing.proxied}
                Traffic goes through Cloudflare, the origin IP stays hidden and TLS is handled for you.
                Required for records pointing at a tunnel.
              {:else}
                DNS only: the record resolves straight to this address, exposing the origin IP.
              {/if}
            </Alert.Description>
          </Alert.Root>
        {/if}

        <div class="space-y-2">
          <Label for="rec-comment">Comment <span class="text-muted-foreground">(optional)</span></Label>
          <Input id="rec-comment" bind:value={editing.comment} placeholder="why this record exists" />
        </div>

        {#if formError}
          <Alert.Root variant="destructive">
            <CircleAlert class="size-4" />
            <Alert.Description>{formError}</Alert.Description>
          </Alert.Root>
        {/if}
      </div>
    {/if}

    <Dialog.Footer>
      <Button variant="outline" onclick={() => (editOpen = false)}>Cancel</Button>
      <Button disabled={saving || !editing?.name || !editing?.content} onclick={save}>
        {saving ? 'Saving…' : editing?.id ? 'Update' : 'Create'}
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
