<script>
  import { live } from '$lib/live.svelte.js';
  import { bytes } from '$lib/format.js';
  import { cn } from '$lib/utils.js';

  import { Badge } from '$lib/components/ui/badge/index.js';
  import * as Table from '$lib/components/ui/table/index.js';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import StatCard from '$lib/components/StatCard.svelte';
  import SparkBars from '$lib/components/SparkBars.svelte';

  let { data } = $props();

  const m = $derived(live.metrics?.fast);
  const hist = $derived(live.metrics?.history);
  const interfaces = $derived(m?.network.interfaces ?? []);
  const up = $derived(interfaces.filter((n) => n.state === 'up').length);

  const peak = (arr) => (arr?.length ? Math.max(...arr) : 0);
</script>

<svelte:head><title>Network · {data.host?.hostname}</title></svelte:head>

<PageHeader title="Network" />

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

  <div class="panel-raised space-y-4 rounded-2xl p-4.5">
    <div class="flex items-baseline gap-2">
      <span class="eyebrow">Throughput</span>
      <span class="text-muted-foreground ml-auto font-mono text-[10.5px]">4 min</span>
    </div>
    <div>
      <p class="text-muted-foreground mb-1.5 font-mono text-[10.5px]">
        Inbound — peak {bytes(peak(hist?.netRx))}/s
      </p>
      <SparkBars data={hist?.netRx ?? []} tone="var(--ok)" bars={60} height={72} solid />
    </div>
    <div>
      <p class="text-muted-foreground mb-1.5 font-mono text-[10.5px]">
        Outbound — peak {bytes(peak(hist?.netTx))}/s
      </p>
      <SparkBars data={hist?.netTx ?? []} tone="var(--info)" bars={60} height={72} solid />
    </div>
  </div>

  <div class="panel overflow-hidden rounded-2xl">
    <div class="flex items-center gap-2.5 px-4.5 py-3.5">
      <h2 class="text-[15px] font-semibold">Interfaces</h2>
      <span class="tabular bg-ok/14 text-ok rounded-full px-2 py-0.5 font-mono text-[10.5px]">{up} up</span>
      <span class="text-muted-foreground ml-auto font-mono text-[10.5px]">refreshed every 2s</span>
    </div>
    <div class="overflow-x-auto">
      <Table.Root>
        <Table.Header>
          <Table.Row class="hover:bg-transparent">
            <Table.Head>Interface</Table.Head>
            <Table.Head class="w-24">State</Table.Head>
            <Table.Head class="text-right">In</Table.Head>
            <Table.Head class="text-right">Out</Table.Head>
            <Table.Head class="w-40">Activity</Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {#each interfaces as n (n.iface)}
            <Table.Row>
              <Table.Cell class="font-mono text-xs">{n.iface}</Table.Cell>
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
              <Table.Cell>
                <div class="flex items-center gap-1.5">
                  <div class="bg-foreground/8 h-1.5 flex-1 overflow-hidden rounded-full">
                    <div
                      class="bg-ok h-full rounded-full transition-all duration-500"
                      style="width:{Math.min((n.rxSec / Math.max(m?.network.rxSec ?? 1, 1)) * 100, 100)}%"
                    ></div>
                  </div>
                  <div class="bg-foreground/8 h-1.5 flex-1 overflow-hidden rounded-full">
                    <div
                      class="bg-info h-full rounded-full transition-all duration-500"
                      style="width:{Math.min((n.txSec / Math.max(m?.network.txSec ?? 1, 1)) * 100, 100)}%"
                    ></div>
                  </div>
                </div>
              </Table.Cell>
            </Table.Row>
          {/each}
          {#if !interfaces.length}
            <Table.Row>
              <Table.Cell colspan={5} class="text-muted-foreground py-10 text-center">Collecting…</Table.Cell>
            </Table.Row>
          {/if}
        </Table.Body>
      </Table.Root>
    </div>
  </div>
</div>
