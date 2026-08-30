<script>
  import { live } from '$lib/live.svelte.js';
  import { bytes, duration, pct, relTime, num } from '$lib/format.js';
  import { cn } from '$lib/utils.js';

  import * as Card from '$lib/components/ui/card/index.js';
  import * as Table from '$lib/components/ui/table/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Badge } from '$lib/components/ui/badge/index.js';

  import PageHeader from '$lib/components/PageHeader.svelte';
  import StatCard from '$lib/components/StatCard.svelte';
  import StatusBadge from '$lib/components/StatusBadge.svelte';
  import Sparkline from '$lib/components/Sparkline.svelte';

  import Cpu from '@lucide/svelte/icons/cpu';
  import MemoryStick from '@lucide/svelte/icons/memory-stick';
  import HardDrive from '@lucide/svelte/icons/hard-drive';
  import ArrowDownUp from '@lucide/svelte/icons/arrow-down-up';
  import Boxes from '@lucide/svelte/icons/boxes';

  let { data } = $props();

  const m = $derived(live.metrics?.fast);
  const slow = $derived(live.metrics?.slow);
  const hist = $derived(live.metrics?.history);
  const rootDisk = $derived(slow?.disks?.find((d) => d.mount === '/') ?? slow?.disks?.[0]);
  const busiest = $derived([...live.apps].sort((a, b) => b.cpu - a.cpu).slice(0, 6));

  const coreTone = (v) => (v > 90 ? 'bg-bad' : v > 70 ? 'bg-warn' : 'bg-ok');

  const HOST = $derived([
    ['Hostname', data.host?.hostname],
    ['OS', data.host?.distro],
    ['Kernel', data.host?.kernel],
    ['CPU', data.host?.cpuModel],
    ['Memory', bytes(data.host?.totalMemory)],
    ['Node', `v${data.host?.node} · npm ${data.host?.npm}`],
    ['Processes', `${num(slow?.processCounts?.all)} total, ${num(slow?.processCounts?.running)} running`],
  ]);
</script>

<svelte:head><title>Overview · {data.host?.hostname}</title></svelte:head>

