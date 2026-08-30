<script>
  import { invalidateAll } from '$app/navigation';
  import { api, apiGet, streamPost, toasts, live } from '$lib/live.svelte.js';
  import { bytes, relTime } from '$lib/format.js';
  import { cn } from '$lib/utils.js';

  import * as Card from '$lib/components/ui/card/index.js';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import * as Table from '$lib/components/ui/table/index.js';
  import * as Alert from '$lib/components/ui/alert/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import { Badge } from '$lib/components/ui/badge/index.js';

  import PageHeader from '$lib/components/PageHeader.svelte';
  import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
  import LogStream from '$lib/components/LogStream.svelte';

  import Plus from '@lucide/svelte/icons/plus';
  import Search from '@lucide/svelte/icons/search';
  import GitBranch from '@lucide/svelte/icons/git-branch';
  import GitFork from '@lucide/svelte/icons/git-fork';
  import Download from '@lucide/svelte/icons/download';
  import RefreshCcw from '@lucide/svelte/icons/refresh-ccw';
  import Package from '@lucide/svelte/icons/package';
  import Hammer from '@lucide/svelte/icons/hammer';
  import Play from '@lucide/svelte/icons/play';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import ExternalLink from '@lucide/svelte/icons/external-link';
  import ArrowUp from '@lucide/svelte/icons/arrow-up';
  import ArrowDown from '@lucide/svelte/icons/arrow-down';

  let { data } = $props();

  let filter = $state('');
  let cloneOpen = $state(false);
  let ghOpen = $state(false);
  let runOpen = $state(false);
  let confirmOpen = $state(false);
  let confirmState = $state({ title: '', description: '', label: '', action: null });

  let cloneUrl = $state('');
  let cloneName = $state('');
  let cloneBranch = $state('');

  let ghRepos = $state([]);
  let ghLoading = $state(false);
  let ghFilter = $state('');

  let runTitle = $state('');
  let runLines = $state([]);
  let runBusy = $state(false);
  let runFilter = $state('');

  const shown = $derived(
    filter
      ? data.repos.filter(
          (r) =>
            r.name.toLowerCase().includes(filter.toLowerCase()) ||
            (r.remote || '').toLowerCase().includes(filter.toLowerCase()),
        )
      : data.repos,
  );

  const ghShown = $derived(
    ghFilter ? ghRepos.filter((r) => r.fullName.toLowerCase().includes(ghFilter.toLowerCase())) : ghRepos,
  );

  const appFor = (repo) => live.apps.find((a) => a.cwd === repo.path);

  async function stream(title, body) {
    runTitle = title;
    runLines = [];
    runBusy = true;
    runOpen = true;

    let ok = false;
    try {
      await streamPost('/api/repos/run', body, (event, payload) => {
        if (event === 'line') runLines = [...runLines, payload];
        else if (event === 'done') ok = payload.ok;
      });
    } catch (err) {
      runLines = [...runLines, { stream: 'err', line: err.message }];
    } finally {
      runBusy = false;
    }

    ok
      ? toasts.ok(title, 'Completed successfully.')
      : toasts.error(title, 'Finished with errors — see the output.');
    await invalidateAll();
    return ok;
  }

  async function doClone() {
    cloneOpen = false;
    const ok = await stream(`Clone ${cloneUrl.split('/').pop()}`, {
      action: 'clone',
      url: cloneUrl,
      name: cloneName || undefined,
      branch: cloneBranch || undefined,
    });
    if (ok) {
      cloneUrl = '';
      cloneName = '';
      cloneBranch = '';
    }
  }

  async function loadGithub() {
    ghOpen = true;
    if (ghRepos.length) return;
    ghLoading = true;
    try {
      ghRepos = await apiGet('/api/repos', { source: 'github' }, { quiet: true });
    } catch (err) {
      toasts.error('Could not list GitHub repositories', err.message);
    } finally {
      ghLoading = false;
    }
  }

  function cloneFromGithub(r) {
    ghOpen = false;
    cloneUrl = r.cloneUrl;
    cloneName = r.name;
    cloneBranch = '';
    doClone();
  }

  function askDelete(repo) {
    confirmState = {
      title: `Delete ${repo.name}?`,
      description: `This permanently removes ${repo.path} from disk, including any uncommitted work${
        repo.dirty ? ` — and this repository has ${repo.dirty} uncommitted change(s)` : ''
      }. It cannot be undone.`,
      label: 'Delete from disk',
      action: async () => {
        await api('/api/repos', { action: 'delete', path: repo.relPath });
        toasts.ok('Repository deleted', repo.name);
        await invalidateAll();
      },
    };
    confirmOpen = true;
  }

  async function startApp(repo) {
    try {
      await api('/api/apps', {
        action: 'start',
        cwd: repo.relPath,
        ecosystem: repo.ecosystemFile ?? undefined,
        script: repo.ecosystemFile ? undefined : (repo.pkg?.main ?? 'server.js'),
        name: repo.name,
      });
      toasts.ok('App started', repo.name);
    } catch {
    }
  }
