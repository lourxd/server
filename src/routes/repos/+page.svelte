<script>
  import { onMount } from 'svelte';
  import { invalidateAll, goto } from '$app/navigation';
  import { live, api, apiGet, streamPost, toasts } from '$lib/live.svelte.js';
  import { relTime } from '$lib/format.js';
  import { cn } from '$lib/utils.js';

  import { Button } from '$lib/components/ui/button/index.js';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import * as Tabs from '$lib/components/ui/tabs/index.js';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
  import * as Alert from '$lib/components/ui/alert/index.js';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
  import LogStream from '$lib/components/LogStream.svelte';

  import Plus from '@lucide/svelte/icons/plus';
  import GitFork from '@lucide/svelte/icons/git-fork';
  import GitBranch from '@lucide/svelte/icons/git-branch';
  import Search from '@lucide/svelte/icons/search';
  import Download from '@lucide/svelte/icons/download';
  import RotateCw from '@lucide/svelte/icons/rotate-cw';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import Rocket from '@lucide/svelte/icons/rocket';
  import Package from '@lucide/svelte/icons/package';
  import ExternalLink from '@lucide/svelte/icons/external-link';
  import EllipsisVertical from '@lucide/svelte/icons/ellipsis-vertical';
  import LoaderCircle from '@lucide/svelte/icons/loader-circle';
  import CircleAlert from '@lucide/svelte/icons/circle-alert';
  import Lock from '@lucide/svelte/icons/lock';

  let { data } = $props();

  let cloneOpen = $state(false);
  let source = $state('github');
  let ghRepos = $state([]);
  let ghLoading = $state(false);
  let ghFilter = $state('');
  let ghPicked = $state(null);
  let cloneUrl = $state('');
  let cloneBranch = $state('');

  let running = $state(false);
  let lines = $state([]);
  let title = $state('');

  let confirmOpen = $state(false);
  let confirmState = $state({ title: '', description: '', label: '', action: null });

  const cloned = $derived(new Set(data.repos.map((r) => r.relPath)));

  const ghShown = $derived(
    ghFilter ? ghRepos.filter((r) => r.fullName.toLowerCase().includes(ghFilter.toLowerCase())) : ghRepos,
  );

  const appsFor = (repo) => live.apps.filter((a) => a.cwd === repo.path);

  onMount(() => {
    if (data.github.connected) loadGithub();
  });

  async function loadGithub() {
    ghLoading = true;
    try {
      ghRepos = await apiGet('/api/repos', { source: 'github' }, { quiet: true });
    } catch (err) {
      toasts.error('Could not list your repositories', err.message);
    } finally {
      ghLoading = false;
    }
  }

  function openClone() {
    ghPicked = null;
    cloneUrl = '';
    cloneBranch = '';
    lines = [];
    source = data.github.connected ? 'github' : 'url';
    cloneOpen = true;
  }

  async function stream(label, body) {
    running = true;
    title = label;
    lines = [];
    let ok = false;
    try {
      await streamPost('/api/repos/run', body, (event, payload) => {
        if (event === 'line') lines = [...lines, payload];
        if (event === 'done') ok = payload.ok;
      });
    } catch (err) {
      lines = [...lines, { stream: 'err', line: err.message }];
    }
    running = false;
    if (ok) {
      toasts.ok(`${label} finished`);
      await invalidateAll();
    } else {
      toasts.error(`${label} failed`, 'See the output for details.');
    }
    return ok;
  }

  async function runClone() {
    const url = source === 'github' ? ghPicked?.cloneUrl : cloneUrl.trim();
    if (!url) return;
    const name = source === 'github' ? ghPicked?.name : undefined;
    const branch = source === 'github' ? ghPicked?.defaultBranch : cloneBranch.trim() || undefined;
    const ok = await stream('Clone', { action: 'clone', url, name, branch });
    if (ok) cloneOpen = false;
  }

  const pull = (repo) => stream(`Pull ${repo.name}`, { action: 'pull', path: repo.relPath });
  const fetch = (repo) => stream(`Fetch ${repo.name}`, { action: 'fetch', path: repo.relPath });
  const install = (repo) => stream(`Install ${repo.name}`, { action: 'install', path: repo.relPath });

  function askDelete(repo) {
    const apps = appsFor(repo);
    confirmState = {
      title: `Delete ${repo.name}?`,
      description: apps.length
        ? `${repo.path} will be removed from disk. ${apps.length} app${apps.length === 1 ? '' : 's'} running from this directory (${apps.map((a) => a.name).join(', ')}) will keep running until you stop them, but their files will be gone.`
        : `${repo.path} will be removed from disk, including any uncommitted work and node_modules. This cannot be undone.`,
      label: 'Delete repository',
      action: async () => {
        await api('/api/repos', { action: 'delete', path: repo.relPath });
        toasts.ok('Repository deleted', repo.name);
        await invalidateAll();
      },
    };
    confirmOpen = true;
  }