<PageHeader title="Overview">
  {#snippet actions()}
    {#if m}
      <Badge variant="outline" class="tabular">up {duration(m.uptime * 1000)}</Badge>
      <Badge variant="outline" class="tabular">load {m.cpu.loadavg.join('  ')}</Badge>
    {/if}
  {/snippet}
</PageHeader>

<div class="flex-1 space-y-4 p-5">
  <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
    <StatCard
      label="CPU"
      value={m ? pct(m.cpu.load) : '—'}
      sub="{data.host?.cpuCores} threads · {m ? pct(m.cpu.system) : '—'} sys"
      percent={m?.cpu.load ?? 0}
      icon={Cpu}
    >
      <Sparkline data={hist?.cpu ?? []} max={100} height={32} label="CPU history" />
    </StatCard>

    <StatCard
      label="Memory"
      value={m ? bytes(m.memory.used) : '—'}
      sub="of {m ? bytes(m.memory.total) : '—'} · swap {m ? pct(m.memory.swapPercent, 0) : '—'}"
      percent={m?.memory.usedPercent ?? 0}
      icon={MemoryStick}
    >
      <Sparkline data={hist?.mem ?? []} max={100} height={32} color="var(--warn)" label="Memory history" />
    </StatCard>

    <StatCard
      label="Disk — {rootDisk?.mount ?? '/'}"
      value={rootDisk ? pct(rootDisk.usePercent, 0) : '—'}
      sub={rootDisk
        ? `${bytes(rootDisk.used)} of ${bytes(rootDisk.size)} · ${bytes(rootDisk.available)} free`
        : '—'}
      percent={rootDisk?.usePercent ?? 0}
      icon={HardDrive}
    >
      <p class="text-muted-foreground tabular mt-2 text-xs">
        I/O ↓ {bytes(m?.diskIO.readSec ?? 0)}/s · ↑ {bytes(m?.diskIO.writeSec ?? 0)}/s
      </p>
    </StatCard>

    <StatCard
      label="Network"
      value="↓ {bytes(m?.network.rxSec ?? 0)}/s"
      sub="↑ {bytes(m?.network.txSec ?? 0)}/s · {bytes(m?.network.rxTotal ?? 0)} in total"
      icon={ArrowDownUp}
    >
      <Sparkline data={hist?.netRx ?? []} height={32} color="var(--ok)" label="Network in" />
    </StatCard>
  </div>

  <div class="grid gap-3 lg:grid-cols-2">
    <Card.Root class="gap-0 overflow-hidden py-0">
      <Card.Header class="flex-row items-center gap-3 border-b py-3">
        <Card.Title class="text-base">Apps</Card.Title>
        <Button variant="outline" size="sm" class="ml-auto h-8" href="/apps">Manage</Button>
      </Card.Header>

      <div class="grid grid-cols-4 divide-x border-b">
        <div class="p-3">
          <p class="text-muted-foreground text-[11px] font-semibold uppercase">Online</p>
          <p class="text-ok tabular text-xl font-semibold">{live.online}</p>
        </div>
        <div class="p-3">
          <p class="text-muted-foreground text-[11px] font-semibold uppercase">Stopped</p>
          <p class="text-muted-foreground tabular text-xl font-semibold">{live.stopped}</p>
        </div>
        <div class="p-3">
          <p class="text-muted-foreground text-[11px] font-semibold uppercase">Errored</p>
          <p class={cn('tabular text-xl font-semibold', live.errored && 'text-bad')}>{live.errored}</p>
        </div>
        <div class="p-3">
          <p class="text-muted-foreground text-[11px] font-semibold uppercase">RAM</p>
          <p class="tabular text-xl font-semibold">{bytes(live.totalMem)}</p>
        </div>
      </div>

      {#if !live.apps.length}
        <div class="flex flex-col items-center gap-3 px-6 py-12 text-center">
          <div class="bg-muted grid size-10 place-items-center rounded-full">
            <Boxes class="text-muted-foreground size-5" />
          </div>
          <p class="text-muted-foreground text-sm">Clone a repository and start it to see it here.</p>
          <Button size="sm" href="/repos">Go to repositories</Button>
        </div>
      {:else}
        <Table.Root>
          <Table.Header>
            <Table.Row class="hover:bg-transparent">
              <Table.Head>App</Table.Head>
              <Table.Head class="w-28">Status</Table.Head>
              <Table.Head class="w-20 text-right">CPU</Table.Head>
              <Table.Head class="w-24 text-right">Memory</Table.Head>
              <Table.Head class="w-24 text-right">Uptime</Table.Head>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {#each busiest as app (app.pmId)}
              <Table.Row>
                <Table.Cell>
                  <a href="/apps/{app.pmId}" class="font-medium hover:underline">{app.name}</a>
                </Table.Cell>
                <Table.Cell><StatusBadge status={app.status} /></Table.Cell>
                <Table.Cell class="tabular text-right">{app.cpu}%</Table.Cell>
                <Table.Cell class="tabular text-right">{bytes(app.memory)}</Table.Cell>
                <Table.Cell class="tabular text-right">
                  {app.status === 'online' ? duration(app.uptime) : '—'}
                </Table.Cell>
              </Table.Row>
            {/each}
          </Table.Body>
        </Table.Root>
      {/if}
    </Card.Root>

    <Card.Root class="gap-0 overflow-hidden py-0">
      <Card.Header class="border-b py-3">
        <Card.Title class="text-base">Recent activity</Card.Title>
      </Card.Header>
      {#if !live.events.length}
        <p class="text-muted-foreground px-6 py-12 text-center text-sm">
          No app events since this panel started.
        </p>
      {:else}
        <Table.Root>
          <Table.Body>
            {#each live.events.slice(0, 9) as e, i (i)}
              <Table.Row>
                <Table.Cell class="w-1/3">
                  <a href="/apps/{e.pmId}" class="hover:underline">{e.name}</a>
                </Table.Cell>
                <Table.Cell>
                  <Badge
                    variant="outline"
                    class={cn(
                      e.event === 'exit' || e.event === 'error'
                        ? 'border-bad/40 text-bad'
                        : e.event === 'online'
                          ? 'border-ok/40 text-ok'
                          : '',
                    )}
                  >
                    {e.event}
                  </Badge>
                </Table.Cell>
                <Table.Cell class="text-muted-foreground text-right text-xs whitespace-nowrap">
                  {relTime(e.at)}
                </Table.Cell>
              </Table.Row>
            {/each}
          </Table.Body>
        </Table.Root>
      {/if}
    </Card.Root>
  </div>

  <div class="grid gap-3 lg:grid-cols-2">
    <Card.Root>
      <Card.Header class="flex-row items-center gap-3">
        <Card.Title class="text-base">Per-core load</Card.Title>
        {#if slow?.temperature}
          <Badge variant="outline" class="tabular ml-auto">{slow.temperature.main}°C</Badge>
        {/if}
      </Card.Header>
      <Card.Content>
        <div class="grid grid-cols-8 gap-1.5">
          {#each m?.cpu.cores ?? [] as c, i (i)}
            <div class="space-y-1">
              <div class="bg-muted flex h-8 items-end overflow-hidden rounded-sm">
                <div
                  class={cn('w-full rounded-b-sm transition-all duration-500', coreTone(c))}
                  style="height:{Math.max(c, 3)}%"
                ></div>
              </div>
              <p class="text-muted-foreground tabular text-center text-[10px]">{Math.round(c)}</p>
            </div>
          {/each}
        </div>
      </Card.Content>
    </Card.Root>

    <Card.Root>
      <Card.Header class="flex-row items-center gap-3">
        <Card.Title class="text-base">Host</Card.Title>
        <Button variant="outline" size="sm" class="ml-auto h-8" href="/system">Details</Button>
      </Card.Header>
      <Card.Content>
        <dl class="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[minmax(6rem,auto)_1fr]">
          {#each HOST as [key, value] (key)}
            <dt class="text-muted-foreground">{key}</dt>
            <dd class="font-mono text-xs break-all">{value}</dd>
          {/each}
        </dl>
      </Card.Content>
    </Card.Root>
  </div>
</div>
