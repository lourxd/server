<script>
  import { live } from '$lib/live.svelte.js';
  import { bytes, duration, pct, num } from '$lib/format.js';
  import { cn } from '$lib/utils.js';

  import * as Card from '$lib/components/ui/card/index.js';
  import * as Table from '$lib/components/ui/table/index.js';
  import * as Tabs from '$lib/components/ui/tabs/index.js';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Progress } from '$lib/components/ui/progress/index.js';

  import PageHeader from '$lib/components/PageHeader.svelte';
  import Sparkline from '$lib/components/Sparkline.svelte';

  import Search from '@lucide/svelte/icons/search';
  import Thermometer from '@lucide/svelte/icons/thermometer';

  let { data } = $props();

  let procFilter = $state('');

  const m = $derived(live.metrics?.fast);
  const slow = $derived(live.metrics?.slow);
  const hist = $derived(live.metrics?.history);

  const procs = $derived(
    procFilter
      ? (slow?.processes ?? []).filter(
          (p) =>
            p.name.toLowerCase().includes(procFilter.toLowerCase()) ||
            (p.command || '').toLowerCase().includes(procFilter.toLowerCase()),
        )
      : (slow?.processes ?? []),
  );

  const tone = (v) => (v > 90 ? 'bg-bad' : v > 70 ? 'bg-warn' : 'bg-ok');
  const peak = (arr) => (arr?.length ? Math.max(...arr) : 0);

  const MACHINE = $derived([
    ['Hostname', data.host?.hostname],
    ['Distribution', data.host?.distro],
    ['Kernel', data.host?.kernel],
    ['Architecture', data.host?.arch],
    ['Manufacturer', data.host?.manufacturer ?? '—'],
    ['Model', data.host?.model ?? '—'],
    ['Virtualised', data.host?.virtual ? 'yes' : 'no'],
    ['Uptime', m ? duration(m.uptime * 1000) : '—'],
  ]);

  const TOOLCHAIN = $derived([
    ['Processor', data.host?.cpuModel],
    ['Cores', `${data.host?.cpuPhysicalCores} physical / ${data.host?.cpuCores} logical`],
    ['Base clock', `${data.host?.cpuSpeedGhz} GHz`],
    ['Total memory', bytes(data.host?.totalMemory)],
    ['Node.js', `v${data.host?.node}`],
    ['npm', data.host?.npm],
    ['git', data.host?.git ?? '—'],
    ['docker', data.host?.docker || 'not installed'],
  ]);
</script>

<svelte:head><title>System · {data.host?.hostname}</title></svelte:head>

