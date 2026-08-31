<script>
  import { live } from '$lib/live.svelte.js';
  import { bytes, num } from '$lib/format.js';
  import { cn } from '$lib/utils.js';

  import { Badge } from '$lib/components/ui/badge/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import * as Table from '$lib/components/ui/table/index.js';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import StatCard from '$lib/components/StatCard.svelte';
  import SparkBars from '$lib/components/SparkBars.svelte';

  import Globe from '@lucide/svelte/icons/globe';
  import NetworkIcon from '@lucide/svelte/icons/network';
  import Boxes from '@lucide/svelte/icons/boxes';

  let { data } = $props();

  const m = $derived(live.metrics?.fast);
  const slow = $derived(live.metrics?.slow);
  const hist = $derived(live.metrics?.history);
  const addressing = $derived(slow?.network);

  const interfaces = $derived.by(() => {
    const info = new Map((addressing?.interfaces ?? []).map((i) => [i.iface, i]));
    return (m?.network.interfaces ?? []).map((n) => ({ ...n, ...(info.get(n.iface) ?? {}) }));
  });

  const up = $derived(interfaces.filter((n) => n.state === 'up').length);

  const listening = $derived.by(() => {
    const byPid = new Map(live.apps.filter((a) => a.pid).map((a) => [a.pid, a]));
    return (slow?.listening ?? []).map((l) => ({ ...l, app: l.pid ? (byPid.get(l.pid) ?? null) : null }));
  });

  const exposed = $derived(listening.filter((l) => l.scope === 'all').length);

  const peak = (arr) => (arr?.length ? Math.max(...arr) : 0);
  const errorsOf = (n) => (n.rxErrors ?? 0) + (n.txErrors ?? 0) + (n.rxDropped ?? 0) + (n.txDropped ?? 0);
</script>

<svelte:head><title>Network · {data.host?.hostname}</title></svelte:head>

<PageHeader title="Network" icon={NetworkIcon} />