</script>

<svelte:head><title>Repositories · {data.host?.hostname}</title></svelte:head>

<PageHeader title="Repositories">
  {#snippet children()}
    <Badge variant="outline">{data.repos.length}</Badge>
    {#if data.github.connected}
      <Badge variant="outline" class="border-ok/40 text-ok gap-1.5">
        <GitFork class="size-3" />{data.github.login}
      </Badge>
    {:else}
      <Badge variant="outline" class="text-muted-foreground">GitHub not connected</Badge>
    {/if}
  {/snippet}
  {#snippet actions()}
    <div class="relative">
      <Search class="text-muted-foreground pointer-events-none absolute top-2.5 left-2.5 size-3.5" />
      <Input placeholder="Filter…" bind:value={filter} class="h-9 w-44 pl-8" />
    </div>
    {#if data.github.connected}
      <Button variant="outline" size="sm" onclick={loadGithub}><GitFork class="size-4" /> From GitHub</Button>
    {/if}
    <Button size="sm" onclick={() => (cloneOpen = true)}><Plus class="size-4" /> Clone</Button>
  {/snippet}
</PageHeader>

<div class="flex-1 space-y-4 p-5">
  <p class="text-muted-foreground text-xs">
    Projects directory: <code class="font-mono">{data.projectsDir}</code>
    {#if !data.github.connected}
      · <a href="/settings" class="underline">Add a GitHub token</a> to browse private repositories.
    {/if}
  </p>

  {#if !data.repos.length}
    <Card.Root>
      <div class="flex flex-col items-center gap-3 px-6 py-16 text-center">
        <div class="bg-muted grid size-11 place-items-center rounded-full">
          <GitBranch class="text-muted-foreground size-5" />
        </div>
        <div>
          <h3 class="font-medium">No repositories yet</h3>
          <p class="text-muted-foreground mt-1 text-sm">Clone one from GitHub or any git URL.</p>
        </div>
        <div class="flex gap-2">
          <Button size="sm" onclick={() => (cloneOpen = true)}><Plus class="size-4" /> Clone</Button>
          {#if data.github.connected}
            <Button variant="outline" size="sm" onclick={loadGithub}>Browse GitHub</Button>
          {/if}
        </div>
      </div>
    </Card.Root>
  {:else}
    <div class="grid gap-3 xl:grid-cols-2">
      {#each shown as r (r.path)}
        {@const app = appFor(r)}
        <Card.Root class="gap-0 py-0">
          <Card.Header class="flex-row flex-wrap items-center gap-2 border-b py-3">
            <Card.Title class="truncate text-base">{r.name}</Card.Title>
            {#if r.error}
              <Badge variant="outline" class="border-bad/40 text-bad">error</Badge>
            {:else}
              <Badge variant="outline" class="border-info/40 text-info gap-1">
                <GitBranch class="size-3" />{r.branch}
              </Badge>
              {#if r.dirty}
                <Badge variant="outline" class="border-warn/40 text-warn">{r.dirty} uncommitted</Badge>
              {/if}
              {#if r.behind}
                <Badge variant="outline" class="border-warn/40 text-warn gap-0.5">
                  <ArrowDown class="size-3" />{r.behind}
                </Badge>
              {/if}
              {#if r.ahead}
                <Badge variant="outline" class="gap-0.5"><ArrowUp class="size-3" />{r.ahead}</Badge>
              {/if}
            {/if}
            {#if app}
              <a href="/apps/{app.pmId}" class="ml-auto">
                <Badge
                  variant="outline"
                  class={cn(
                    'gap-1.5',
                    app.status === 'online' ? 'border-ok/40 text-ok' : 'text-muted-foreground',
                  )}
                >
                  <span class="size-1.5 rounded-full bg-current"></span>{app.status}
                </Badge>
              </a>
            {/if}
          </Card.Header>

          <Card.Content class="space-y-3 py-4">
            {#if r.error}
              <Alert.Root variant="destructive"><Alert.Description>{r.error}</Alert.Description></Alert.Root>
            {:else}
              <p class="text-muted-foreground truncate font-mono text-xs" title={r.remote}>
                {r.remote ?? 'no remote'}
              </p>

              {#if r.lastCommit}
                <div class="text-sm">
                  <span class="text-muted-foreground font-mono text-xs">{r.lastCommit.short}</span>
                  <span class="ml-1">{r.lastCommit.subject}</span>
                  <p class="text-muted-foreground mt-0.5 text-xs">
                    {r.lastCommit.author} · {relTime(r.lastCommit.date)}
                  </p>
                </div>
              {/if}

              <div class="flex flex-wrap gap-1.5">
                {#if r.pkg?.name}
                  <Badge variant="secondary" class="font-mono text-[10px]">
                    {r.pkg.name}{r.pkg.version ? `@${r.pkg.version}` : ''}
                  </Badge>
                {/if}
                {#if r.packageManager}
                  <Badge variant="secondary" class="text-[10px]">{r.packageManager}</Badge>
                {/if}
                {#if r.ecosystemFile}
                  <Badge variant="outline" class="border-info/40 text-info text-[10px]">
                    {r.ecosystemFile}
                  </Badge>
                {/if}
                {#if r.pkg && !r.hasNodeModules}
                  <Badge variant="outline" class="border-warn/40 text-warn text-[10px]">
                    deps not installed
                  </Badge>
                {/if}
              </div>

              <div class="flex flex-wrap items-center gap-1.5 pt-1">
                <Button
                  variant="outline"
                  size="sm"
                  class="h-7"
                  onclick={() => stream(`Pull ${r.name}`, { action: 'pull', path: r.relPath })}
                >
                  <Download class="size-3.5" /> Pull
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  class="h-7"
                  onclick={() => stream(`Fetch ${r.name}`, { action: 'fetch', path: r.relPath })}
                >
                  <RefreshCcw class="size-3.5" /> Fetch
                </Button>
                {#if r.pkg}
                  <Button
                    variant="outline"
                    size="sm"
                    class="h-7"
                    onclick={() => stream(`Install deps — ${r.name}`, { action: 'install', path: r.relPath })}
                  >
                    <Package class="size-3.5" /> {r.hasNodeModules ? 'Reinstall' : 'Install'}
                  </Button>
                {/if}
                {#if r.pkg?.scripts?.includes('build')}
                  <Button
                    variant="outline"
                    size="sm"
                    class="h-7"
                    onclick={() =>
                      stream(`Build ${r.name}`, { action: 'run-script', path: r.relPath, script: 'build' })}
                  >
                    <Hammer class="size-3.5" /> Build
                  </Button>
                {/if}
                {#if !app}
                  <Button size="sm" class="h-7" onclick={() => startApp(r)}>
                    <Play class="size-3.5" /> Start app
                  </Button>
                {/if}
                <div class="ml-auto flex gap-1">
                  {#if r.remoteWeb}
                    <Button variant="ghost" size="sm" class="h-7 px-2" href={r.remoteWeb} target="_blank">
                      <ExternalLink class="size-3.5" />
                    </Button>
                  {/if}
                  <Button
                    variant="ghost"
                    size="sm"
                    class="text-bad hover:text-bad hover:bg-bad/10 h-7 px-2"
                    onclick={() => askDelete(r)}
                  >
                    <Trash2 class="size-3.5" />
                  </Button>
                </div>
              </div>
            {/if}
          </Card.Content>
        </Card.Root>
      {/each}
    </div>
    {#if !shown.length}
      <Card.Root>
        <p class="text-muted-foreground py-12 text-center text-sm">No repository matches “{filter}”.</p>
      </Card.Root>
    {/if}
  {/if}
</div>

<Dialog.Root bind:open={cloneOpen}>
  <Dialog.Content>
    <Dialog.Header>
      <Dialog.Title>Clone a repository</Dialog.Title>
      <Dialog.Description>Clones into {data.projectsDir}.</Dialog.Description>
    </Dialog.Header>
    <div class="space-y-4">
      <div class="space-y-2">
        <Label for="clone-url">Repository URL</Label>
        <!-- svelte-ignore a11y_autofocus -->
        <Input id="clone-url" bind:value={cloneUrl} placeholder="https://github.com/owner/repo.git" autofocus />
      </div>
      <div class="space-y-2">
        <Label for="clone-name">Directory name <span class="text-muted-foreground">(optional)</span></Label>
        <Input
          id="clone-name"
          bind:value={cloneName}
          placeholder={cloneUrl.split('/').pop()?.replace(/\.git$/, '') || 'repo'}
        />
      </div>
      <div class="space-y-2">
        <Label for="clone-branch">Branch <span class="text-muted-foreground">(optional)</span></Label>
        <Input id="clone-branch" bind:value={cloneBranch} placeholder="default branch" />
      </div>
      <Alert.Root>
        <Alert.Description class="text-xs">
          Private HTTPS clones use the GitHub token from Settings. The token is never written into the
          repository's git config.
        </Alert.Description>
      </Alert.Root>
    </div>
    <Dialog.Footer>
      <Button variant="outline" onclick={() => (cloneOpen = false)}>Cancel</Button>
      <Button disabled={!cloneUrl.trim()} onclick={doClone}>Clone</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={ghOpen}>
  <Dialog.Content class="sm:max-w-3xl">
    <Dialog.Header>
      <Dialog.Title>Clone from GitHub</Dialog.Title>
      <Dialog.Description>Repositories your token can see.</Dialog.Description>
    </Dialog.Header>
    <Input placeholder="Search repositories…" bind:value={ghFilter} />
    {#if ghLoading}
      <p class="text-muted-foreground py-10 text-center text-sm">Loading repositories…</p>
    {:else if !ghRepos.length}
      <p class="text-muted-foreground py-10 text-center text-sm">No repositories returned.</p>
    {:else}
      <div class="max-h-[52vh] overflow-auto rounded-md border">
        <Table.Root>
          <Table.Header class="bg-card sticky top-0 z-10">
            <Table.Row class="hover:bg-transparent">
              <Table.Head>Repository</Table.Head>
              <Table.Head class="w-24">Language</Table.Head>
              <Table.Head class="w-20 text-right">Size</Table.Head>
              <Table.Head class="w-24">Updated</Table.Head>
              <Table.Head class="w-24"></Table.Head>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {#each ghShown as r (r.id)}
              {@const cloned = data.repos.some((x) => x.name === r.name)}
              <Table.Row>
                <Table.Cell>
                  <div class="flex items-center gap-2">
                    <span class="font-medium">{r.fullName}</span>
                    {#if r.private}
                      <Badge variant="outline" class="border-warn/40 text-warn text-[10px]">private</Badge>
                    {/if}
                  </div>
                  {#if r.description}
                    <p class="text-muted-foreground max-w-md truncate text-xs">{r.description}</p>
                  {/if}
                </Table.Cell>
                <Table.Cell class="text-muted-foreground text-xs">{r.language ?? '—'}</Table.Cell>
                <Table.Cell class="tabular text-right text-xs">{bytes(r.size)}</Table.Cell>
                <Table.Cell class="text-muted-foreground text-xs whitespace-nowrap">
                  {relTime(r.updatedAt)}
                </Table.Cell>
                <Table.Cell class="text-right">
                  {#if cloned}
                    <Badge variant="outline" class="border-ok/40 text-ok">cloned</Badge>
                  {:else}
                    <Button size="sm" class="h-7" onclick={() => cloneFromGithub(r)}>Clone</Button>
                  {/if}
                </Table.Cell>
              </Table.Row>
            {/each}
          </Table.Body>
        </Table.Root>
      </div>
    {/if}
  </Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={runOpen}>
  <Dialog.Content class="sm:max-w-3xl">
    <Dialog.Header>
      <Dialog.Title>{runTitle}</Dialog.Title>
      <Dialog.Description>{runBusy ? 'Running…' : 'Finished'}</Dialog.Description>
    </Dialog.Header>
    <LogStream lines={runLines} bind:filter={runFilter} height="46vh" />
    <Dialog.Footer>
      <Button variant="outline" disabled={runBusy} onclick={() => (runOpen = false)}>Close</Button>
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
