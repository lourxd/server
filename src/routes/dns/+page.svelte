<script>
  import { onMount } from 'svelte';
  import { invalidateAll } from '$app/navigation';
  import { api, apiGet, toasts } from '$lib/live.svelte.js';
  import { cn } from '$lib/utils.js';
  import { relTime } from '$lib/format.js';
  import { RECORD_TYPES as TYPES } from '$lib/dns-records.js';

  import { Button } from '$lib/components/ui/button/index.js';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import * as Select from '$lib/components/ui/select/index.js';
  import PageHeader from '$lib/components/PageHeader.svelte';

  import Globe from '@lucide/svelte/icons/globe';
  import Plus from '@lucide/svelte/icons/plus';
  import Search from '@lucide/svelte/icons/search';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import RefreshCcw from '@lucide/svelte/icons/refresh-ccw';
  import ExternalLink from '@lucide/svelte/icons/external-link';
  import LoaderCircle from '@lucide/svelte/icons/loader-circle';


  let { data } = $props();

  let checks = $state({});
  let busy = $state(null);
  let adding = $state('');

  let lookupName = $state('');
  let lookupType = $state('A');
  let lookupBusy = $state(false);
  let lookupResult = $state(null);

  const domains = $derived([
    ...data.routed.map((r) => ({ ...r, source: 'tunnel' })),
    ...data.watched.map((hostname) => ({ hostname, source: 'watched', expect: null })),
  ]);

  onMount(() => {
    for (const d of domains) check(d.hostname);
  });

  async function check(hostname) {
    busy = hostname;
    try {
      checks = { ...checks, [hostname]: await apiGet('/api/domains', { hostname }, { quiet: true }) };
    } catch (err) {
      checks = { ...checks, [hostname]: { hostname, resolves: false, error: err.message } };
    } finally {
      busy = null;
    }
  }

  async function watch() {
    const hostname = adding.trim().toLowerCase();
    if (!hostname) return;
    await api('/api/domains', { action: 'watch', hostname });
    adding = '';
    await invalidateAll();
    check(hostname);
  }

  async function unwatch(hostname) {
    await api('/api/domains', { action: 'unwatch', hostname });
    toasts.ok('Stopped watching', hostname);
    await invalidateAll();
  }

  async function lookup() {
    const hostname = lookupName.trim();
    if (!hostname) return;
    lookupBusy = true;
    lookupResult = null;
    try {
      lookupResult = await apiGet('/api/domains', { op: 'resolve', hostname, type: lookupType });
    } catch (err) {
      lookupResult = { ok: false, error: err.message };
    } finally {
      lookupBusy = false;
    }
  }

  function state(d) {
    const c = checks[d.hostname];
    if (!c) return { label: 'checking', tone: 'var(--muted-foreground)' };
    if (c.serving) return { label: 'serving', tone: 'var(--ok)' };
    if (c.resolves) return { label: 'resolves, no answer', tone: 'var(--warn)' };
    return { label: 'not resolving', tone: 'var(--bad)' };
  }
</script>

<svelte:head><title>DNS · {data.host?.hostname}</title></svelte:head>

<PageHeader
  title="DNS"
  subtitle={data.publicIp ? `this machine is ${data.publicIp}` : 'public address unknown'}
/>