<PageHeader title="System">
  {#snippet children()}
    {#if m}<Badge variant="outline" class="tabular">up {duration(m.uptime * 1000)}</Badge>{/if}
    {#if slow?.temperature}
      <Badge variant="outline" class="tabular gap-1.5">
        <Thermometer class="size-3" />{slow.temperature.main}°C
      </Badge>
    {/if}
  {/snippet}
  {#snippet actions()}
    <Badge
      variant="outline"
      class={cn('gap-1.5', live.connected ? 'border-ok/40 text-ok' : 'border-bad/40 text-bad')}
    >
      <span class="size-1.5 rounded-full bg-current"></span>
      {live.connected ? 'live' : 'offline'}
    </Badge>
  {/snippet}
</PageHeader>

<div class="flex-1 p-5">
  <Tabs.Root value="resources" class="space-y-4">
    <Tabs.List>
      <Tabs.Trigger value="resources">Resources</Tabs.Trigger>
      <Tabs.Trigger value="storage">Storage &amp; network</Tabs.Trigger>
      <Tabs.Trigger value="processes">OS processes</Tabs.Trigger>
      <Tabs.Trigger value="hardware">Hardware</Tabs.Trigger>
    </Tabs.List>

    <Tabs.Content value="resources" class="space-y-3">
      <div class="grid gap-3 lg:grid-cols-2">
        <Card.Root>
          <Card.Header class="flex-row items-center gap-2">
            <Card.Title class="text-base">CPU</Card.Title>
            <div class="ml-auto flex gap-2">
              <Badge variant="outline" class="tabular">{m ? pct(m.cpu.load) : '—'} now</Badge>
              <Badge variant="outline" class="tabular">{pct(peak(hist?.cpu))} peak</Badge>
            </div>
          </Card.Header>
          <Card.Content class="space-y-3">
            <Sparkline data={hist?.cpu ?? []} max={100} height={88} label="CPU load history" />
            <div class="text-muted-foreground flex justify-between text-xs">
              <span>4 minutes ago</span><span>now</span>
            </div>
            <dl class="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[minmax(7rem,auto)_1fr]">
              <dt class="text-muted-foreground">User</dt>
              <dd class="tabular font-mono text-xs">{m ? pct(m.cpu.user) : '—'}</dd>
              <dt class="text-muted-foreground">System</dt>
              <dd class="tabular font-mono text-xs">{m ? pct(m.cpu.system) : '—'}</dd>
              <dt class="text-muted-foreground">Idle</dt>
              <dd class="tabular font-mono text-xs">{m ? pct(m.cpu.idle) : '—'}</dd>
              <dt class="text-muted-foreground">Load average</dt>
              <dd class="tabular font-mono text-xs">{m?.cpu.loadavg.join('  ') ?? '—'} (1/5/15m)</dd>
            </dl>
          </Card.Content>
        </Card.Root>

        <Card.Root>
          <Card.Header class="flex-row items-center gap-2">
            <Card.Title class="text-base">Memory</Card.Title>
            <Badge variant="outline" class="tabular ml-auto">{m ? pct(m.memory.usedPercent) : '—'}</Badge>
          </Card.Header>
          <Card.Content class="space-y-3">
            <Sparkline data={hist?.mem ?? []} max={100} height={88} color="var(--warn)" label="Memory history" />
            <dl class="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[minmax(7rem,auto)_1fr]">
              <dt class="text-muted-foreground">Used</dt>
              <dd class="tabular font-mono text-xs">{m ? bytes(m.memory.used) : '—'}</dd>
              <dt class="text-muted-foreground">Available</dt>
              <dd class="tabular font-mono text-xs">{m ? bytes(m.memory.free) : '—'}</dd>
              <dt class="text-muted-foreground">Cached</dt>
              <dd class="tabular font-mono text-xs">{m ? bytes(m.memory.cached) : '—'}</dd>
              <dt class="text-muted-foreground">Total</dt>
              <dd class="tabular font-mono text-xs">{m ? bytes(m.memory.total) : '—'}</dd>
              <dt class="text-muted-foreground">Swap</dt>
              <dd class="tabular font-mono text-xs">
                {m ? `${bytes(m.memory.swapUsed)} of ${bytes(m.memory.swapTotal)}` : '—'}
              </dd>
            </dl>
          </Card.Content>
        </Card.Root>
      </div>

      <Card.Root>
        <Card.Header class="flex-row items-center gap-2">
          <Card.Title class="text-base">Per-core utilisation</Card.Title>
          <span class="text-muted-foreground ml-auto text-xs">{m?.cpu.cores.length ?? 0} logical cores</span>
        </Card.Header>
        <Card.Content class="space-y-4">
          <div class="grid grid-cols-8 gap-2 md:grid-cols-16">
            {#each m?.cpu.cores ?? [] as c, i (i)}
              <div class="space-y-1">
                <div class="bg-muted flex h-10 items-end overflow-hidden rounded-sm">
                  <div
                    class={cn('w-full rounded-b-sm transition-all duration-500', tone(c))}
                    style="height:{Math.max(c, 3)}%"
                  ></div>
                </div>
                <p class="text-muted-foreground tabular text-center text-[10px]">{i}: {Math.round(c)}%</p>
              </div>
            {/each}
          </div>
          {#if slow?.temperature?.cores?.length}
            <p class="text-muted-foreground tabular text-xs">
              Core temperatures: {slow.temperature.cores.map((t) => `${t}°`).join('  ')} · max {slow
                .temperature.max}°C
            </p>
          {/if}
        </Card.Content>
      </Card.Root>
    </Tabs.Content>

    <Tabs.Content value="storage" class="space-y-3">
      <Card.Root class="gap-0 overflow-hidden py-0">
        <Card.Header class="border-b py-3"><Card.Title class="text-base">Filesystems</Card.Title></Card.Header>
        <Table.Root>
          <Table.Header>
            <Table.Row class="hover:bg-transparent">
              <Table.Head>Mount</Table.Head>
              <Table.Head>Device</Table.Head>
              <Table.Head class="w-20">Type</Table.Head>
              <Table.Head class="w-24 text-right">Size</Table.Head>
              <Table.Head class="w-24 text-right">Used</Table.Head>
              <Table.Head class="w-24 text-right">Free</Table.Head>
              <Table.Head class="w-48">Usage</Table.Head>
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
                    <Progress value={d.usePercent} class="h-1.5 flex-1" indicatorClass={tone(d.usePercent)} />
                    <span class="tabular w-9 text-right text-xs">{pct(d.usePercent, 0)}</span>
                  </div>
                </Table.Cell>
              </Table.Row>
            {/each}
          </Table.Body>
        </Table.Root>
      </Card.Root>

      <div class="grid gap-3 lg:grid-cols-2">
        <Card.Root class="gap-0 overflow-hidden py-0">
          <Card.Header class="border-b py-3">
            <Card.Title class="text-base">Network interfaces</Card.Title>
          </Card.Header>
          <Table.Root>
            <Table.Header>
              <Table.Row class="hover:bg-transparent">
                <Table.Head>Interface</Table.Head>
                <Table.Head class="w-20">State</Table.Head>
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
                      <span class="size-1.5 rounded-full bg-current"></span>{n.state}
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
            </Table.Body>
          </Table.Root>
        </Card.Root>

        <Card.Root>
          <Card.Header><Card.Title class="text-base">Throughput</Card.Title></Card.Header>
          <Card.Content class="space-y-3">
            <div>
              <p class="text-muted-foreground text-xs">Network in — peak {bytes(peak(hist?.netRx))}/s</p>
              <Sparkline data={hist?.netRx ?? []} height={48} color="var(--ok)" label="Network in" />
            </div>
            <div>
              <p class="text-muted-foreground text-xs">Network out — peak {bytes(peak(hist?.netTx))}/s</p>
              <Sparkline data={hist?.netTx ?? []} height={48} color="var(--info)" label="Network out" />
            </div>
            <div>
              <p class="text-muted-foreground text-xs">Disk read / write</p>
              <Sparkline data={hist?.diskRead ?? []} height={36} color="var(--warn)" label="Disk read" />
              <Sparkline data={hist?.diskWrite ?? []} height={36} color="var(--bad)" label="Disk write" />
            </div>
          </Card.Content>
        </Card.Root>
      </div>
    </Tabs.Content>

    <Tabs.Content value="processes">
      <Card.Root class="gap-0 overflow-hidden py-0">
        <Card.Header class="flex-row flex-wrap items-center gap-3 border-b py-3">
          <Card.Title class="text-base">Top OS processes</Card.Title>
          <Badge variant="outline" class="tabular">{num(slow?.processCounts?.all)} total</Badge>
          <Badge variant="outline" class="border-ok/40 text-ok tabular">
            {num(slow?.processCounts?.running)} running
          </Badge>
          <div class="relative ml-auto">
            <Search class="text-muted-foreground pointer-events-none absolute top-2.5 left-2.5 size-3.5" />
            <Input placeholder="Filter…" bind:value={procFilter} class="h-9 w-48 pl-8" />
          </div>
        </Card.Header>
        <div class="max-h-[62vh] overflow-auto">
          <Table.Root>
            <Table.Header class="bg-card sticky top-0 z-10">
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
              {#each procs as p (p.pid)}
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
              {#if !procs.length}
                <Table.Row>
                  <Table.Cell colspan={7} class="text-muted-foreground py-10 text-center">
                    {slow ? 'No process matches the filter.' : 'Collecting…'}
                  </Table.Cell>
                </Table.Row>
              {/if}
            </Table.Body>
          </Table.Root>
        </div>
        <div class="text-muted-foreground border-t px-4 py-2.5 text-xs">
          Top 25 by CPU, refreshed every 10 seconds. Use the Apps page to control managed apps.
        </div>
      </Card.Root>
    </Tabs.Content>

    <Tabs.Content value="hardware">
      <div class="grid gap-3 lg:grid-cols-2">
        <Card.Root>
          <Card.Header><Card.Title class="text-base">Machine</Card.Title></Card.Header>
          <Card.Content>
            <dl class="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[minmax(7rem,auto)_1fr]">
              {#each MACHINE as [key, value] (key)}
                <dt class="text-muted-foreground">{key}</dt>
                <dd class="font-mono text-xs break-all">{value}</dd>
              {/each}
            </dl>
          </Card.Content>
        </Card.Root>

        <Card.Root>
          <Card.Header><Card.Title class="text-base">CPU &amp; toolchain</Card.Title></Card.Header>
          <Card.Content>
            <dl class="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[minmax(7rem,auto)_1fr]">
              {#each TOOLCHAIN as [key, value] (key)}
                <dt class="text-muted-foreground">{key}</dt>
                <dd class="font-mono text-xs break-all">{value}</dd>
              {/each}
            </dl>
          </Card.Content>
        </Card.Root>
      </div>
    </Tabs.Content>
  </Tabs.Root>
</div>
