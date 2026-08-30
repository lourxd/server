<script>
  import { live, api, apiGet, streamPost, toasts } from '$lib/live.svelte.js';
  import { bytes, duration, num, relTime } from '$lib/format.js';
  import { cn } from '$lib/utils.js';
  import { STACKS, STACK_BY_ID, detectStack } from '$lib/stacks.js';
  import { onMount } from 'svelte';
  import { invalidateAll, replaceState } from '$app/navigation';
  import { page } from '$app/state';

  import * as Card from '$lib/components/ui/card/index.js';
  import * as Table from '$lib/components/ui/table/index.js';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import * as Select from '$lib/components/ui/select/index.js';
  import * as Alert from '$lib/components/ui/alert/index.js';
  import * as Tabs from '$lib/components/ui/tabs/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import { Checkbox } from '$lib/components/ui/checkbox/index.js';
  import { Badge } from '$lib/components/ui/badge/index.js';

  import PageHeader from '$lib/components/PageHeader.svelte';
  import StatusBadge from '$lib/components/StatusBadge.svelte';
  import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
  import TechLogo from '$lib/components/TechLogo.svelte';
  import SparkBars from '$lib/components/SparkBars.svelte';
  import LogStream from '$lib/components/LogStream.svelte';
  import EnvEditor from '$lib/components/EnvEditor.svelte';

  import Plus from '@lucide/svelte/icons/plus';
  import RotateCw from '@lucide/svelte/icons/rotate-cw';
  import Square from '@lucide/svelte/icons/square';
  import Play from '@lucide/svelte/icons/play';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import Search from '@lucide/svelte/icons/search';
  import Boxes from '@lucide/svelte/icons/boxes';
  import ArrowLeft from '@lucide/svelte/icons/arrow-left';
  import Check from '@lucide/svelte/icons/check';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import GitFork from '@lucide/svelte/icons/git-fork';
  import Link from '@lucide/svelte/icons/link';
  import FolderOpen from '@lucide/svelte/icons/folder-open';
  import CloudDownload from '@lucide/svelte/icons/cloud-download';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import LoaderCircle from '@lucide/svelte/icons/loader-circle';
  import ArrowRight from '@lucide/svelte/icons/arrow-right';
  import X from '@lucide/svelte/icons/x';

  let { data } = $props();

  let statusFilter = $state('all');
  let query = $state('');
  let busy = $state(new Set());

  const FILTERS = [
    { id: 'all', label: 'All', tone: 'var(--primary)' },
    { id: 'online', label: 'Running', tone: 'var(--ok)' },
    { id: 'errored', label: 'Errored', tone: 'var(--bad)' },
    { id: 'stopped', label: 'Stopped', tone: 'var(--idle)' },
  ];

  const counts = $derived({
    all: live.apps.length,
    online: live.online,
    errored: live.errored,
    stopped: live.stopped,
  });

  const activeFilter = $derived(FILTERS.find((f) => f.id === statusFilter) ?? FILTERS[0]);

  const summary = $derived(
    FILTERS.filter((f) => f.id !== 'all').map((f) => ({ ...f, count: counts[f.id] })),
  );

  const cpuHistory = new Map();
  const sparkFor = (app) => {
    const next = [...(cpuHistory.get(app.pmId) ?? []), app.cpu ?? 0].slice(-12);
    cpuHistory.set(app.pmId, next);
    return next;
  };
  let confirmOpen = $state(false);
  let confirmState = $state({ title: '', description: '', label: '', action: null });

  let wizardOpen = $state(false);
  let step = $state(1);
  let stackId = $state(null);

  let source = $state('github');
  let ghRepos = $state([]);
  let ghLoading = $state(false);
  let ghFilter = $state('');
  let ghPicked = $state(null);
  let cloneUrl = $state('');
  let cloneBranch = $state('');
  let localRepo = $state('');
  let installDeps = $state(true);

  let runBuild = $state(true);
  let building = $state(false);
  let buildFailed = $state(false);
  let advanced = $state(false);
  let portState = $state(null);
  let portChecking = $state(false);
  let portTimer = null;
  let buildLines = $state([]);

  let importing = $state(false);
  let importLines = $state([]);
  let importFilter = $state('');
  let imported = $state(null);

  let form = $state({
    cwd: '',
    script: '',
    name: '',
    args: '',
    instances: 1,
    execMode: 'fork',
    watch: false,
    autorestart: true,
    maxMemory: '',
    env: '',
    envVars: [],
    interpreter: '',
    serveDir: '',
    servePort: 5000,
    serveSpa: true,
  });

  const stack = $derived(stackId ? STACK_BY_ID[stackId] : null);
  const isStatic = $derived(!!stack?.serve);
  const canCluster = $derived(stack?.clusterable !== false);

  const detected = $derived(imported?.pkg ? detectStack(imported.pkg) : null);
  const mismatch = $derived(detected && stackId && detected !== stackId);

  const ghShown = $derived(
    ghFilter ? ghRepos.filter((r) => r.fullName.toLowerCase().includes(ghFilter.toLowerCase())) : ghRepos,
  );

  onMount(() => {
    const rel = page.url.searchParams.get('deploy');
    if (!rel || !data.repos.some((r) => r.relPath === rel)) return;
    openWizard();
    source = 'local';
    localRepo = rel;
    const url = new URL(page.url);
    url.searchParams.delete('deploy');
    replaceState(url, {});
  });

  function openWizard() {
    step = 1;
    stackId = null;
    ghPicked = null;
    cloneUrl = '';
    cloneBranch = '';
    localRepo = '';
    imported = null;
    importLines = [];
    buildLines = [];
    buildFailed = false;
    runBuild = true;
    advanced = false;
    source = data.repos.length ? 'local' : data.github.connected ? 'github' : 'url';
    wizardOpen = true;
  }

  function chooseStack(id) {
    stackId = id;
    if (localRepo) {
      useLocal();
      return;
    }
    step = 2;
    onSourceChange(source);
  }

  function onSourceChange(value) {
    if (value === 'github' && data.github.connected && !ghRepos.length) loadGithub();
  }

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

  function applyStackDefaults(relPath, pkg) {
    const d = stack.defaults;
    form = {
      ...form,
      cwd: relPath,
      name: form.name || relPath.split('/').pop(),
      script: d.script,
      args: d.args ?? '',
      execMode: d.execMode ?? 'fork',
      instances: d.execMode === 'cluster' ? 2 : 1,
      envVars: [
        ...(d.env ?? '')
          .split('\n')
          .filter(Boolean)
          .map((line) => {
            const eq = line.indexOf('=');
            return { key: line.slice(0, eq), value: line.slice(eq + 1), secret: false };
          }),
        ...(d.port && !stack.serve ? [{ key: 'PORT', value: String(d.port), secret: false }] : []),
      ],
      interpreter: d.interpreter ?? '',
      serveDir: stack.serve?.dir ?? '',
      servePort: d.port ?? 5000,
      serveSpa: stack.serve?.spa ?? true,
    };
  }

  async function runImport() {
    const url = source === 'github' ? ghPicked?.cloneUrl : cloneUrl.trim();
    const name = source === 'github' ? ghPicked?.name : undefined;
    if (!url) return;

    importing = true;
    importLines = [];
    let ok = false;
    let relPath = null;

    try {
      await streamPost(
        '/api/repos/run',
        { action: 'clone', url, name, branch: cloneBranch || undefined },
        (event, payload) => {
          if (event === 'line') importLines = [...importLines, payload];
          else if (event === 'done') {
            ok = payload.ok;
            relPath = payload.name ?? null;
          }
        },
      );

      if (ok && installDeps) {
        importLines = [...importLines, { stream: 'out', line: '' }];
        await streamPost('/api/repos/run', { action: 'install', path: relPath }, (event, payload) => {
          if (event === 'line') importLines = [...importLines, payload];
          else if (event === 'done') ok = payload.ok;
        });
      }
    } catch (err) {
      importLines = [...importLines, { stream: 'err', line: err.message }];
      ok = false;
    } finally {
      importing = false;
    }

    if (!ok || !relPath) {
      toasts.error('Import failed', 'See the output for details.');
      return;
    }

    await invalidateAll();
    const repo = data.repos.find((r) => r.relPath === relPath);
    imported = { relPath, pkg: repo?.pkg ?? null };
    applyStackDefaults(relPath, imported.pkg);
    queuePortCheck(isStatic ? form.servePort : form.envVars.find((v) => v.key === 'PORT')?.value);
    toasts.ok('Repository imported', relPath);
    step = 3;
  }

  function useLocal() {
    if (!localRepo) return;
    const repo = data.repos.find((r) => r.relPath === localRepo);
    imported = { relPath: localRepo, pkg: repo?.pkg ?? null };
    applyStackDefaults(localRepo, imported.pkg);
    queuePortCheck(isStatic ? form.servePort : form.envVars.find((v) => v.key === 'PORT')?.value);
    step = 3;
  }

  const selectedRepo = $derived(data.repos.find((r) => r.relPath === form.cwd));
  const portVar = $derived(form.envVars.find((v) => v.key === 'PORT') ?? null);
  const activePort = $derived(isStatic ? form.servePort : (portVar?.value ?? ''));

  function setPort(value) {
    if (isStatic) {
      form.servePort = value;
    } else if (portVar) {
      form.envVars = form.envVars.map((v) => (v.key === 'PORT' ? { ...v, value } : v));
    } else {
      form.envVars = [...form.envVars, { key: 'PORT', value, secret: false }];
    }
    queuePortCheck(value);
  }

  function queuePortCheck(value) {
    clearTimeout(portTimer);
    portState = null;
    if (!value) return;
    portChecking = true;
    portTimer = setTimeout(async () => {
      try {
        portState = await apiGet('/api/ports', { port: value }, { quiet: true });
      } catch {
        portState = null;
      } finally {
        portChecking = false;
      }
    }, 400);
  }

  const commandPreview = $derived.by(() => {
    if (isStatic) return `serve ${form.serveDir || 'dist'} on port ${form.servePort}`;
    const parts = [form.interpreter || 'node', form.script || '<file>', form.args].filter(Boolean);
    return parts.join(' ');
  });

  const buildCmd = $derived(stack?.defaults?.build ?? '');
  const buildOutput = $derived(stack?.defaults?.buildOutput ?? '');

  async function runBuildStep() {
    building = true;
    buildFailed = false;
    buildLines = [];
    let ok = false;
    try {
      await streamPost(
        '/api/repos/run',
        { action: 'run-script', script: 'build', path: form.cwd },
        (event, payload) => {
          if (event === 'line') buildLines = [...buildLines, payload];
          if (event === 'done') ok = payload.ok;
        },
      );
    } catch (err) {
      buildLines = [...buildLines, { stream: 'err', line: err.message }];
    }
    building = false;
    buildFailed = !ok;
    if (!ok) toasts.error('Build failed', 'The app was not started — see the build output.');
    return ok;
  }

  async function deploy() {
    if (runBuild && buildCmd && !(await runBuildStep())) return;
    try {
      const payload = { action: 'start', ...form, stack: stackId };
      if (isStatic) {
        payload.serve = { dir: form.serveDir, port: Number(form.servePort), spa: form.serveSpa };
      }
      await api('/api/apps', payload);
      toasts.ok('App deployed', form.name || form.script || form.serveDir);
      buildLines = [];
      wizardOpen = false;
    } catch {
    }
  }

  async function startFromEcosystem() {
    await api('/api/apps', { action: 'start', cwd: form.cwd, ecosystem: selectedRepo.ecosystemFile });
    toasts.ok('Started from ecosystem file', selectedRepo.ecosystemFile);
    wizardOpen = false;
  }

  const shown = $derived.by(() => {
    const q = query.trim().toLowerCase();
    return live.apps.filter(
      (a) =>
        (statusFilter === 'all' || a.status === statusFilter) &&
        (!q || `${a.name} ${a.script ?? ''}`.toLowerCase().includes(q)),
    );
  });

  function setBusy(id, on) {
    const next = new Set(busy);
    on ? next.add(id) : next.delete(id);
    busy = next;
  }

  async function act(app, action) {
    setBusy(app.pmId, true);
    try {
      await api('/api/apps', { action, id: app.pmId });
      toasts.ok(`${app.name} ${action}ed`);
    } catch {
    } finally {
      setBusy(app.pmId, false);
    }
  }

  function askDelete(app) {
    confirmState = {
      title: `Delete ${app.name}?`,
      description: `This removes "${app.name}" from PM2 entirely. Files on disk are untouched, but the app stops and disappears from this list.`,
      label: 'Delete app',
      action: async () => {
        await api('/api/apps', { action: 'delete', id: app.pmId });
        toasts.ok('App deleted', app.name);
      },
    };
    confirmOpen = true;
  }

