<script>
  import { onMount } from 'svelte';
  import { api, apiGet, toasts } from '$lib/live.svelte.js';
  import { cn } from '$lib/utils.js';

  import { Button } from '$lib/components/ui/button/index.js';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import { Checkbox } from '$lib/components/ui/checkbox/index.js';
  import * as Table from '$lib/components/ui/table/index.js';
  import * as Select from '$lib/components/ui/select/index.js';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import * as Alert from '$lib/components/ui/alert/index.js';
  import ConfirmDialog from './ConfirmDialog.svelte';

  import Globe from '@lucide/svelte/icons/globe';
  import Plus from '@lucide/svelte/icons/plus';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import Pencil from '@lucide/svelte/icons/pencil';
  import RefreshCcw from '@lucide/svelte/icons/refresh-ccw';
  import Search from '@lucide/svelte/icons/search';
  import LoaderCircle from '@lucide/svelte/icons/loader-circle';
  import CircleAlert from '@lucide/svelte/icons/circle-alert';
  import ShieldCheck from '@lucide/svelte/icons/shield-check';
  import { RECORD_TYPES as TYPES, isProxyable } from '$lib/dns-records.js';



  let { data } = $props();

  let zoneId = $state(data.zones[0]?.id ?? '');
  let records = $state([]);
  let loading = $state(false);
  let filter = $state('');

  let editOpen = $state(false);
  let editing = $state(null);
  let form = $state({ type: 'A', name: '', content: '', ttl: 1, proxied: true });

  let checking = $state(null);
  let checked = $state({});

  let confirmOpen = $state(false);
  let confirmState = $state({ title: '', description: '', label: '', action: null });

  let lookupName = $state('');
  let lookupType = $state('A');
  let lookupBusy = $state(false);
  let lookupResult = $state(null);

  async function lookup() {
    const hostname = lookupName.trim();
    if (!hostname) return;
    lookupBusy = true;
    lookupResult = null;
    try {
      lookupResult = await apiGet('/api/dns', { op: 'resolve', hostname, type: lookupType });
    } catch (err) {
      lookupResult = { ok: false, reason: err.message };
    } finally {
      lookupBusy = false;
    }
  }

  const zone = $derived(data.zones.find((z) => z.id === zoneId) ?? null);
  const shown = $derived(
    filter
      ? records.filter(
          (r) =>
            r.name.toLowerCase().includes(filter.toLowerCase()) ||
            r.content.toLowerCase().includes(filter.toLowerCase()),
        )
      : records,
  );

  onMount(() => {
    if (zoneId) loadRecords();
  });

  async function loadRecords() {
    if (!zoneId) return;
    loading = true;
    try {
      records = await apiGet('/api/dns', { op: 'records', zoneId });
    } catch {
      records = [];
    } finally {
      loading = false;
    }
  }

  function onZoneChange(next) {
    zoneId = next;
    checked = {};
    loadRecords();
  }

  function openNew() {
    editing = null;
    form = { type: 'A', name: '', content: '', ttl: 1, proxied: true };
    editOpen = true;
  }

  function openEdit(r) {
    editing = r;
    form = { type: r.type, name: r.name, content: r.content, ttl: r.ttl, proxied: r.proxied };
    editOpen = true;
  }

  async function save() {
    const payload = {
      zoneId,
      type: form.type,
      name: form.name.trim(),
      content: form.content.trim(),
      ttl: Number(form.ttl) || 1,
      proxied: isProxyable(form.type) ? form.proxied : false,
    };
    await api('/api/dns', editing ? { action: 'update', recordId: editing.id, ...payload } : { action: 'create', ...payload });
    toasts.ok(editing ? 'Record updated' : 'Record created', payload.name);
    editOpen = false;
    await loadRecords();
  }

  function askDelete(r) {
    confirmState = {
      title: `Delete ${r.type} ${r.name}?`,
      description: `${r.name} stops resolving through Cloudflare. Anything pointing at it breaks until the record is recreated or DNS caches expire.`,
      label: 'Delete record',
      action: async () => {
        await api('/api/dns', { action: 'delete', zoneId, recordId: r.id });
        await loadRecords();
      },
    };
    confirmOpen = true;
  }

  async function check(r) {
    checking = r.id;
    try {
      checked = { ...checked, [r.id]: await apiGet('/api/dns', { op: 'resolve', hostname: r.name, type: r.type }) };
    } finally {
      checking = null;
    }
  }
</script>