<div class="flex flex-col gap-4 p-5 pt-3.5 md:p-6 md:pt-3.5">

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
          {#each lookupResult.answers as a, i (i)}
            <p class="font-mono text-[12px] break-all">{a}</p>
          {/each}
        {:else}
          <p class="text-bad font-mono text-[12px]">{lookupResult.error}</p>
        {/if}
      </div>
    {:else}
      <p class="text-muted-foreground text-[11.5px]">
        Resolves against public resolvers, so it works for any domain at any registrar — no account
        anywhere is involved.
      </p>
    {/if}
  </div>

  <div class="space-y-2.5">
    <div class="flex flex-wrap items-center gap-2">
      <span class="eyebrow">Domains</span>
      <span class="text-muted-foreground ml-auto font-mono text-[10.5px]">
        {domains.length} watched
      </span>
      <Input
        bind:value={adding}
        onkeydown={(e) => e.key === 'Enter' && watch()}
        placeholder="add a domain to watch"
        spellcheck="false"
        class="h-8 w-56 rounded-xl font-mono text-[11.5px]"
      />
      <Button
        size="sm"
        variant="ghost"
        class="panel h-8 rounded-xl px-3"
        disabled={!adding.trim()}
        onclick={watch}
      >
        <Plus class="size-3.5" /> Watch
      </Button>
    </div>

    {#if !domains.length}
      <div class="panel flex flex-col items-center gap-3 rounded-2xl px-6 py-14 text-center">
        <div class="panel grid size-12 place-items-center rounded-full">
          <Globe class="text-muted-foreground size-5" />
        </div>
        <div>
          <p class="font-semibold">No domains yet</p>
          <p class="text-muted-foreground mx-auto mt-1 max-w-md text-sm">
            Route a hostname through a tunnel and it appears here, or add one to watch. The panel
            reads DNS — it never writes it, so any registrar works.
          </p>
        </div>
      </div>
    {:else}
      <div class="flex flex-col gap-2.5">
        {#each domains as d (d.hostname)}
          {@const c = checks[d.hostname]}
          {@const s = state(d)}
          <div class="panel-raised flex flex-col gap-3 rounded-2xl p-4">
            <div class="flex flex-wrap items-center gap-3">
              <a
                href="https://{d.hostname}"
                target="_blank"
                rel="noreferrer"
                class="flex min-w-0 items-center gap-1.5 text-[14.5px] font-semibold hover:underline"
              >
                {d.hostname}
                <ExternalLink class="text-muted-foreground size-3.5 shrink-0" />
              </a>

              {#if d.source === 'tunnel'}
                <Badge variant="outline" class="font-mono text-[10px]">via {d.via}</Badge>
              {/if}
              {#if c?.proxied}
                <Badge variant="outline" class="border-info/40 text-info font-mono text-[10px]">
                  proxied
                </Badge>
              {/if}

              <span
                class="ml-auto flex shrink-0 items-center gap-1.5 font-mono text-[11.5px]"
                style="color:{s.tone}"
              >
                {#if busy === d.hostname}
                  <LoaderCircle class="size-3 animate-spin" />
                {:else}
                  <span class="dot"></span>
                {/if}
                {s.label}
              </span>

              <Button
                variant="ghost"
                size="icon"
                class="size-8 shrink-0 rounded-lg"
                disabled={busy === d.hostname}
                onclick={() => check(d.hostname)}
              >
                <RefreshCcw class="size-3.5" />
              </Button>
              {#if d.source === 'watched'}
                <Button
                  variant="ghost"
                  size="icon"
                  class="hover:text-bad size-8 shrink-0 rounded-lg"
                  onclick={() => unwatch(d.hostname)}
                >
                  <Trash2 class="size-3.5" />
                </Button>
              {/if}
            </div>

            {#if c}
              <div class="border-border/60 flex flex-wrap items-center gap-x-5 gap-y-1 border-t pt-2.5">
                <span class="text-muted-foreground font-mono text-[10.5px]">
                  {c.resolves ? c.answers.join(', ') : (c.error ?? 'no record')}
                </span>
                {#if c.http?.status}
                  <span class="text-muted-foreground font-mono text-[10.5px]">
                    {c.http.scheme} {c.http.status}
                  </span>
                {/if}
                <span class="text-muted-foreground ml-auto font-mono text-[10px]">
                  {relTime(c.checkedAt)}
                </span>
              </div>

              {#if !c.serving && d.expect}
                <p class="text-muted-foreground text-[11.5px]">
                  Point it at your tunnel: a <span class="font-mono">{d.expect.type}</span> record for
                  <span class="font-mono">{d.hostname}</span> to
                  <span class="font-mono">{d.expect.value}</span> — at whichever registrar holds the
                  domain.
                </p>
              {:else if !c.resolves && data.publicIp}
                <p class="text-muted-foreground text-[11.5px]">
                  Point it here: an <span class="font-mono">A</span> record to
                  <span class="font-mono">{data.publicIp}</span>, or route it through a tunnel.
                </p>
              {/if}
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>
