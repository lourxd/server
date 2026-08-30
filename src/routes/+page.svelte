<script>
  import { live } from '$lib/live.svelte.js';
  import { bytes, duration, pct, relTime, num } from '$lib/format.js';
  import { cn } from '$lib/utils.js';
  import { STACK_BY_ID } from '$lib/stacks.js';

  import { Button } from '$lib/components/ui/button/index.js';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import * as Table from '$lib/components/ui/table/index.js';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import StatCard from '$lib/components/StatCard.svelte';
  import StatusBadge from '$lib/components/StatusBadge.svelte';
  import SparkBars from '$lib/components/SparkBars.svelte';
  import TechLogo from '$lib/components/TechLogo.svelte';

  import Plus from '@lucide/svelte/icons/plus';
  import Boxes from '@lucide/svelte/icons/boxes';

  let { data } = $props();

  const m = $derived(live.metrics?.fast);
  const slow = $derived(live.metrics?.slow);
  const hist = $derived(live.metrics?.history);
  const rootDisk = $derived(slow?.disks?.find((d) => d.mount === '/') ?? slow?.disks?.[0]);
  const busiest = $derived([...live.apps].sort((a, b) => b.cpu - a.cpu).slice(0, 7));

  const tone = (v) => (v > 70 ? 'var(--bad)' : v > 40 ? 'var(--warn)' : 'var(--ok)');
  const barTone = (v) => (v > 90 ? 'bg-bad' : v > 70 ? 'bg-warn' : 'bg-ok');
  const coreTone = (v) =>
    v > 70
      ? 'linear-gradient(180deg, var(--bad), color-mix(in srgb, var(--bad) 70%, black))'
      : v > 40
        ? 'linear-gradient(180deg, var(--warn), color-mix(in srgb, var(--warn) 70%, black))'
        : 'linear-gradient(180deg, var(--ok), color-mix(in srgb, var(--ok) 70%, black))';

  const eventTone = (e) =>
    e === 'exit' || e === 'error' ? 'var(--bad)' : e === 'online' ? 'var(--ok)' : 'var(--idle)';

  const peak = (arr) => (arr?.length ? Math.max(...arr) : 0);

  const CPU_BREAKDOWN = $derived([
    ['User', m ? pct(m.cpu.user) : '—'],
    ['System', m ? pct(m.cpu.system) : '—'],
    ['Idle', m ? pct(m.cpu.idle) : '—'],
    ['Load avg', m?.cpu.loadavg.join('  ') ?? '—'],
  ]);

  const MEM_BREAKDOWN = $derived([
    ['Used', m ? bytes(m.memory.used) : '—'],
    ['Available', m ? bytes(m.memory.free) : '—'],
    ['Cached', m ? bytes(m.memory.cached) : '—'],
    ['Swap', m ? `${bytes(m.memory.swapUsed)} of ${bytes(m.memory.swapTotal)}` : '—'],
  ]);

</script>

<svelte:head><title>Overview · {data.host?.hostname}</title></svelte:head>

<PageHeader
  title="Overview"
  subtitle={m
    ? `${duration(m.uptime * 1000)} uptime · load ${m.cpu.loadavg.join(' ')}${slow?.temperature ? ` · ${slow.temperature.main}°C` : ''}`
    : 'connecting…'}