<div class="flex flex-col gap-3.5 p-5 pt-3.5 md:p-6 md:pt-3.5">

    <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard label="Inbound" value="{bytes(m?.network.rxSec ?? 0)}/s" sub="peak {bytes(peak(hist?.netRx))}/s">
        <SparkBars data={hist?.netRx ?? []} tone="var(--ok)" height={26} bars={16} class="mt-2" />
      </StatCard>
      <StatCard label="Outbound" value="{bytes(m?.network.txSec ?? 0)}/s" sub="peak {bytes(peak(hist?.netTx))}/s">
        <SparkBars data={hist?.netTx ?? []} tone="var(--info)" height={26} bars={16} class="mt-2" />
      </StatCard>
      <StatCard label="Total in" value={bytes(m?.network.rxTotal ?? 0)} sub="since boot" />
      <StatCard label="Total out" value={bytes(m?.network.txTotal ?? 0)} sub="since boot" />
    </div>

    <div class="grid gap-3 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
      <div class="panel-raised space-y-4 rounded-2xl p-4.5">
        <div class="flex items-baseline gap-2">
          <span class="eyebrow">Throughput</span>
          <span class="text-muted-foreground ml-auto font-mono text-[10.5px]">4 min</span>
        </div>
        <div>
          <p class="text-muted-foreground mb-1.5 font-mono text-[10.5px]">
            Inbound — peak {bytes(peak(hist?.netRx))}/s
          </p>
          <SparkBars data={hist?.netRx ?? []} tone="var(--ok)" bars={60} height={62} solid />
        </div>
        <div>
          <p class="text-muted-foreground mb-1.5 font-mono text-[10.5px]">
            Outbound — peak {bytes(peak(hist?.netTx))}/s
          </p>
          <SparkBars data={hist?.netTx ?? []} tone="var(--info)" bars={60} height={62} solid />
        </div>
      </div>

      <div class="panel rounded-2xl p-4.5">
        <div class="mb-3 flex items-center gap-2">
          <Globe class="text-muted-foreground size-3.5" />
          <span class="eyebrow">Routing</span>
        </div>
        <dl class="grid gap-x-6 gap-y-2.5 sm:grid-cols-[minmax(5.5rem,auto)_1fr]">
          <dt class="text-muted-foreground text-[12.5px]">Gateway</dt>
          <dd class="font-mono text-[11.5px]">{addressing?.gateway ?? '—'}</dd>
          <dt class="text-muted-foreground text-[12.5px]">Resolvers</dt>
          <dd class="font-mono text-[11.5px]">
            {#each addressing?.dns ?? [] as ip (ip)}<div>{ip}</div>{:else}—{/each}
          </dd>
          <dt class="text-muted-foreground text-[12.5px]">Default route</dt>
          <dd class="font-mono text-[11.5px]">
            {interfaces.find((n) => n.isDefault)?.iface ?? '—'}
          </dd>
          <dt class="text-muted-foreground text-[12.5px]">Hostname</dt>
          <dd class="font-mono text-[11.5px] break-all">{data.host?.hostname}</dd>
        </dl>
      </div>
    </div>

    <div class="panel overflow-hidden rounded-2xl">
      <div class="flex items-center gap-2.5 px-4.5 py-3.5">
        <h2 class="text-[15px] font-semibold">Interfaces</h2>
        <span class="tabular bg-ok/14 text-ok rounded-full px-2 py-0.5 font-mono text-[10.5px]">{up} up</span>
      </div>
      <div class="overflow-x-auto">
        <Table.Root>
          <Table.Header>
            <Table.Row class="hover:bg-transparent">
              <Table.Head>Interface</Table.Head>
              <Table.Head>Address</Table.Head>
              <Table.Head class="w-28">Link</Table.Head>
              <Table.Head class="w-24">State</Table.Head>
              <Table.Head class="text-right">In</Table.Head>
              <Table.Head class="text-right">Out</Table.Head>
              <Table.Head class="w-28 text-right">Errors</Table.Head>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {#each interfaces as n (n.iface)}
              <Table.Row>
                <Table.Cell>
                  <div class="flex items-center gap-2">
                    <span class="font-mono text-xs">{n.iface}</span>
                    {#if n.isDefault}
                      <span class="accent-wash rounded-full px-1.5 py-0.5 text-[9.5px] font-medium">default</span>
                    {/if}
                  </div>
                  <div class="text-muted-foreground text-[10.5px]">{n.type ?? '—'}</div>
                </Table.Cell>
                <Table.Cell>
                  <div class="font-mono text-xs">{n.ip4 ?? '—'}</div>
                  <div class="text-muted-foreground font-mono text-[10px]">{n.mac ?? ''}</div>
                </Table.Cell>
                <Table.Cell class="tabular font-mono text-[11px]">
                  <div>{n.speed ? `${num(n.speed)} Mb/s` : '—'}</div>
                  <div class="text-muted-foreground">MTU {n.mtu ?? '—'}</div>
                </Table.Cell>
                <Table.Cell>
                  <Badge
                    variant="outline"
                    class={cn('gap-1.5', n.state === 'up' ? 'border-ok/40 text-ok' : 'text-muted-foreground')}
                  >
                    <span class="dot"></span>{n.state}
                  </Badge>
                </Table.Cell>
                <Table.Cell class="tabular text-right text-xs">
                  {bytes(n.rxSec)}/s
                  <div class="text-muted-foreground">{bytes(n.rxTotal)} total</div>
                </Table.Cell>
                <Table.Cell class="tabular text-right text-xs">
                  {bytes(n.txSec)}/s
                  <div class="text-muted-foreground">{bytes(n.txTotal)} total</div>
                </Table.Cell>
                <Table.Cell class="tabular text-right">
                  {#if errorsOf(n)}
                    <span class="text-warn font-mono text-xs">{num(n.rxErrors + n.txErrors)} err</span>
                    <div class="text-muted-foreground font-mono text-[10px]">
                      {num(n.rxDropped + n.txDropped)} dropped
                    </div>
                  {:else}
                    <span class="text-muted-foreground font-mono text-xs">none</span>
                  {/if}
                </Table.Cell>
              </Table.Row>
            {/each}
            {#if !interfaces.length}
              <Table.Row>
                <Table.Cell colspan={7} class="text-muted-foreground py-10 text-center">Collecting…</Table.Cell>
              </Table.Row>
            {/if}
          </Table.Body>
        </Table.Root>
      </div>
    </div>

    <div class="panel overflow-hidden rounded-2xl">
      <div class="flex flex-wrap items-center gap-2.5 px-4.5 py-3.5">
        <h2 class="text-[15px] font-semibold">Listening ports</h2>
        {#if exposed}
          <span class="tabular bg-warn/16 text-warn rounded-full px-2 py-0.5 font-mono text-[10.5px]">
            {exposed} on all interfaces
          </span>
        {/if}
        <span class="text-muted-foreground ml-auto font-mono text-[10.5px]">refreshed every 10s</span>
      </div>
      <div class="overflow-x-auto">
        <Table.Root>
          <Table.Header>
            <Table.Row class="hover:bg-transparent">
              <Table.Head class="w-20 text-right">Port</Table.Head>
              <Table.Head class="w-20">Proto</Table.Head>
              <Table.Head>Bound to</Table.Head>
              <Table.Head class="w-32">Reach</Table.Head>
              <Table.Head>Owner</Table.Head>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {#each listening as l (`${l.protocol}:${l.address}:${l.port}`)}
              <Table.Row>
                <Table.Cell class="tabular text-right font-mono text-xs font-semibold">{l.port}</Table.Cell>
                <Table.Cell class="text-muted-foreground font-mono text-xs">{l.protocol}</Table.Cell>
                <Table.Cell class="font-mono text-xs">{l.address}</Table.Cell>
                <Table.Cell>
                  {#if l.scope === 'all'}
                    <Badge variant="outline" class="border-warn/40 text-warn gap-1.5">
                      <span class="dot"></span>all interfaces
                    </Badge>
                  {:else if l.scope === 'local'}
                    <Badge variant="outline" class="text-muted-foreground">localhost</Badge>
                  {:else}
                    <Badge variant="outline" class="text-muted-foreground">single address</Badge>
                  {/if}
                </Table.Cell>
                <Table.Cell>
                  {#if l.app}
                    <Button
                      variant="ghost"
                      size="sm"
                      href="/apps/{l.app.pmId}"
                      class="h-7 gap-1.5 rounded-lg px-2 font-semibold"
                    >
                      <Boxes class="size-3.5" />{l.app.name}
                    </Button>
                  {:else if l.process}
                    <span class="text-muted-foreground font-mono text-xs">{l.process}</span>
                  {:else}
                    <span class="text-muted-foreground font-mono text-xs">another user</span>
                  {/if}
                </Table.Cell>
              </Table.Row>
            {/each}
            {#if !listening.length}
              <Table.Row>
                <Table.Cell colspan={5} class="text-muted-foreground py-10 text-center">Collecting…</Table.Cell>
              </Table.Row>
            {/if}
          </Table.Body>
        </Table.Root>
      </div>
      <p class="text-muted-foreground border-t px-4.5 py-2.5 text-[11.5px]">
        Ports bound to <span class="font-mono">0.0.0.0</span> or <span class="font-mono">::</span> accept traffic
        from anything that can reach this machine. Owners show as
        <span class="font-mono">another user</span> when the process belongs to a different account — the panel
        does not run as root.
      </p>
    </div>
</div>