</script>

<svelte:head><title>Repositories · {data.host?.hostname}</title></svelte:head>

<PageHeader title="Repositories" subtitle="{data.repos.length} on this server">
  {#snippet actions()}
    <Button onclick={openClone} class="accent-fill h-8.5 rounded-xl px-4 font-semibold">
      <Plus class="size-4" /> Clone
    </Button>
  {/snippet}
</PageHeader>

<div class="flex flex-col gap-3.5 p-5 pt-3.5 md:p-6 md:pt-3.5">

  {#if !data.repos.length}
    <div class="panel flex flex-col items-center gap-3 rounded-2xl px-6 py-16 text-center">
      <div class="panel grid size-12 place-items-center rounded-full">
        <GitFork class="text-muted-foreground size-5" />
      </div>
      <div>
        <p class="font-semibold">No repositories yet</p>
        <p class="text-muted-foreground mt-1 text-sm">
          Clone one from GitHub or any git URL, then deploy it as an app.
        </p>
      </div>
      <Button onclick={openClone} class="accent-fill mt-1 rounded-xl px-4 font-semibold">
        <Plus class="size-4" /> Clone a repository
      </Button>
    </div>
  {:else}
    <div class="grid gap-3 xl:grid-cols-2">
      {#each data.repos as repo (repo.relPath)}
        {@const apps = appsFor(repo)}
        <div class="panel-raised flex flex-col gap-3 rounded-2xl p-4.5">
          <div class="flex items-start gap-3">
            <div class="bg-foreground/6 grid size-9 shrink-0 place-items-center rounded-xl">
              <GitFork class="text-foreground/80 size-4.5" />
            </div>
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <p class="truncate text-[14.5px] font-semibold">{repo.name}</p>
                {#if repo.remoteWeb}
                  <a
                    href={repo.remoteWeb}
                    target="_blank"
                    rel="noreferrer"
                    class="text-muted-foreground hover:text-foreground"
                  >
                    <ExternalLink class="size-3.5" />
                  </a>
                {/if}
              </div>
              <p class="text-muted-foreground truncate font-mono text-[10.5px]">{repo.relPath}</p>
            </div>

            <DropdownMenu.Root>
              <DropdownMenu.Trigger>
                {#snippet child({ props })}
                  <Button {...props} variant="ghost" size="icon" class="size-8 shrink-0 rounded-lg">
                    <EllipsisVertical class="size-4" />
                  </Button>
                {/snippet}
              </DropdownMenu.Trigger>
              <DropdownMenu.Content align="end" class="w-48">
                <DropdownMenu.Item onSelect={() => goto(`/apps?deploy=${encodeURIComponent(repo.relPath)}`)}>
                  <Rocket class="size-4" /> Deploy as app
                </DropdownMenu.Item>
                <DropdownMenu.Separator />
                <DropdownMenu.Item disabled={running} onSelect={() => pull(repo)}>
                  <Download class="size-4" /> Pull
                </DropdownMenu.Item>
                <DropdownMenu.Item disabled={running} onSelect={() => fetch(repo)}>
                  <RotateCw class="size-4" /> Fetch
                </DropdownMenu.Item>
                {#if repo.packageManager}
                  <DropdownMenu.Item disabled={running} onSelect={() => install(repo)}>
                    <Package class="size-4" /> Install dependencies
                  </DropdownMenu.Item>
                {/if}
                <DropdownMenu.Separator />
                <DropdownMenu.Item variant="destructive" onSelect={() => askDelete(repo)}>
                  <Trash2 class="size-4" /> Delete
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Root>
          </div>

          {#if repo.error}
            <Alert.Root>
              <CircleAlert class="size-4" />
              <Alert.Description class="text-xs">{repo.error}</Alert.Description>
            </Alert.Root>
          {:else}
            <div class="flex flex-wrap items-center gap-1.5">
              <Badge variant="outline" class="gap-1.5 font-mono text-[10.5px]">
                <GitBranch class="size-3" />{repo.branch}
              </Badge>
              {#if repo.behind}
                <Badge variant="outline" class="border-warn/40 text-warn tabular font-mono text-[10.5px]">
                  {repo.behind} behind
                </Badge>
              {/if}
              {#if repo.ahead}
                <Badge variant="outline" class="border-info/40 text-info tabular font-mono text-[10.5px]">
                  {repo.ahead} ahead
                </Badge>
              {/if}
              {#if repo.dirty}
                <Badge variant="outline" class="border-warn/40 text-warn tabular font-mono text-[10.5px]">
                  {repo.dirty} uncommitted
                </Badge>
              {/if}
              {#if repo.packageManager && !repo.hasNodeModules}
                <Badge variant="outline" class="text-muted-foreground font-mono text-[10.5px]">
                  no node_modules
                </Badge>
              {/if}
            </div>

            {#if repo.lastCommit}
              <div class="text-muted-foreground min-w-0 text-[12px]">
                <p class="text-foreground/80 truncate">{repo.lastCommit.subject}</p>
                <p class="mt-0.5 font-mono text-[10.5px]">
                  {repo.lastCommit.author} · {relTime(repo.lastCommit.date)}
                </p>
              </div>
            {/if}

            <div class="mt-auto flex items-center gap-2 pt-1">
              {#if apps.length}
                <div class="flex min-w-0 flex-wrap items-center gap-1.5">
                  {#each apps as app (app.pmId)}
                    <Button
                      variant="ghost"
                      size="sm"
                      href="/apps/{app.pmId}"
                      class="h-7 gap-1.5 rounded-lg px-2 font-mono text-[11px]"
                    >
                      <span
                        class="dot"
                        style="color:{app.status === 'online' ? 'var(--ok)' : 'var(--bad)'}"
                      ></span>
                      {app.name}
                    </Button>
                  {/each}
                </div>
              {:else}
                <Button
                  size="sm"
                  href="/apps?deploy={encodeURIComponent(repo.relPath)}"
                  class="accent-fill h-7.5 rounded-lg px-3 font-semibold"
                >
                  <Rocket class="size-3.5" /> Deploy
                </Button>
              {/if}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}

  {#if lines.length}
    <div class="panel overflow-hidden rounded-2xl">
      <div class="flex items-center gap-2.5 px-4.5 py-3">
        <h2 class="text-[15px] font-semibold">{title}</h2>
        {#if running}
          <LoaderCircle class="text-muted-foreground size-3.5 animate-spin" />
        {/if}
        <Button variant="ghost" size="sm" class="ml-auto h-7 rounded-lg" onclick={() => (lines = [])}>
          Clear
        </Button>
      </div>
      <LogStream {lines} height="320px" />
    </div>
  {/if}
</div>

<Dialog.Root bind:open={cloneOpen}>
  <Dialog.Content class="max-h-[88vh] overflow-y-auto sm:max-w-xl">
    <Dialog.Header>
      <Dialog.Title>Clone a repository</Dialog.Title>
      <Dialog.Description>
        It is cloned into your projects directory. Deploying it as an app is a separate step.
      </Dialog.Description>
    </Dialog.Header>

    <Tabs.Root bind:value={source} class="space-y-3">
      <Tabs.List class="w-full">
        <Tabs.Trigger value="github" class="flex-1 gap-1.5"><GitFork class="size-3.5" /> GitHub</Tabs.Trigger>
        <Tabs.Trigger value="url" class="flex-1 gap-1.5"><GitBranch class="size-3.5" /> Git URL</Tabs.Trigger>
      </Tabs.List>

      <Tabs.Content value="github" class="space-y-3">
        {#if !data.github.connected}
          <Alert.Root>
            <CircleAlert class="size-4" />
            <Alert.Description class="space-y-2 text-xs">
              <p>GitHub is not connected, so your repositories cannot be listed.</p>
              <Button variant="outline" size="sm" class="h-7" href="/settings?tab=github">
                Add a token
              </Button>
            </Alert.Description>
          </Alert.Root>
        {:else}
          <div class="relative">
            <Search class="text-muted-foreground pointer-events-none absolute top-2.5 left-2.5 size-3.5" />
            <Input placeholder="Search your repositories…" bind:value={ghFilter} class="pl-8" />
          </div>
          <div class="max-h-72 space-y-1.5 overflow-y-auto">
            {#if ghLoading}
              <p class="text-muted-foreground flex items-center gap-2 py-8 text-center text-sm">
                <LoaderCircle class="size-4 animate-spin" /> Loading repositories…
              </p>
            {:else if !ghShown.length}
              <p class="text-muted-foreground py-8 text-center text-sm">
                {ghRepos.length ? 'No repository matches that search.' : 'No repositories returned.'}
              </p>
            {:else}
              {#each ghShown as r (r.id)}
                {@const already = cloned.has(r.name)}
                <button
                  type="button"
                  disabled={already}
                  onclick={() => (ghPicked = r)}
                  class={cn(
                    'flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left transition-all',
                    already && 'cursor-not-allowed opacity-45',
                    ghPicked?.id === r.id ? 'accent-wash' : 'panel hover:brightness-125',
                  )}
                >
                  <div class="min-w-0 flex-1">
                    <p class="truncate text-[13px] font-medium">{r.fullName}</p>
                    {#if r.description}
                      <p class="text-muted-foreground truncate text-[11px]">{r.description}</p>
                    {/if}
                  </div>
                  {#if r.private}<Lock class="text-muted-foreground size-3.5 shrink-0" />{/if}
                  {#if already}
                    <span class="text-muted-foreground shrink-0 font-mono text-[10px]">cloned</span>
                  {/if}
                </button>
              {/each}
            {/if}
          </div>
        {/if}
      </Tabs.Content>

      <Tabs.Content value="url" class="space-y-3">
        <div class="space-y-1.5">
          <Label for="clone-url">Repository URL</Label>
          <Input id="clone-url" bind:value={cloneUrl} placeholder="https://github.com/owner/repo.git" />
        </div>
        <div class="space-y-1.5">
          <Label for="clone-branch">Branch</Label>
          <Input id="clone-branch" bind:value={cloneBranch} placeholder="default branch" />
        </div>
      </Tabs.Content>
    </Tabs.Root>

    {#if lines.length}
      <LogStream {lines} height="224px" />
    {/if}

    <Dialog.Footer>
      <Button variant="ghost" onclick={() => (cloneOpen = false)} disabled={running}>Cancel</Button>
      <Button
        class="accent-fill rounded-xl px-4 font-semibold"
        disabled={running || (source === 'github' ? !ghPicked : !cloneUrl.trim())}
        onclick={runClone}
      >
        {#if running}<LoaderCircle class="size-4 animate-spin" />{:else}<Download class="size-4" />{/if}
        {running ? 'Cloning…' : 'Clone'}
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