<div class="panel-raised space-y-3 rounded-2xl p-4.5">
  <div class="flex items-baseline gap-2">
    <span class="eyebrow">Lookup</span>
    <span class="text-muted-foreground ml-auto font-mono text-[10.5px]">1.1.1.1 · 8.8.8.8</span>
  </div>

  <div class="flex flex-wrap items-center gap-2">
    <Input
      bind:value={lookupName}
      onkeydown={(e) => e.key === 'Enter' && lookup()}
      placeholder="example.com"
      spellcheck="false"
      class="h-8.5 flex-1 rounded-xl font-mono text-[12px]"
    />
    <Select.Root type="single" bind:value={lookupType}>
      <Select.Trigger class="h-8.5 w-24 rounded-xl">{lookupType}</Select.Trigger>
      <Select.Content>
        {#each TYPES as t (t)}<Select.Item value={t}>{t}</Select.Item>{/each}
      </Select.Content>
    </Select.Root>
    <Button
      size="sm"
      class="accent-fill h-8.5 rounded-xl px-4 font-semibold"
      disabled={lookupBusy || !lookupName.trim()}
      onclick={lookup}
    >
      {#if lookupBusy}<LoaderCircle class="size-3.5 animate-spin" />{:else}<Search class="size-3.5" />{/if}
      Resolve
    </Button>
  </div>

  {#if lookupResult}
    <div class="panel rounded-xl p-3">
      {#if lookupResult.ok}
        <p class="text-muted-foreground mb-1.5 font-mono text-[10.5px]">
          {lookupResult.answers.length} answer{lookupResult.answers.length === 1 ? '' : 's'} in {lookupResult.durationMs}ms
        </p>
        <div class="space-y-0.5">
          {#each lookupResult.answers as a, i (i)}
            <p class="font-mono text-[12px] break-all">{a}</p>
          {/each}
        </div>
      {:else}
        <p class="text-bad font-mono text-[12px]">{lookupResult.reason ?? 'No answer.'}</p>
      {/if}
    </div>
  {:else}
    <p class="text-muted-foreground text-[11.5px]">
      Resolves against public resolvers, so it works for any domain — no Cloudflare account
      involved, and it shows what the internet sees rather than what a provider has stored.
    </p>
  {/if}
</div>

{#if !data.cloudflare.connected}
  <Alert.Root>
    <CircleAlert class="size-4" />
    <Alert.Description class="space-y-2 text-xs">
      <p>{data.cloudflare.reason ?? 'Cloudflare is not connected.'}</p>
      <Button variant="outline" size="sm" class="h-7" href="/settings?tab=cloudflare">Add a token</Button>
    </Alert.Description>
  </Alert.Root>
{:else if !data.zones.length}
  <div class="panel flex flex-col items-center gap-3 rounded-2xl px-6 py-14 text-center">
    <div class="panel grid size-12 place-items-center rounded-full">
      <Globe class="text-muted-foreground size-5" />
    </div>
    <div>
      <p class="font-semibold">No zones</p>
      <p class="text-muted-foreground mt-1 text-sm">
        This token can reach Cloudflare but sees no active zones. It needs Zone → Zone → Read.
      </p>
    </div>
  </div>
{:else}
  <div class="flex flex-wrap items-center gap-2.5">
    <Select.Root type="single" value={zoneId} onValueChange={onZoneChange}>
      <Select.Trigger class="h-8.5 w-56 rounded-xl">{zone?.name ?? 'Pick a zone'}</Select.Trigger>
      <Select.Content>
        {#each data.zones as z (z.id)}
          <Select.Item value={z.id}>{z.name}</Select.Item>
        {/each}
      </Select.Content>
    </Select.Root>

    <div class="relative">
      <Search class="text-muted-foreground pointer-events-none absolute top-2.5 left-2.5 size-3.5" />
      <Input placeholder="Filter records…" bind:value={filter} class="h-8.5 w-52 rounded-xl pl-8" />
    </div>

    <span class="text-muted-foreground ml-auto font-mono text-[10.5px]">{records.length} records</span>

    <Button variant="ghost" size="icon" class="panel size-8.5 rounded-xl" disabled={loading} onclick={loadRecords}>
      {#if loading}<LoaderCircle class="size-3.5 animate-spin" />{:else}<RefreshCcw class="size-3.5" />{/if}
    </Button>
    <Button size="sm" class="accent-fill h-8.5 rounded-xl px-3 font-semibold" onclick={openNew}>
      <Plus class="size-3.5" /> Record
    </Button>
  </div>

  <div class="panel overflow-hidden rounded-2xl">
    <div class="overflow-x-auto">
      <Table.Root>
        <Table.Header>
          <Table.Row class="hover:bg-transparent">
            <Table.Head class="w-20">Type</Table.Head>
            <Table.Head>Name</Table.Head>
            <Table.Head>Content</Table.Head>
            <Table.Head class="w-24">TTL</Table.Head>
            <Table.Head class="w-24">Proxy</Table.Head>
            <Table.Head class="w-32 text-right">Resolves</Table.Head>
            <Table.Head class="w-24"></Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {#each shown as r (r.id)}
            {@const res = checked[r.id]}
            <Table.Row>
              <Table.Cell><Badge variant="outline" class="font-mono text-[10px]">{r.type}</Badge></Table.Cell>
              <Table.Cell class="font-mono text-xs">{r.name}</Table.Cell>
              <Table.Cell class="text-muted-foreground max-w-xs truncate font-mono text-xs" title={r.content}>
                {r.content}
              </Table.Cell>
              <Table.Cell class="tabular font-mono text-[11px]">{r.ttlAuto ? 'auto' : r.ttl}</Table.Cell>
              <Table.Cell>
                {#if r.proxied}
                  <span class="text-warn flex items-center gap-1.5 font-mono text-[10.5px]">
                    <ShieldCheck class="size-3" /> proxied
                  </span>
                {:else}
                  <span class="text-muted-foreground font-mono text-[10.5px]">direct</span>
                {/if}
              </Table.Cell>
              <Table.Cell class="text-right">
                {#if checking === r.id}
                  <LoaderCircle class="text-muted-foreground ml-auto size-3.5 animate-spin" />
                {:else if res}
                  <span
                    class="font-mono text-[10.5px]"
                    style="color:{res.ok ? 'var(--ok)' : 'var(--bad)'}"
                    title={res.ok ? res.answers.join(', ') : res.reason}
                  >
                    {res.ok ? res.answers[0] : 'no answer'}
                  </span>
                {:else}
                  <Button variant="ghost" size="sm" class="h-7 rounded-lg text-[11px]" onclick={() => check(r)}>
                    Check
                  </Button>
                {/if}
              </Table.Cell>
              <Table.Cell>
                <div class="flex justify-end gap-0.5">
                  <Button variant="ghost" size="icon" class="size-7 rounded-lg" onclick={() => openEdit(r)}>
                    <Pencil class="size-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    class="hover:text-bad size-7 rounded-lg"
                    onclick={() => askDelete(r)}
                  >
                    <Trash2 class="size-3" />
                  </Button>
                </div>
              </Table.Cell>
            </Table.Row>
          {/each}
          {#if !shown.length}
            <Table.Row>
              <Table.Cell colspan={7} class="text-muted-foreground py-10 text-center">
                {loading ? 'Loading…' : records.length ? 'Nothing matches that filter.' : 'No records in this zone.'}
              </Table.Cell>
            </Table.Row>
          {/if}
        </Table.Body>
      </Table.Root>
    </div>
  </div>

  <p class="text-muted-foreground text-[11.5px]">
    <strong>Check</strong> resolves the name against 1.1.1.1 and 8.8.8.8, so it shows what the
    internet sees rather than what Cloudflare has stored.
  </p>
{/if}

<Dialog.Root bind:open={editOpen}>
  <Dialog.Content class="sm:max-w-lg">
    <Dialog.Header>
      <Dialog.Title>{editing ? 'Edit record' : 'New record'}</Dialog.Title>
      <Dialog.Description>{zone?.name}</Dialog.Description>
    </Dialog.Header>

    <div class="space-y-4">
      <div class="grid grid-cols-[110px_1fr] gap-3">
        <div class="space-y-1.5">
          <Label>Type</Label>
          <Select.Root type="single" bind:value={form.type}>
            <Select.Trigger>{form.type}</Select.Trigger>
            <Select.Content>
              {#each TYPES as t (t)}<Select.Item value={t}>{t}</Select.Item>{/each}
            </Select.Content>
          </Select.Root>
        </div>
        <div class="space-y-1.5">
          <Label for="rec-name">Name</Label>
          <Input id="rec-name" bind:value={form.name} placeholder="app" class="font-mono text-xs" />
        </div>
      </div>

      <div class="space-y-1.5">
        <Label for="rec-content">Content</Label>
        <Input id="rec-content" bind:value={form.content} class="font-mono text-xs" />
      </div>

      <div class="grid grid-cols-[110px_1fr] items-end gap-3">
        <div class="space-y-1.5">
          <Label for="rec-ttl">TTL</Label>
          <Input id="rec-ttl" type="number" bind:value={form.ttl} class="font-mono text-xs" />
        </div>
        {#if isProxyable(form.type)}
          <div class="flex items-center gap-2 pb-2">
            <Checkbox id="rec-proxy" bind:checked={form.proxied} />
            <Label for="rec-proxy" class="font-normal">Proxy through Cloudflare</Label>
          </div>
        {/if}
      </div>
      <p class="text-muted-foreground text-[11.5px]">TTL 1 means automatic. Proxied records always use it.</p>
    </div>

    <Dialog.Footer>
      <Button variant="outline" onclick={() => (editOpen = false)}>Cancel</Button>
      <Button
        class="accent-fill rounded-xl px-4 font-semibold"
        disabled={!form.name.trim() || !form.content.trim()}
        onclick={save}
      >
        {editing ? 'Save' : 'Create'}
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
