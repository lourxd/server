<script>
  import { onMount, untrack } from 'svelte';
  import { invalidateAll } from '$app/navigation';
  import { api, apiGet, toasts } from '$lib/live.svelte.js';
  import { bytes, num, duration } from '$lib/format.js';
  import { cn } from '$lib/utils.js';

  import * as Card from '$lib/components/ui/card/index.js';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import * as Table from '$lib/components/ui/table/index.js';
  import * as Tabs from '$lib/components/ui/tabs/index.js';
  import * as Select from '$lib/components/ui/select/index.js';
  import * as Alert from '$lib/components/ui/alert/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import { Textarea } from '$lib/components/ui/textarea/index.js';
  import { Checkbox } from '$lib/components/ui/checkbox/index.js';
  import { Badge } from '$lib/components/ui/badge/index.js';

  import PageHeader from '$lib/components/PageHeader.svelte';
  import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
  import DataTable from '$lib/components/DataTable.svelte';

  import Plus from '@lucide/svelte/icons/plus';
  import Database from '@lucide/svelte/icons/database';
  import Play from '@lucide/svelte/icons/play';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import Pencil from '@lucide/svelte/icons/pencil';
  import RefreshCcw from '@lucide/svelte/icons/refresh-ccw';
  import CircleAlert from '@lucide/svelte/icons/circle-alert';
  import Unplug from '@lucide/svelte/icons/unplug';

  let { data } = $props();

  let activeId = $state(untrack(() => data.connections[0]?.id ?? null));
  let databaseList = $state([]);
  let activeDb = $state(null);
  let tableList = $state([]);
  let activeTable = $state(null);
  let stats = $state(null);
  let connError = $state('');

  let grid = $state({ columns: [], rows: [], total: 0 });
  let page = $state(0);
  let pageSize = $state('50');
  let orderBy = $state(null);
  let orderDir = $state('asc');
  let loading = $state(false);

  let tab = $state('browse');
  let sql = $state('');
  let queryResult = $state(null);
  let queryError = $state('');
  let queryBusy = $state(false);
  let allowDangerous = $state(false);

  let editOpen = $state(false);
  let editing = $state(null);
  let probeMsg = $state('');
  let probeOk = $state(null);
  let deleteOpen = $state(false);

  const active = $derived(data.connections.find((c) => c.id === activeId) ?? null);
  const driver = $derived(active ? data.drivers[active.type] : null);
  const isSql = $derived(driver?.supportsSql ?? false);
  const size = $derived(Number(pageSize));
  const totalPages = $derived(Math.max(1, Math.ceil(grid.total / size)));

  const BLANK = {
    id: null,
    name: '',
    type: 'postgres',
    host: '127.0.0.1',
    port: 5432,
    user: '',
    password: '',
    database: '',
    file: '',
    url: '',
    ssl: false,
    readOnly: false,
    create: false,
  };

  const get = (params) => apiGet('/api/db', params, { quiet: true });

  async function selectConnection(id) {
    activeId = id;
    activeDb = null;
    activeTable = null;
    tableList = [];
    databaseList = [];
    stats = null;
    connError = '';
    queryResult = null;
    grid = { columns: [], rows: [], total: 0 };
    if (!id) return;

    loading = true;
    try {
      databaseList = await get({ op: 'databases', id });
      stats = await get({ op: 'stats', id }).catch(() => null);
      const preferred =
        databaseList.find((d) => d.name === active?.database) ??
        databaseList.find((d) => !d.system && !d.empty) ??
        databaseList[0];
      if (preferred) await selectDatabase(preferred.name);
    } catch (err) {
      connError = err.message;
    } finally {
      loading = false;
    }
  }

  async function selectDatabase(name) {
    activeDb = name;
    activeTable = null;
    grid = { columns: [], rows: [], total: 0 };
    loading = true;
    try {
      tableList = await get({ op: 'tables', id: activeId, database: name });
      connError = '';
    } catch (err) {
      connError = err.message;
      tableList = [];
    } finally {
      loading = false;
    }
  }

  async function selectTable(name) {
    activeTable = name;
    page = 0;
    orderBy = null;
    tab = 'browse';
    await loadRows();
  }

  async function loadRows() {
    if (!activeTable) return;
    loading = true;
    try {
      grid = await get({
        op: 'browse',
        id: activeId,
        database: activeDb,
        table: activeTable,
        limit: size,
        offset: page * size,
        orderBy,
        orderDir,
      });
      connError = '';
    } catch (err) {
      connError = err.message;
      grid = { columns: [], rows: [], total: 0 };
    } finally {
      loading = false;
    }
  }

  async function onSort(col, dir) {
    orderBy = col;
    orderDir = dir;
    page = 0;
    await loadRows();
  }

  async function gotoPage(p) {
    page = Math.max(0, Math.min(p, totalPages - 1));
    await loadRows();
  }

  async function runQuery() {
    if (!sql.trim()) return;
    queryBusy = true;
    queryError = '';
    queryResult = null;
    try {
      queryResult = await api(
        '/api/db',
        { action: 'query', id: activeId, database: activeDb, sql, allowDangerous },
        { quiet: true },
      );
    } catch (err) {
      queryError = err.message;
    } finally {
      queryBusy = false;
    }
  }

  function onSqlKeydown(e) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      runQuery();
    }
  }

  function openNew() {
    editing = { ...BLANK };
    probeMsg = '';
    probeOk = null;
    editOpen = true;
  }

  function openEdit(conn) {
    editing = { ...BLANK, ...conn, password: '', url: '' };
    probeMsg = '';
    probeOk = null;
    editOpen = true;
  }

  function onTypeChange(value) {
    editing.type = value;
    editing.port = data.drivers[value]?.defaultPort ?? '';
  }

  async function probe() {
    probeMsg = 'Connecting…';
    probeOk = null;
    try {
      const res = await api('/api/db', { action: 'probe', connection: editing }, { quiet: true });
      probeOk = true;
      probeMsg = `Connected — ${res.version ?? 'ok'}`;
    } catch (err) {
      probeOk = false;
      probeMsg = err.message;
    }
  }

  async function saveConnection() {
    try {
      const saved = await api('/api/db', { action: 'save', connection: editing });
      toasts.ok('Connection saved', saved.name);
      editOpen = false;
      await invalidateAll();
      await selectConnection(saved.id);
    } catch {
    }
  }

  async function removeConnection() {
    await api('/api/db', { action: 'delete', id: active.id });
    toasts.ok('Connection removed', active.name);
    const remaining = data.connections.filter((c) => c.id !== active.id);
    await invalidateAll();
    await selectConnection(remaining[0]?.id ?? null);
  }

  async function testConnection() {
    try {
      const r = await get({ op: 'test', id: activeId, database: activeDb });
      toasts.ok('Connection healthy', r.version ?? 'ok');
    } catch (err) {
      toasts.error('Connection failed', err.message);
    }
  }

  async function serviceAction(engine, serviceAction) {
    try {
      await api('/api/db', { action: 'service', service: engine.service, serviceAction });
      toasts.ok(`${serviceAction} ${engine.service}`, 'systemd accepted the command.');
      await invalidateAll();
    } catch {
    }
  }

  const childLabel = $derived(
    active?.type === 'mongodb' ? 'Collections' : active?.type === 'redis' ? 'Prefixes' : 'Tables',
  );

  onMount(() => {
    if (activeId) selectConnection(activeId);
  });