</script>

<svelte:head><title>Apps · {data.host?.hostname}</title></svelte:head>

<PageHeader title="Applications" icon={Boxes}>
  {#snippet meta()}
    <div class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
      {#each summary as s (s.id)}
        <span class="text-muted-foreground flex items-center gap-1.5 font-mono text-[11px]">
          <span class="dot" style="color:{s.tone}"></span>
          <span class="tabular text-foreground/85">{s.count}</span>
          {s.label.toLowerCase()}
        </span>
      {/each}
    </div>
  {/snippet}

  {#snippet actions()}
    <div class="relative">
      <Search
        class="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2"
      />
      <Input
        placeholder="Search apps…"
        bind:value={query}
        class="h-9 w-40 rounded-xl pr-8 pl-8.5 text-[12.5px] lg:w-56"
      />
      {#if query}
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Clear search"
          onclick={() => (query = '')}
          class="text-muted-foreground hover:text-foreground absolute top-1/2 right-1.5 -translate-y-1/2 rounded-lg"
        >
          <X class="size-3.5" />
        </Button>
      {/if}
    </div>

    <Select.Root type="single" bind:value={statusFilter}>
      <Select.Trigger class="w-34 rounded-xl pl-3 text-[12.5px] data-[size=default]:h-9">
        <span class="flex items-center gap-2">
          <span class="dot" style="color:{activeFilter.tone}"></span>
          {activeFilter.label}
        </span>
      </Select.Trigger>
      <Select.Content align="end" class="min-w-44">
        {#each FILTERS as f (f.id)}
          <Select.Item value={f.id}>
            <span class="dot shrink-0" style="color:{f.tone}"></span>
            {f.label}
            <span class="tabular text-muted-foreground ml-auto font-mono text-[11px]">{counts[f.id]}</span>
          </Select.Item>
        {/each}
      </Select.Content>
    </Select.Root>

    <Button onclick={openWizard} class="accent-fill h-9 rounded-xl px-4 font-semibold">
      <Plus class="size-4" /> Deploy app
    </Button>
  {/snippet}
</PageHeader>

<div class="flex flex-1 flex-col gap-3.5 p-5 pt-3.5 md:p-6 md:pt-3.5">

  {#if !live.apps.length}
    <div class="panel flex flex-col items-center gap-3 rounded-2xl px-6 py-20 text-center">
      <div class="panel grid size-12 place-items-center rounded-full">
        <Boxes class="text-muted-foreground size-5" />
      </div>
      <div>
        <h3 class="font-semibold">No apps deployed yet</h3>
        <p class="text-muted-foreground mt-1 text-sm">
          Pick a stack, import from GitHub, and PM2 keeps it running.
        </p>
      </div>
      <Button onclick={openWizard} class="accent-fill mt-1 rounded-xl px-4 font-semibold">
        <Plus class="size-4" /> Deploy your first app
      </Button>
    </div>
  {:else}
    <div class="flex flex-col gap-2.5">
      {#each shown as app (app.pmId)}
        {@const bad = app.status === 'errored'}
        {@const idle = app.status !== 'online'}
        <div
          class={cn(
            'grid items-center gap-3.5 rounded-2xl px-4 py-3.5 transition-all',
            'grid-cols-[1fr_auto] md:grid-cols-[1fr_104px_92px_78px_88px_112px]',
            bad
              ? 'bg-bad/7 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--bad)_30%,transparent),0_12px_30px_-22px_color-mix(in_srgb,var(--bad)_70%,transparent)]'
              : 'panel-raised',
          )}
        >
          <div class="flex min-w-0 items-center gap-3.5">
            <div
              class={cn(
                'grid size-9.5 shrink-0 place-items-center rounded-xl',
                bad ? 'bg-bad/14 text-bad' : 'bg-foreground/6 text-foreground/80',
              )}
            >
              {#if app.stack && STACK_BY_ID[app.stack]}
                <TechLogo name={STACK_BY_ID[app.stack].logo} class="size-5" />
              {:else}
                <Boxes class="size-5" />
              {/if}
            </div>
            <div class="min-w-0">
              <div class="flex items-center gap-2">
                <a href="/apps/{app.pmId}" class="truncate text-[14.5px] font-semibold hover:underline">
                  {app.name}
                </a>
                <span class="bg-foreground/6 text-muted-foreground rounded-md px-1.5 py-0.5 font-mono text-[10px]">
                  {app.execMode}{app.instances > 1 ? ` ×${app.instances}` : ''}
                </span>
              </div>
              <p class="text-muted-foreground mt-0.5 truncate font-mono text-[11px]">{app.script ?? ''}</p>
            </div>
          </div>

          <div class="hidden md:block"><StatusBadge status={app.status} /></div>

          <div class="hidden md:block">
            <SparkBars
              data={sparkFor(app)}
              tone={bad ? 'var(--bad)' : app.cpu > 40 ? 'var(--warn)' : 'var(--ok)'}
              bars={12}
            />
          </div>

          <div class="hidden text-right md:block">
            <p class="tabular text-sm font-medium">{idle ? '—' : `${app.cpu}%`}</p>
            <p class="eyebrow mt-0.5 text-[9px]">cpu</p>
          </div>
          <div class="hidden text-right md:block">
            <p class="tabular text-muted-foreground text-sm font-medium">{bytes(app.memory)}</p>
            <p class="eyebrow mt-0.5 text-[9px]">
              {app.status === 'online' ? duration(app.uptime) : app.status}
            </p>
          </div>

          <div class="flex justify-end gap-1.5">
            <Button variant="ghost" size="icon" class="panel size-8 rounded-xl" disabled={busy.has(app.pmId)} onclick={() => act(app, 'restart')}>
              <RotateCw class="size-3.5" />
            </Button>
            <Button variant="ghost" size="icon" class="panel size-8 rounded-xl" disabled={busy.has(app.pmId)} onclick={() => act(app, idle ? 'restart' : 'stop')}>
              {#if idle}<Play class="size-3.5" />{:else}<Square class="size-3.5" />{/if}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              class="bg-bad/10 text-bad hover:bg-bad/20 hover:text-bad size-8 rounded-xl shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--bad)_22%,transparent)]"
              disabled={busy.has(app.pmId)}
              onclick={() => askDelete(app)}
            >
              <Trash2 class="size-3.5" />
            </Button>
          </div>
        </div>
      {/each}

      {#if !shown.length}
        <div class="panel text-muted-foreground rounded-2xl py-14 text-center text-sm">
          {#if query}
            No apps match “{query}”.
          {:else}
            No {activeFilter.label.toLowerCase()} apps.
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</div>

<Dialog.Root bind:open={wizardOpen}>
  <Dialog.Content
    class={cn('max-h-[90vh] overflow-y-auto', step === 1 ? 'sm:max-w-4xl' : 'sm:max-w-3xl')}
  >
    <Dialog.Header>
      <Dialog.Title>
        {#if step === 1}What are you deploying?
        {:else if step === 2}Import {stack?.name} project
        {:else}Configure {stack?.name}{/if}
      </Dialog.Title>
      <Dialog.Description>
        {#if step === 1}Pick a stack and the sensible defaults are filled in for you.
        {:else if step === 2}Bring in the code from GitHub, any git URL, or a project already on this server.
        {:else}{stack?.summary}{/if}
      </Dialog.Description>
    </Dialog.Header>

        <div class="text-muted-foreground flex items-center gap-1.5 text-xs">
      {#each ['Stack', 'Source', 'Configure'] as label, i (label)}
        {@const n = i + 1}
        <span class={cn('flex items-center gap-1.5', step >= n && 'text-foreground font-medium')}>
          <span
            class={cn(
              'grid size-4 place-items-center rounded-full text-[10px]',
              step > n ? 'bg-ok text-white' : step === n ? 'bg-primary text-primary-foreground' : 'bg-muted',
            )}
          >
            {#if step > n}<Check class="size-2.5" />{:else}{n}{/if}
          </span>
          {label}
        </span>
        {#if n < 3}<span class="bg-border h-px w-4"></span>{/if}
      {/each}
    </div>

    {#if step === 1}
      <div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {#each STACKS as s (s.id)}
          <button
            type="button"
            onclick={() => chooseStack(s.id)}
            class="panel hover:accent-wash focus-visible:ring-ring group flex flex-col items-start gap-2.5 rounded-2xl p-3.5 text-left transition-all focus-visible:ring-2 focus-visible:outline-none"
          >
            <TechLogo name={s.logo} class="size-7 transition-transform group-hover:scale-110" />
            <div class="min-w-0">
              <p class="text-sm font-medium">{s.name}</p>
              <p class="text-muted-foreground line-clamp-2 text-xs">{s.summary}</p>
            </div>
          </button>
        {/each}
      </div>

    {:else if step === 2}
      <div class="space-y-4">
        <div class="bg-muted/50 flex items-center gap-3 rounded-lg border p-3">
          <TechLogo name={stack.logo} class="size-6" />
          <div class="min-w-0 flex-1">
            <p class="text-sm font-medium">{stack.name}</p>
            <p class="text-muted-foreground truncate text-xs">{stack.summary}</p>
          </div>
          <Button variant="ghost" size="sm" class="h-7" onclick={() => (step = 1)}>
            <ArrowLeft class="size-3.5" /> Change
          </Button>
        </div>

        {#if importing || importLines.length}
          <LogStream lines={importLines} bind:filter={importFilter} height="38vh" />
          {#if importing}
            <p class="text-muted-foreground flex items-center gap-2 text-xs">
              <LoaderCircle class="size-3.5 animate-spin" /> Importing — cloning{installDeps
                ? ' and installing dependencies'
                : ''}…
            </p>
          {/if}
        {:else}
          <Tabs.Root bind:value={source} onValueChange={onSourceChange}>
            <Tabs.List class="w-full">
              <Tabs.Trigger value="local" class="flex-1 gap-1.5">
                <FolderOpen class="size-3.5" /> Repositories
              </Tabs.Trigger>
              <Tabs.Trigger value="github" class="flex-1 gap-1.5">
                <GitFork class="size-3.5" /> GitHub
              </Tabs.Trigger>
              <Tabs.Trigger value="url" class="flex-1 gap-1.5"><Link class="size-3.5" /> Git URL</Tabs.Trigger>
            </Tabs.List>

                        <Tabs.Content value="local" class="space-y-3 pt-3">
              {#if !data.repos.length}
                <div class="flex flex-col items-center gap-2.5 py-8 text-center">
                  <p class="text-muted-foreground text-sm">Nothing cloned to this server yet.</p>
                  <Button variant="outline" size="sm" class="h-7" href="/repos">
                    <GitFork class="size-3.5" /> Go to Repositories
                  </Button>
                </div>
              {:else}
                <div class="max-h-64 space-y-1 overflow-auto rounded-md border p-1">
                  {#each data.repos as r (r.relPath)}
                    <button
                      type="button"
                      onclick={() => (localRepo = r.relPath)}
                      class={cn(
                        'flex w-full items-center gap-2.5 rounded-md p-2 text-left transition-colors',
                        localRepo === r.relPath ? 'bg-accent ring-primary/40 ring-1' : 'hover:bg-accent/60',
                      )}
                    >
                      <FolderOpen class="text-muted-foreground size-4 shrink-0" />
                      <div class="min-w-0 flex-1">
                        <p class="truncate text-sm font-medium">{r.relPath}</p>
                        <p class="text-muted-foreground text-[11px]">
                          {r.pkg?.name ?? 'no package.json'}
                          {#if !r.hasNodeModules && r.pkg} · dependencies not installed{/if}
                        </p>
                      </div>
                      {#if localRepo === r.relPath}<Check class="text-ok size-4 shrink-0" />{/if}
                    </button>
                  {/each}
                </div>
              {/if}
            </Tabs.Content>
                        <Tabs.Content value="github" class="space-y-3 pt-3">
              {#if !data.github.connected}
                <Alert.Root>
                  <TriangleAlert class="size-4" />
                  <Alert.Description class="space-y-2 text-xs">
                    <p>
                      GitHub is not connected, so your repositories cannot be listed. Add a personal
                      access token, or paste a git URL on the next tab.
                    </p>
                    <Button variant="outline" size="sm" class="h-7" href="/settings?tab=github">
                      Connect GitHub
                    </Button>
                  </Alert.Description>
                </Alert.Root>
              {:else}
                <div class="relative">
                  <Search class="text-muted-foreground pointer-events-none absolute top-2.5 left-2.5 size-3.5" />
                  <Input placeholder="Search your repositories…" bind:value={ghFilter} class="pl-8" />
                </div>

                <div class="max-h-64 space-y-1 overflow-auto rounded-md border p-1">
                  {#if ghLoading}
                    <p class="text-muted-foreground flex items-center justify-center gap-2 py-10 text-sm">
                      <LoaderCircle class="size-4 animate-spin" /> Loading repositories…
                    </p>
                  {:else if !ghShown.length}
                    <p class="text-muted-foreground py-10 text-center text-sm">
                      {ghRepos.length ? 'No repository matches that search.' : 'No repositories returned.'}
                    </p>
                  {:else}
                    {#each ghShown as r (r.id)}
                      {@const already = data.repos.some((x) => x.relPath === r.name)}
                      <button
                        type="button"
                        disabled={already}
                        onclick={() => (ghPicked = r)}
                        class={cn(
                          'flex w-full items-start gap-2.5 rounded-md p-2 text-left transition-colors',
                          ghPicked?.id === r.id ? 'bg-accent ring-primary/40 ring-1' : 'hover:bg-accent/60',
                          already && 'cursor-not-allowed opacity-50',
                        )}
                      >
                        <GitFork class="text-muted-foreground mt-0.5 size-4 shrink-0" />
                        <div class="min-w-0 flex-1">
                          <div class="flex items-center gap-1.5">
                            <span class="truncate text-sm font-medium">{r.fullName}</span>
                            {#if r.private}
                              <Badge variant="outline" class="border-warn/40 text-warn text-[10px]">private</Badge>
                            {/if}
                            {#if already}
                              <Badge variant="outline" class="text-[10px]">imported</Badge>
                            {/if}
                          </div>
                          {#if r.description}
                            <p class="text-muted-foreground truncate text-xs">{r.description}</p>
                          {/if}
                          <p class="text-muted-foreground text-[11px]">
                            {r.language ?? '—'} · {r.defaultBranch} · {relTime(r.updatedAt)}
                          </p>
                        </div>
                        {#if ghPicked?.id === r.id}<Check class="text-ok mt-0.5 size-4 shrink-0" />{/if}
                      </button>
                    {/each}
                  {/if}
                </div>

                {#if ghPicked}
                  <div class="space-y-2">
                    <Label for="gh-branch">Branch <span class="text-muted-foreground">(optional)</span></Label>
                    <Input id="gh-branch" bind:value={cloneBranch} placeholder={ghPicked.defaultBranch} />
                  </div>
                {/if}
              {/if}
            </Tabs.Content>

                        <Tabs.Content value="url" class="space-y-3 pt-3">
              <div class="space-y-2">
                <Label for="clone-url">Repository URL</Label>
                <Input id="clone-url" bind:value={cloneUrl} placeholder="https://github.com/owner/repo.git" />
                <p class="text-muted-foreground text-xs">
                  HTTPS or <code class="font-mono">git@</code> SSH. Private HTTPS clones use the token from
                  Settings.
                </p>
              </div>
              <div class="space-y-2">
                <Label for="url-branch">Branch <span class="text-muted-foreground">(optional)</span></Label>
                <Input id="url-branch" bind:value={cloneBranch} placeholder="default branch" />
              </div>
            </Tabs.Content>

          </Tabs.Root>

          {#if source !== 'local'}
            <div class="flex items-center gap-2">
              <Checkbox id="install" bind:checked={installDeps} />
              <Label for="install" class="font-normal">Install dependencies after cloning</Label>
            </div>
          {/if}
        {/if}
      </div>

    {:else}
      <div class="space-y-4">
        <div class="bg-muted/50 flex items-center gap-3 rounded-lg border p-3">
          <TechLogo name={stack.logo} class="size-6" />
          <div class="min-w-0 flex-1">
            <p class="text-sm font-medium">{stack.name}</p>
            <p class="text-muted-foreground truncate font-mono text-xs">{form.cwd || 'projects root'}</p>
          </div>
          <Button variant="ghost" size="sm" class="h-7" onclick={() => (step = 2)}>
            <ArrowLeft class="size-3.5" /> Source
          </Button>
        </div>

        {#if mismatch}
          <Alert.Root>
            <TriangleAlert class="size-4" />
            <Alert.Description class="text-xs">
              This project looks like <strong>{STACK_BY_ID[detected].name}</strong>, but you picked
              <strong>{stack.name}</strong>. Deploy anyway, or
              <button type="button" class="underline" onclick={() => chooseStack(detected)}>
                switch to {STACK_BY_ID[detected].name}
              </button>.
            </Alert.Description>
          </Alert.Root>
        {/if}

        {#if selectedRepo?.ecosystemFile}
          <Alert.Root>
            <Alert.Description class="space-y-2">
              <p class="text-xs">
                This project has <code class="font-mono">{selectedRepo.ecosystemFile}</code>. Starting from
                it uses the settings it declares and ignores everything below.
              </p>
              <Button size="sm" class="h-7" onclick={startFromEcosystem}>
                Use {selectedRepo.ecosystemFile}
              </Button>
            </Alert.Description>
          </Alert.Root>
        {/if}

        <div class="accent-wash rounded-xl p-3.5">
          <p class="eyebrow mb-1.5">What will run</p>
          <p class="font-mono text-[12px] break-all">{commandPreview}</p>
          <p class="text-muted-foreground mt-1.5 font-mono text-[10.5px] break-all">
            in {form.cwd || 'projects root'}
          </p>
        </div>

        <div class="space-y-3">
          <span class="eyebrow">Process</span>

          <div class="space-y-1.5">
            <Label for="app-name">Name</Label>
            <Input id="app-name" bind:value={form.name} placeholder={form.cwd || stack.id} />
            <p class="text-muted-foreground text-[11.5px]">How it appears in this panel and in PM2.</p>
          </div>

          {#if isStatic}
          <div class="space-y-1.5">
            <Label for="app-port">Port</Label>
            <div class="flex items-center gap-2">
              <Input
                id="app-port"
                type="number"
                min="1"
                max="65535"
                value={activePort}
                oninput={(e) => setPort(e.currentTarget.value)}
                class="max-w-40"
              />
              {#if portChecking}
                <span class="text-muted-foreground flex items-center gap-1.5 text-[11.5px]">
                  <LoaderCircle class="size-3.5 animate-spin" /> checking
                </span>
              {:else if portState?.free}
                <span class="text-ok flex items-center gap-1.5 text-[11.5px]">
                  <span class="dot"></span> available
                </span>
              {:else if portState && !portState.free}
                <span class="text-bad flex items-center gap-1.5 text-[11.5px]">
                  <span class="dot"></span> in use
                </span>
              {/if}
            </div>
            {#if portState && !portState.free}
              <p class="text-bad text-[11.5px]">
                {portState.reason}
                {#if portState.holder?.app}
                  <a href="/apps/{portState.holder.app.pmId}" class="underline">
                    Open {portState.holder.app.name}
                  </a>
                {/if}
              </p>
            {:else}
              <p class="text-muted-foreground text-[11.5px]">
                Checked against everything listening on this machine before deploying.
              </p>
            {/if}
          </div>

            <div class="space-y-1.5">
              <Label for="serve-dir">Folder to serve</Label>
              <Input id="serve-dir" bind:value={form.serveDir} class="font-mono text-xs" />
              <p class="text-muted-foreground text-[11.5px]">
                Produced by <code class="font-mono">{buildCmd}</code>.
              </p>
            </div>
            <div class="flex items-start gap-2.5">
              <Checkbox id="spa" bind:checked={form.serveSpa} />
              <div>
                <Label for="spa" class="font-normal">Single-page app</Label>
                <p class="text-muted-foreground text-[11.5px]">
                  Unknown paths return index.html instead of a 404, so client-side routing works.
                </p>
              </div>
            </div>
          {:else}
            <div class="space-y-1.5">
              <Label for="script">File to run</Label>
              <Input id="script" bind:value={form.script} class="font-mono text-xs" />
              <p class="text-muted-foreground text-[11.5px]">
                Relative to the project.{#if buildOutput}
                  {' '}Produced by <code class="font-mono">{buildCmd}</code>.
                {/if}
              </p>
            </div>

          <div class="space-y-1.5">
            <Label for="app-port">Port</Label>
            <div class="flex items-center gap-2">
              <Input
                id="app-port"
                type="number"
                min="1"
                max="65535"
                value={activePort}
                oninput={(e) => setPort(e.currentTarget.value)}
                class="max-w-40"
              />
              {#if portChecking}
                <span class="text-muted-foreground flex items-center gap-1.5 text-[11.5px]">
                  <LoaderCircle class="size-3.5 animate-spin" /> checking
                </span>
              {:else if portState?.free}
                <span class="text-ok flex items-center gap-1.5 text-[11.5px]">
                  <span class="dot"></span> available
                </span>
              {:else if portState && !portState.free}
                <span class="text-bad flex items-center gap-1.5 text-[11.5px]">
                  <span class="dot"></span> in use
                </span>
              {/if}
            </div>
            {#if portState && !portState.free}
              <p class="text-bad text-[11.5px]">
                {portState.reason}
                {#if portState.holder?.app}
                  <a href="/apps/{portState.holder.app.pmId}" class="underline">
                    Open {portState.holder.app.name}
                  </a>
                {/if}
              </p>
            {:else}
              <p class="text-muted-foreground text-[11.5px]">
                Checked against everything listening on this machine before deploying.
              </p>
            {/if}
          </div>

            <div class="space-y-1.5">
              <Label for="args">Arguments</Label>
              <Input id="args" bind:value={form.args} class="font-mono text-xs" placeholder="none" />
              <p class="text-muted-foreground text-[11.5px]">Passed to the command above.</p>
            </div>
          {/if}
        </div>

        <div class="space-y-3">
          <EnvEditor bind:vars={form.envVars} />
        </div>

        <div class="space-y-3">
          <button
            type="button"
            onclick={() => (advanced = !advanced)}
            class="text-muted-foreground hover:text-foreground flex w-full items-center gap-1.5 text-left transition-colors"
          >
            <ChevronRight class={cn('size-3.5 transition-transform', advanced && 'rotate-90')} />
            <span class="eyebrow">Advanced</span>
            <span class="text-muted-foreground ml-auto font-mono text-[10.5px]">
              {form.execMode}{form.instances > 1 ? ` ×${form.instances}` : ''}{form.maxMemory
                ? ` · ${form.maxMemory}`
                : ''}
            </span>
          </button>

          {#if advanced}
            <div class="panel space-y-3.5 rounded-xl p-3.5">
              {#if !isStatic}
                <div class="grid gap-3 sm:grid-cols-3">
                  <div class="space-y-1.5">
                    <Label>Run as</Label>
                    <Select.Root type="single" bind:value={form.execMode} disabled={!canCluster}>
                      <Select.Trigger>
                        {form.execMode === 'cluster' ? 'Several copies' : 'One process'}
                      </Select.Trigger>
                      <Select.Content>
                        <Select.Item value="fork">One process</Select.Item>
                        <Select.Item value="cluster">Several copies</Select.Item>
                      </Select.Content>
                    </Select.Root>
                  </div>
                  <div class="space-y-1.5">
                    <Label for="instances">Copies</Label>
                    <Input
                      id="instances"
                      type="number"
                      min="1"
                      max="64"
                      bind:value={form.instances}
                      disabled={form.execMode !== 'cluster'}
                    />
                  </div>
                  <div class="space-y-1.5">
                    <Label for="maxmem">Restart above</Label>
                    <Input id="maxmem" bind:value={form.maxMemory} placeholder="512M" />
                  </div>
                </div>
                <p class="text-muted-foreground text-[11.5px]">
                  {#if !canCluster}
                    {stack.name} runs as one process — several copies would each fork the Node
                    runtime, which it does not support.
                  {:else}
                    Several copies share one port and use more cores. Leave the memory limit empty
                    for no limit.
                  {/if}
                </p>
              {/if}

              <div class="flex items-start gap-2.5">
                <Checkbox id="autorestart" bind:checked={form.autorestart} />
                <div>
                  <Label for="autorestart" class="font-normal">Restart if it crashes</Label>
                  <p class="text-muted-foreground text-[11.5px]">
                    PM2 gives up after 10 crashes inside 5 seconds rather than looping forever.
                  </p>
                </div>
              </div>

              <div class="flex items-start gap-2.5">
                <Checkbox id="watch" bind:checked={form.watch} />
                <div>
                  <Label for="watch" class="font-normal">Restart when files change</Label>
                  <p class="text-muted-foreground text-[11.5px]">
                    For development. On a built app this restarts on every write to the output.
                  </p>
                </div>
              </div>
            </div>
          {/if}
        </div>
      </div>
    {/if}

    <Dialog.Footer>
      {#if step === 1}
        <Button variant="outline" onclick={() => (wizardOpen = false)}>Cancel</Button>
      {:else if step === 2}
        <Button variant="outline" disabled={importing} onclick={() => (step = 1)}>
          <ArrowLeft class="size-4" /> Back
        </Button>
        {#if source === 'local'}
          <Button class="accent-fill rounded-xl px-4 font-semibold" disabled={!localRepo} onclick={useLocal}>
            Continue <ArrowRight class="size-4" />
          </Button>
        {:else}
          <Button
            class="accent-fill rounded-xl px-4 font-semibold"
            disabled={importing || (source === 'github' ? !ghPicked : !cloneUrl.trim())}
            onclick={runImport}
          >
            {#if importing}<LoaderCircle class="size-4 animate-spin" />{:else}<CloudDownload class="size-4" />{/if}
            {importing ? 'Importing…' : 'Import'}
          </Button>
        {/if}
      {:else}
        <Button variant="outline" disabled={building} onclick={() => (step = 2)}>
          <ArrowLeft class="size-4" /> Back
        </Button>
        <Button
          class="accent-fill rounded-xl px-4 font-semibold"
          disabled={building ||
            portChecking ||
            (portState && !portState.free) ||
            (isStatic ? !form.serveDir : !form.script)}
          onclick={deploy}
        >
          {#if building}
            <LoaderCircle class="size-4 animate-spin" /> Building…
          {:else}
            <Check class="size-4" />
            {runBuild && buildCmd ? 'Build & deploy' : 'Deploy'}
          {/if}
        </Button>
      {/if}
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