>
  {#snippet actions()}
    <Button href="/apps" class="accent-fill h-8.5 rounded-xl px-4 font-semibold">
      <Plus class="size-4" /> Deploy
    </Button>
  {/snippet}
</PageHeader>

<div class="flex flex-col gap-3.5 p-5 pt-3.5 md:p-6 md:pt-3.5">

  <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
    <StatCard
      label="Processor"
      value={m ? pct(m.cpu.load) : '—'}
      sub="{data.host?.cpuCores} threads · {m ? pct(m.cpu.system) : '—'} sys"
      percent={m?.cpu.load ?? 0}
      tone={tone(m?.cpu.load ?? 0)}
    />
    <StatCard
      label="Memory"
      value={m ? bytes(m.memory.used) : '—'}
      sub="of {m ? bytes(m.memory.total) : '—'} · swap {m ? pct(m.memory.swapPercent, 0) : '—'}"
      percent={m?.memory.usedPercent ?? 0}
      tone={tone(m?.memory.usedPercent ?? 0)}
    />
    <StatCard
      label="Disk {rootDisk?.mount ?? '/'}"
      value={rootDisk ? bytes(rootDisk.used) : '—'}
      sub={rootDisk ? `of ${bytes(rootDisk.size)} · ${bytes(rootDisk.available)} free` : '—'}
      percent={rootDisk?.usePercent ?? 0}
      tone={tone(rootDisk?.usePercent ?? 0)}
    />
    <StatCard
      label="Network"
      value="{bytes(m?.network.rxSec ?? 0)}/s"
      sub="↑ {bytes(m?.network.txSec ?? 0)}/s · {bytes(m?.network.rxTotal ?? 0)} in"
    >
      <SparkBars data={hist?.netRx ?? []} tone="var(--info)" height={26} bars={16} class="mt-2" />
    </StatCard>
  </div>

  <div class="grid gap-3 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">

    <div class="panel flex h-100 flex-col overflow-hidden rounded-2xl">
      <div class="flex items-center gap-2.5 px-4.5 py-3.5">
        <h2 class="text-[15px] font-semibold">Applications</h2>
        <span class="tabular bg-ok/14 text-ok rounded-full px-2 py-0.5 font-mono text-[10.5px]">
          {live.online} up
        </span>
        {#if live.errored}
          <span class="tabular bg-bad/16 text-bad rounded-full px-2 py-0.5 font-mono text-[10.5px]">
            {live.errored} down
          </span>
        {/if}
        <Button variant="ghost" size="sm" href="/apps" class="ml-auto h-7 rounded-lg">Manage</Button>
      </div>

      {#if !live.apps.length}
        <div class="flex flex-col items-center gap-3 px-6 py-14 text-center">
          <div class="panel grid size-11 place-items-center rounded-full">
            <Boxes class="text-muted-foreground size-5" />
          </div>
          <p class="text-muted-foreground text-sm">Nothing deployed yet.</p>
          <Button size="sm" href="/apps" class="accent-fill rounded-xl px-4 font-semibold">
            <Plus class="size-4" /> Deploy an app
          </Button>
        </div>
      {:else}
        <div class="min-h-0 flex-1 space-y-2 overflow-y-auto px-2.5 pb-2.5">
          {#each busiest as app (app.pmId)}
            {@const bad = app.status === 'errored'}
            <a
              href="/apps/{app.pmId}"
              class={cn(
                'grid grid-cols-[1fr_auto_auto] items-center gap-3 rounded-2xl px-3.5 py-3 transition-all sm:grid-cols-[1fr_88px_72px_84px]',
                bad
                  ? 'bg-bad/7 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--bad)_30%,transparent)]'
                  : 'panel hover:brightness-125',
              )}
            >
              <div class="flex min-w-0 items-center gap-3">
                <div
                  class={cn(
                    'grid size-9 shrink-0 place-items-center rounded-xl',
                    bad ? 'bg-bad/14 text-bad' : 'bg-foreground/6 text-foreground/80',
                  )}
                >
                  {#if app.stack && STACK_BY_ID[app.stack]}
                    <TechLogo name={STACK_BY_ID[app.stack].logo} class="size-4.5" />
                  {:else}
                    <Boxes class="size-4.5" />
                  {/if}
                </div>
                <div class="min-w-0">
                  <p class="truncate text-[13.5px] font-semibold">{app.name}</p>
                  <p class="text-muted-foreground truncate font-mono text-[11px]">{app.script ?? ''}</p>
                </div>
              </div>
              <StatusBadge status={app.status} class="justify-self-start" />
              <p class="tabular hidden text-right text-[13px] sm:block">{app.cpu}%</p>
              <p class="tabular text-muted-foreground hidden text-right text-[13px] sm:block">
                {bytes(app.memory)}
              </p>
            </a>
          {/each}
        </div>
      {/if}
    </div>

    <div class="flex h-100 flex-col gap-3">
      <div class="panel rounded-2xl p-4">
        <div class="mb-3 flex items-center gap-2">
          <span class="eyebrow">Cores</span>
          <span class="text-muted-foreground ml-auto font-mono text-[10.5px]">
            {m?.cpu.cores.length ?? 0} logical
          </span>
        </div>
        <div class="grid grid-cols-8 gap-1.5">
          {#each m?.cpu.cores ?? [] as c, i (i)}
            <div class="bg-foreground/6 flex h-7.5 items-end overflow-hidden rounded-md">
              <div
                class="w-full rounded-b-md transition-all duration-500"
                style="height:{Math.max(c, 7)}%; background:{coreTone(c)}"
              ></div>
            </div>
          {/each}
        </div>
        {#if slow?.temperature?.cores?.length}
          <p class="text-muted-foreground tabular mt-3 font-mono text-[10.5px]">
            {slow.temperature.cores.map((t) => `${t}°`).join(' ')} · max {slow.temperature.max}°C
          </p>
        {/if}
      </div>

      <div class="panel flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl p-4">
        <div class="mb-2 flex items-center gap-2">
          <span class="eyebrow">Activity</span>
          <span class="text-muted-foreground ml-auto font-mono text-[10.5px]">{live.events.length} events</span>
        </div>
        {#if !live.events.length}
          <p class="text-muted-foreground py-8 text-center text-sm">Nothing since this panel started.</p>
        {:else}
          <div class="min-h-0 flex-1 overflow-y-auto">
            {#each live.events.slice(0, 12) as e, i (i)}
              <div class="border-border/60 flex gap-2.5 border-b py-2 last:border-0">
                <span class="mt-1.5 shrink-0" style="color:{eventTone(e.event)}"><span class="dot"></span></span>
                <div class="min-w-0 flex-1">
                  <p class="truncate text-[12.5px]">
                    <span class="font-medium">{e.name}</span>
                    <span class="text-muted-foreground">{e.event}</span>
                  </p>
                  <p class="text-muted-foreground font-mono text-[10px]">{relTime(e.at)}</p>
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </div>
  </div>

  <div class="grid gap-3 lg:grid-cols-2">
    <div class="panel-raised rounded-2xl p-4.5">
      <div class="mb-3 flex items-baseline gap-2">
        <span class="eyebrow">Processor history</span>
        <span class="text-muted-foreground ml-auto font-mono text-[10.5px]">
          peak {pct(peak(hist?.cpu))} · 4 min
        </span>
      </div>
      <SparkBars data={hist?.cpu ?? []} tone={tone(m?.cpu.load ?? 0)} max={100} bars={60} height={64} solid />
      <dl class="mt-4 grid grid-cols-2 gap-x-6 gap-y-2">
        {#each CPU_BREAKDOWN as [key, value] (key)}
          <div class="flex items-baseline justify-between gap-3">
            <dt class="text-muted-foreground text-[12.5px]">{key}</dt>
            <dd class="tabular font-mono text-[11.5px]">{value}</dd>
          </div>
        {/each}
      </dl>
    </div>

    <div class="panel-raised rounded-2xl p-4.5">
      <div class="mb-3 flex items-baseline gap-2">
        <span class="eyebrow">Memory history</span>
        <span class="text-muted-foreground ml-auto font-mono text-[10.5px]">
          peak {pct(peak(hist?.mem))} · 4 min
        </span>
      </div>
      <SparkBars data={hist?.mem ?? []} tone="var(--warn)" max={100} bars={60} height={64} solid />
      <dl class="mt-4 grid grid-cols-2 gap-x-6 gap-y-2">
        {#each MEM_BREAKDOWN as [key, value] (key)}
          <div class="flex items-baseline justify-between gap-3">
            <dt class="text-muted-foreground text-[12.5px]">{key}</dt>
            <dd class="tabular font-mono text-[11.5px]">{value}</dd>
          </div>
        {/each}
      </dl>
    </div>
  </div>

  <div class="panel overflow-hidden rounded-2xl">
    <div class="flex items-center gap-2.5 px-4.5 py-3.5">
      <h2 class="text-[15px] font-semibold">Filesystems</h2>
      <span class="text-muted-foreground ml-auto font-mono text-[10.5px]">
        {slow?.disks?.length ?? 0} mounted
      </span>
    </div>
    <div class="overflow-x-auto">
      <Table.Root>
        <Table.Header>
          <Table.Row class="hover:bg-transparent">
            <Table.Head>Mount</Table.Head>
            <Table.Head>Device</Table.Head>
            <Table.Head class="w-20">Type</Table.Head>
            <Table.Head class="w-24 text-right">Size</Table.Head>
            <Table.Head class="w-24 text-right">Used</Table.Head>
            <Table.Head class="w-24 text-right">Free</Table.Head>
            <Table.Head class="w-44">Usage</Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {#each slow?.disks ?? [] as d (d.mount)}
            <Table.Row>
              <Table.Cell class="font-mono text-xs">{d.mount}</Table.Cell>
              <Table.Cell class="text-muted-foreground font-mono text-xs">{d.fs}</Table.Cell>
              <Table.Cell class="text-muted-foreground text-xs">{d.type}</Table.Cell>
              <Table.Cell class="tabular text-right">{bytes(d.size)}</Table.Cell>
              <Table.Cell class="tabular text-right">{bytes(d.used)}</Table.Cell>
              <Table.Cell class="tabular text-right">{bytes(d.available)}</Table.Cell>
              <Table.Cell>
                <div class="flex items-center gap-2">
                  <div class="bg-foreground/8 h-1.5 flex-1 overflow-hidden rounded-full">
                    <div class={cn('h-full rounded-full', barTone(d.usePercent))} style="width:{d.usePercent}%"></div>
                  </div>
                  <span class="tabular w-9 text-right text-xs">{pct(d.usePercent, 0)}</span>
                </div>
              </Table.Cell>
            </Table.Row>
          {/each}
          {#if !slow?.disks?.length}
            <Table.Row>
              <Table.Cell colspan={7} class="text-muted-foreground py-10 text-center">Collecting…</Table.Cell>
            </Table.Row>
          {/if}
        </Table.Body>
      </Table.Root>
    </div>
  </div>

  <div class="grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
    <div class="panel overflow-hidden rounded-2xl">
      <div class="flex items-center gap-2.5 px-4.5 py-3.5">
        <h2 class="text-[15px] font-semibold">Network interfaces</h2>
      </div>
      <div class="overflow-x-auto">
        <Table.Root>
          <Table.Header>
            <Table.Row class="hover:bg-transparent">
              <Table.Head>Interface</Table.Head>
              <Table.Head class="w-24">State</Table.Head>
              <Table.Head class="text-right">In</Table.Head>
              <Table.Head class="text-right">Out</Table.Head>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {#each m?.network.interfaces ?? [] as n (n.iface)}
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
                  <div class="text-muted-foreground">{bytes(n.rxTotal)}</div>
                </Table.Cell>
                <Table.Cell class="tabular text-right text-xs">
                  {bytes(n.txSec)}/s
                  <div class="text-muted-foreground">{bytes(n.txTotal)}</div>
                </Table.Cell>
              </Table.Row>
            {/each}
            {#if !m?.network.interfaces?.length}
              <Table.Row>
                <Table.Cell colspan={4} class="text-muted-foreground py-10 text-center">Collecting…</Table.Cell>
              </Table.Row>
            {/if}
          </Table.Body>
        </Table.Root>
      </div>
    </div>

    <div class="panel-raised space-y-3.5 rounded-2xl p-4.5">
      <span class="eyebrow">Throughput · 4 min</span>
      <div>
        <p class="text-muted-foreground mb-1 font-mono text-[10.5px]">
          Network in — peak {bytes(peak(hist?.netRx))}/s
        </p>
        <SparkBars data={hist?.netRx ?? []} tone="var(--ok)" bars={60} height={34} solid />
      </div>
      <div>
        <p class="text-muted-foreground mb-1 font-mono text-[10.5px]">
          Network out — peak {bytes(peak(hist?.netTx))}/s
        </p>
        <SparkBars data={hist?.netTx ?? []} tone="var(--info)" bars={60} height={34} solid />
      </div>
      <div>
        <p class="text-muted-foreground mb-1 font-mono text-[10.5px]">
          Disk read — peak {num(peak(hist?.diskRead))} IO/s
        </p>
        <SparkBars data={hist?.diskRead ?? []} tone="var(--warn)" bars={60} height={28} solid />
      </div>
      <div>
        <p class="text-muted-foreground mb-1 font-mono text-[10.5px]">
          Disk write — peak {num(peak(hist?.diskWrite))} IO/s
        </p>
        <SparkBars data={hist?.diskWrite ?? []} tone="var(--bad)" bars={60} height={28} solid />
      </div>
    </div>
  </div>

  <div class="panel overflow-hidden rounded-2xl">
    <div class="flex flex-wrap items-center gap-2.5 px-4.5 py-3.5">
      <h2 class="text-[15px] font-semibold">OS processes</h2>
      <span class="tabular bg-foreground/8 rounded-full px-2 py-0.5 font-mono text-[10.5px]">
        {num(slow?.processCounts?.all)} total
      </span>
      <span class="tabular bg-ok/14 text-ok rounded-full px-2 py-0.5 font-mono text-[10.5px]">
        {num(slow?.processCounts?.running)} running
      </span>
      <span class="text-muted-foreground ml-auto font-mono text-[10.5px]">top 25 by CPU · every 10s</span>
    </div>
    <div class="max-h-[60vh] overflow-auto">
      <Table.Root>
        <Table.Header class="bg-popover sticky top-0 z-10">
          <Table.Row class="hover:bg-transparent">
            <Table.Head class="w-20 text-right">PID</Table.Head>
            <Table.Head>Name</Table.Head>
            <Table.Head class="w-24">User</Table.Head>
            <Table.Head class="w-20 text-right">CPU</Table.Head>
            <Table.Head class="w-20 text-right">Mem</Table.Head>
            <Table.Head class="w-24 text-right">RSS</Table.Head>
            <Table.Head>Command</Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {#each slow?.processes ?? [] as p (p.pid)}
            <Table.Row>
              <Table.Cell class="text-muted-foreground tabular text-right text-xs">{p.pid}</Table.Cell>
              <Table.Cell class="font-medium">{p.name}</Table.Cell>
              <Table.Cell class="text-muted-foreground text-xs">{p.user}</Table.Cell>
              <Table.Cell class="tabular text-right">{p.cpu}%</Table.Cell>
              <Table.Cell class="tabular text-right">{p.mem}%</Table.Cell>
              <Table.Cell class="tabular text-right">{bytes(p.memRss)}</Table.Cell>
              <Table.Cell
                class="text-muted-foreground max-w-xs truncate font-mono text-xs"
                title="{p.command} {p.params}"
              >
                {p.command}
              </Table.Cell>
            </Table.Row>
          {/each}
          {#if !slow?.processes?.length}
            <Table.Row>
              <Table.Cell colspan={7} class="text-muted-foreground py-10 text-center">Collecting…</Table.Cell>
            </Table.Row>
          {/if}
        </Table.Body>
      </Table.Root>
    </div>
  </div>
</div>