</script>

<svelte:head><title>Databases · {data.host?.hostname}</title></svelte:head>

<PageHeader title="Databases">
  {#snippet children()}
    {#if active}
      <Badge variant="outline" class="border-info/40 text-info">{data.drivers[active.type]?.label}</Badge>
      {#if stats}
        <Badge variant="outline" class="tabular">{num(stats.connections)} conns</Badge>
        {#if stats.totalSize}<Badge variant="outline" class="tabular">{bytes(stats.totalSize)}</Badge>{/if}
        {#if stats.uptimeSec}
          <Badge variant="outline" class="tabular">up {duration(stats.uptimeSec * 1000)}</Badge>
        {/if}
      {/if}
    {/if}
  {/snippet}
  {#snippet actions()}
    <Button size="sm" onclick={openNew}><Plus class="size-4" /> Add connection</Button>
  {/snippet}
</PageHeader>

<div class="flex-1 space-y-4 p-5">
  {#if !data.connections.length}
    <Card.Root>
      <div class="flex flex-col items-center gap-3 px-6 py-16 text-center">
        <div class="bg-muted grid size-11 place-items-center rounded-full">
          <Database class="text-muted-foreground size-5" />
        </div>
        <div>
          <h3 class="font-medium">No database connections yet</h3>
          <p class="text-muted-foreground mt-1 text-sm">
            Connect to PostgreSQL, MySQL/MariaDB, MongoDB, Redis, or open a SQLite file.
          </p>
        </div>
        <Button size="sm" onclick={openNew}>Add a connection</Button>
      </div>
    </Card.Root>

    <Card.Root class="gap-0 overflow-hidden py-0">
      <Card.Header class="border-b py-3">
        <Card.Title class="text-base">Engines on this machine</Card.Title>
      </Card.Header>
      <Table.Root>
        <Table.Header>
          <Table.Row class="hover:bg-transparent">
            <Table.Head>Engine</Table.Head>
            <Table.Head class="w-32">Installed</Table.Head>
            <Table.Head class="w-28">Service</Table.Head>
            <Table.Head class="w-36">Port</Table.Head>
            <Table.Head class="w-40"></Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {#each data.engines as e (e.binary)}
            <Table.Row>
              <Table.Cell>
                {e.label} <span class="text-muted-foreground font-mono text-xs">{e.binary}</span>
              </Table.Cell>
              <Table.Cell>
                {#if e.installed}
                  <Badge variant="outline" class="border-ok/40 text-ok gap-1.5">
                    <span class="size-1.5 rounded-full bg-current"></span>yes
                  </Badge>
                {:else}
                  <Badge variant="outline" class="text-muted-foreground">not installed</Badge>
                {/if}
              </Table.Cell>
              <Table.Cell>
                {#if e.serviceState}
                  <Badge variant="outline" class={e.serviceState === 'active' ? 'border-ok/40 text-ok' : ''}>
                    {e.serviceState}
                  </Badge>
                {:else}
                  <span class="text-muted-foreground">—</span>
                {/if}
              </Table.Cell>
              <Table.Cell class="font-mono text-xs">
                {#if e.port}
                  {e.port}
                  {#if e.listening}
                    <Badge variant="outline" class="border-ok/40 text-ok ml-1 text-[10px]">listening</Badge>
                  {/if}
                {:else}
                  <span class="text-muted-foreground">n/a</span>
                {/if}
              </Table.Cell>
              <Table.Cell class="text-right">
                {#if e.installed && e.service}
                  {#if e.serviceState === 'active'}
                    <Button variant="outline" size="sm" class="h-7" onclick={() => serviceAction(e, 'restart')}>
                      Restart
                    </Button>
                    <Button variant="outline" size="sm" class="h-7" onclick={() => serviceAction(e, 'stop')}>
                      Stop
                    </Button>
                  {:else}
                    <Button variant="outline" size="sm" class="h-7" onclick={() => serviceAction(e, 'start')}>
                      Start
                    </Button>
                  {/if}
                {/if}
              </Table.Cell>
            </Table.Row>
          {/each}
        </Table.Body>
      </Table.Root>
      <div class="text-muted-foreground border-t px-4 py-2.5 text-xs">
        SQLite works with no installation — Node has it built in. Service controls need passwordless
        sudo for <code class="font-mono">systemctl</code>.
      </div>
    </Card.Root>
  {:else}
    <div class="grid gap-4 lg:grid-cols-[15rem_1fr]">
      <div class="space-y-3 lg:sticky lg:top-20 lg:self-start">
        <Card.Root class="gap-0 overflow-hidden py-0">
          <Card.Header class="border-b py-2.5"><Card.Title class="text-sm">Connections</Card.Title></Card.Header>
          {#each data.connections as c (c.id)}
            <button
              type="button"
              onclick={() => selectConnection(c.id)}
              class={cn(
                'flex w-full items-center gap-2 border-b px-3 py-2 text-left text-sm last:border-b-0',
                c.id === activeId ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/50',
              )}
            >
              <span class={cn('size-1.5 rounded-full', c.id === activeId ? 'bg-ok' : 'bg-muted-foreground')}
              ></span>
              <span class="truncate">{c.name}</span>
              <span class="text-muted-foreground ml-auto text-xs">{c.type}</span>
            </button>
          {/each}
        </Card.Root>

        {#if databaseList.length}
          <Card.Root class="gap-0 overflow-hidden py-0">
            <Card.Header class="border-b py-2.5">
              <Card.Title class="text-sm">
                {active.type === 'redis' ? 'Keyspaces' : 'Databases'}
              </Card.Title>
            </Card.Header>
            <div class="max-h-52 overflow-auto">
              {#each databaseList as d (d.name)}
                <button
                  type="button"
                  onclick={() => selectDatabase(d.name)}
                  class={cn(
                    'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm',
                    d.name === activeDb ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/50',
                  )}
                >
                  <span class="truncate">{d.name}</span>
                  <span class="text-muted-foreground tabular ml-auto text-xs">
                    {d.keys != null ? `${num(d.keys)} keys` : d.size ? bytes(d.size) : ''}
                  </span>
                </button>
              {/each}
            </div>
          </Card.Root>
        {/if}

        {#if tableList.length}
          <Card.Root class="gap-0 overflow-hidden py-0">
            <Card.Header class="flex-row items-center gap-2 border-b py-2.5">
              <Card.Title class="text-sm">{childLabel}</Card.Title>
              <Badge variant="outline" class="ml-auto">{tableList.length}</Badge>
            </Card.Header>
            <div class="max-h-[46vh] overflow-auto">
              {#each tableList as t (t.name)}
                <button
                  type="button"
                  onclick={() => selectTable(t.name)}
                  title="{t.name} — {num(t.rows)} rows"
                  class={cn(
                    'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm',
                    t.name === activeTable
                      ? 'bg-accent text-foreground'
                      : 'text-muted-foreground hover:bg-accent/50',
                  )}
                >
                  <span class="truncate">{t.name}</span>
                  <span class="text-muted-foreground tabular ml-auto text-xs">{num(t.rows)}</span>
                </button>
              {/each}
            </div>
          </Card.Root>
        {/if}

        <div class="flex gap-1.5">
          <Button variant="outline" size="sm" class="h-7 flex-1" onclick={() => openEdit(active)}>
            <Pencil class="size-3.5" />
          </Button>
          <Button variant="outline" size="sm" class="h-7 flex-1" onclick={() => selectConnection(activeId)}>
            <RefreshCcw class="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            class="text-bad hover:text-bad hover:bg-bad/10 h-7 flex-1"
            onclick={() => (deleteOpen = true)}
          >
            <Trash2 class="size-3.5" />
          </Button>
        </div>
      </div>

      <div class="min-w-0 space-y-3">
        {#if connError}
          <Alert.Root variant="destructive">
            <CircleAlert class="size-4" />
            <Alert.Description>{connError}</Alert.Description>
          </Alert.Root>
        {/if}

        <Tabs.Root bind:value={tab} class="space-y-3">
          <Tabs.List>
            <Tabs.Trigger value="browse">Browse</Tabs.Trigger>
            <Tabs.Trigger value="query">{isSql ? 'SQL console' : 'Command console'}</Tabs.Trigger>
            <Tabs.Trigger value="schema">Schema</Tabs.Trigger>
            <Tabs.Trigger value="server">Server</Tabs.Trigger>
          </Tabs.List>

          <Tabs.Content value="browse">
            {#if !activeTable}
              <Card.Root>
                <p class="text-muted-foreground py-14 text-center text-sm">
                  Choose a {childLabel.toLowerCase().replace(/es$|s$/, '')} on the left to browse it.
                </p>
              </Card.Root>
            {:else}
              <Card.Root class="gap-0 overflow-hidden py-0">
                <Card.Header class="flex-row flex-wrap items-center gap-3 border-b py-3">
                  <Card.Title class="text-base">{activeTable}</Card.Title>
                  <Badge variant="outline" class="tabular">{num(grid.total)} rows</Badge>
                  <div class="ml-auto flex items-center gap-2">
                    <Select.Root type="single" bind:value={pageSize} onValueChange={() => gotoPage(0)}>
                      <Select.Trigger class="h-8 w-28">{pageSize} / page</Select.Trigger>
                      <Select.Content>
                        {#each ['25', '50', '100', '250', '500'] as n (n)}
                          <Select.Item value={n}>{n} / page</Select.Item>
                        {/each}
                      </Select.Content>
                    </Select.Root>
                    <Button variant="outline" size="sm" class="h-8" disabled={loading} onclick={loadRows}>
                      <RefreshCcw class="size-3.5" />
                    </Button>
                  </div>
                </Card.Header>
                <DataTable columns={grid.columns} rows={grid.rows} bind:orderBy bind:orderDir sortable onsort={onSort} />
                <div class="flex items-center gap-3 border-t px-4 py-2.5">
                  <Button variant="outline" size="sm" class="h-7" disabled={page === 0} onclick={() => gotoPage(page - 1)}>
                    Previous
                  </Button>
                  <span class="text-muted-foreground tabular text-xs">Page {page + 1} of {totalPages}</span>
                  <Button
                    variant="outline"
                    size="sm"
                    class="h-7"
                    disabled={page + 1 >= totalPages}
                    onclick={() => gotoPage(page + 1)}
                  >
                    Next
                  </Button>
                  <span class="text-muted-foreground tabular ml-auto text-xs">
                    rows {grid.total ? page * size + 1 : 0}–{Math.min((page + 1) * size, grid.total)}
                  </span>
                </div>
              </Card.Root>
            {/if}
          </Tabs.Content>

          <Tabs.Content value="query" class="space-y-3">
            <Card.Root class="gap-0 py-0">
              <Card.Header class="flex-row flex-wrap items-center gap-3 border-b py-3">
                <Card.Title class="text-base">{isSql ? 'SQL console' : 'Command console'}</Card.Title>
                <span class="text-muted-foreground text-xs">{activeDb ? `on ${activeDb}` : ''}</span>
                <div class="ml-auto flex items-center gap-3">
                  {#if !isSql}
                    <div class="flex items-center gap-2">
                      <Checkbox id="dangerous" bind:checked={allowDangerous} />
                      <Label for="dangerous" class="text-xs font-normal">allow destructive</Label>
                    </div>
                  {/if}
                  <Button size="sm" class="h-8" disabled={queryBusy || !sql.trim()} onclick={runQuery}>
                    <Play class="size-3.5" />
                    {queryBusy ? 'Running…' : 'Run'}
                  </Button>
                </div>
              </Card.Header>
              <Card.Content class="space-y-2 py-4">
                <Textarea
                  rows={7}
                  bind:value={sql}
                  onkeydown={onSqlKeydown}
                  class="font-mono text-xs"
                  placeholder={isSql
                    ? 'select * from users order by created_at desc limit 20;'
                    : active.type === 'redis'
                      ? 'KEYS user:*'
                      : 'db.users.find({"status":"active"})'}
                />
                <p class="text-muted-foreground text-xs">
                  {#if isSql}
                    Runs against <code class="font-mono">{activeDb ?? 'the default database'}</code>. Writes are
                    permitted — this is a full console. ⌘/Ctrl + Enter to run.
                  {:else if active.type === 'redis'}
                    Any Redis command. FLUSHALL, FLUSHDB, CONFIG and EVAL need the destructive checkbox.
                  {:else}
                    A JSON filter, or <code class="font-mono">db.collection.find(…)</code> / <code
                      class="font-mono">.aggregate([…])</code
                    >.
                  {/if}
                </p>
              </Card.Content>
            </Card.Root>

            {#if queryError}
              <Alert.Root variant="destructive">
                <CircleAlert class="size-4" />
                <Alert.Description class="font-mono text-xs whitespace-pre-wrap">{queryError}</Alert.Description>
              </Alert.Root>
            {/if}

            {#if queryResult}
              <Card.Root class="gap-0 overflow-hidden py-0">
                <Card.Header class="flex-row flex-wrap items-center gap-2 border-b py-3">
                  <Card.Title class="text-base">Result</Card.Title>
                  <Badge variant="outline" class="tabular">{num(queryResult.rowCount)} rows</Badge>
                  <Badge variant="outline" class="tabular">{queryResult.durationMs} ms</Badge>
                  {#if queryResult.truncated}
                    <Badge variant="outline" class="border-warn/40 text-warn">truncated</Badge>
                  {/if}
                </Card.Header>
                <DataTable columns={queryResult.columns} rows={queryResult.rows} maxHeight="46vh" />
              </Card.Root>
            {/if}
          </Tabs.Content>

          <Tabs.Content value="schema">
            <Card.Root class="gap-0 overflow-hidden py-0">
              <Card.Header class="flex-row items-center gap-3 border-b py-3">
                <Card.Title class="text-base">{activeTable ?? 'Schema'}</Card.Title>
                <span class="text-muted-foreground ml-auto text-xs">{activeDb}</span>
              </Card.Header>
              {#if !activeTable}
                <p class="text-muted-foreground py-14 text-center text-sm">
                  Select a table to inspect its columns.
                </p>
              {:else}
                <Table.Root>
                  <Table.Header>
                    <Table.Row class="hover:bg-transparent">
                      <Table.Head class="w-12 text-right">#</Table.Head>
                      <Table.Head>Column</Table.Head>
                      <Table.Head>Type</Table.Head>
                      <Table.Head class="w-24">Nullable</Table.Head>
                      <Table.Head>Default</Table.Head>
                      <Table.Head class="w-20">Key</Table.Head>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {#each grid.columns as c (c.name)}
                      <Table.Row>
                        <Table.Cell class="text-muted-foreground tabular text-right text-xs">
                          {c.position ?? ''}
                        </Table.Cell>
                        <Table.Cell class="font-mono text-xs font-medium">{c.name}</Table.Cell>
                        <Table.Cell class="font-mono text-xs">{c.type ?? '—'}</Table.Cell>
                        <Table.Cell class="text-xs">{c.nullable ? 'yes' : 'no'}</Table.Cell>
                        <Table.Cell class="text-muted-foreground max-w-44 truncate font-mono text-xs">
                          {c.default ?? '—'}
                        </Table.Cell>
                        <Table.Cell>
                          {#if c.primaryKey}
                            <Badge variant="outline" class="border-info/40 text-info text-[10px]">PK</Badge>
                          {:else if c.foreignKey}
                            <Badge variant="secondary" class="text-[10px]">FK</Badge>
                          {/if}
                        </Table.Cell>
                      </Table.Row>
                    {/each}
                  </Table.Body>
                </Table.Root>
              {/if}
            </Card.Root>
          </Tabs.Content>

          <Tabs.Content value="server">
            <div class="grid gap-3 xl:grid-cols-2">
              <Card.Root>
                <Card.Header><Card.Title class="text-base">Server statistics</Card.Title></Card.Header>
                <Card.Content>
                  {#if stats}
                    <dl class="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[minmax(8rem,auto)_1fr]">
                      {#each Object.entries(stats) as [k, v] (k)}
                        <dt class="text-muted-foreground">{k.replace(/([A-Z])/g, ' $1').toLowerCase()}</dt>
                        <dd class="font-mono text-xs break-all">
                          {#if k.toLowerCase().includes('size') || k === 'memoryPeak'}{bytes(v)}
                          {:else if k === 'uptimeSec'}{duration(v * 1000)}
                          {:else if typeof v === 'object'}{JSON.stringify(v)}
                          {:else}{v}{/if}
                        </dd>
                      {/each}
                    </dl>
                  {:else}
                    <p class="text-muted-foreground text-sm">No statistics available.</p>
                  {/if}
                </Card.Content>
              </Card.Root>

              <Card.Root>
                <Card.Header><Card.Title class="text-base">Connection</Card.Title></Card.Header>
                <Card.Content class="space-y-4">
                  <dl class="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[minmax(8rem,auto)_1fr]">
                    <dt class="text-muted-foreground">Name</dt>
                    <dd class="font-mono text-xs">{active.name}</dd>
                    <dt class="text-muted-foreground">Type</dt>
                    <dd class="font-mono text-xs">{data.drivers[active.type]?.label}</dd>
                    {#if active.type === 'sqlite'}
                      <dt class="text-muted-foreground">File</dt>
                      <dd class="font-mono text-xs break-all">{active.file}</dd>
                    {:else}
                      <dt class="text-muted-foreground">Host</dt>
                      <dd class="font-mono text-xs">{active.host}:{active.port}</dd>
                      <dt class="text-muted-foreground">User</dt>
                      <dd class="font-mono text-xs">{active.user || '—'}</dd>
                      <dt class="text-muted-foreground">Password</dt>
                      <dd class="font-mono text-xs">{active.hasPassword ? 'stored (encrypted)' : 'none'}</dd>
                      <dt class="text-muted-foreground">TLS</dt>
                      <dd class="font-mono text-xs">{active.ssl ? 'enabled' : 'disabled'}</dd>
                    {/if}
                  </dl>
                  <div class="flex gap-2">
                    <Button variant="outline" size="sm" onclick={testConnection}>Test connection</Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onclick={async () => {
                        await api('/api/db', { action: 'disconnect', id: activeId });
                        toasts.ok('Pool closed', 'It reconnects on the next query.');
                      }}
                    >
                      <Unplug class="size-3.5" /> Close pool
                    </Button>
                  </div>
                </Card.Content>
              </Card.Root>
            </div>
          </Tabs.Content>
        </Tabs.Root>
      </div>
    </div>
  {/if}
</div>

<Dialog.Root bind:open={editOpen}>
  <Dialog.Content class="max-h-[88vh] overflow-y-auto">
    <Dialog.Header>
      <Dialog.Title>{editing?.id ? `Edit ${editing.name}` : 'Add a database connection'}</Dialog.Title>
    </Dialog.Header>

    {#if editing}
      <div class="space-y-4">
        <div class="space-y-2">
          <Label for="conn-name">Name</Label>
          <Input id="conn-name" bind:value={editing.name} placeholder="production-db" />
        </div>

        <div class="space-y-2">
          <Label>Engine</Label>
          <Select.Root type="single" value={editing.type} onValueChange={onTypeChange}>
            <Select.Trigger class="w-full">{data.drivers[editing.type]?.label}</Select.Trigger>
            <Select.Content>
              {#each Object.entries(data.drivers) as [key, d] (key)}
                <Select.Item value={key}>{d.label}</Select.Item>
              {/each}
            </Select.Content>
          </Select.Root>
        </div>

        {#if editing.type === 'sqlite'}
          <div class="space-y-2">
            <Label for="conn-file">Database file</Label>
            <Input id="conn-file" bind:value={editing.file} placeholder="/path/to/app/data.db" />
          </div>
          <div class="flex gap-5">
            <div class="flex items-center gap-2">
              <Checkbox id="create" bind:checked={editing.create} />
              <Label for="create" class="font-normal">Create if missing</Label>
            </div>
            <div class="flex items-center gap-2">
              <Checkbox id="readonly" bind:checked={editing.readOnly} />
              <Label for="readonly" class="font-normal">Read only</Label>
            </div>
          </div>
        {:else}
          <div class="grid grid-cols-3 gap-3">
            <div class="col-span-2 space-y-2">
              <Label for="conn-host">Host</Label>
              <Input id="conn-host" bind:value={editing.host} placeholder="127.0.0.1" />
            </div>
            <div class="space-y-2">
              <Label for="conn-port">Port</Label>
              <Input id="conn-port" type="number" bind:value={editing.port} />
            </div>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div class="space-y-2">
              <Label for="conn-user">User</Label>
              <Input id="conn-user" bind:value={editing.user} autocomplete="off" />
            </div>
            <div class="space-y-2">
              <Label for="conn-pass">
                Password
                {#if editing.id}<span class="text-muted-foreground text-xs">(blank keeps)</span>{/if}
              </Label>
              <Input id="conn-pass" type="password" bind:value={editing.password} autocomplete="new-password" />
            </div>
          </div>
          <div class="space-y-2">
            <Label for="conn-db">Default database</Label>
            <Input id="conn-db" bind:value={editing.database} />
          </div>
          <div class="space-y-2">
            <Label for="conn-url">Connection URL <span class="text-muted-foreground">(optional)</span></Label>
            <Input
              id="conn-url"
              bind:value={editing.url}
              placeholder="postgres://user:pass@host:5432/db"
              autocomplete="off"
            />
          </div>
          <div class="flex items-center gap-2">
            <Checkbox id="ssl" bind:checked={editing.ssl} />
            <Label for="ssl" class="font-normal">Use TLS</Label>
          </div>
        {/if}

        {#if probeMsg}
          <Alert.Root variant={probeOk === false ? 'destructive' : 'default'}>
            <Alert.Description class="text-xs">{probeMsg}</Alert.Description>
          </Alert.Root>
        {/if}

        <Alert.Root>
          <Alert.Description class="text-xs">
            Passwords are encrypted with AES-256-GCM before being stored in
            <code class="font-mono">data/panel.db</code>, using a key held separately in
            <code class="font-mono">data/secret.key</code>.
          </Alert.Description>
        </Alert.Root>
      </div>
    {/if}

    <Dialog.Footer>
      <Button variant="outline" onclick={() => (editOpen = false)}>Cancel</Button>
      <Button variant="outline" onclick={probe}>Test</Button>
      <Button disabled={!editing?.name} onclick={saveConnection}>Save</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<ConfirmDialog
  bind:open={deleteOpen}
  title="Remove {active?.name}?"
  description="This removes the saved connection and its stored credentials from this panel. The database itself is not touched."
  confirmLabel="Remove connection"
  destructive
  onconfirm={removeConnection}
/>
