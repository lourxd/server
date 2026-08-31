<script>
  import { untrack } from 'svelte';
  import { invalidateAll, replaceState } from '$app/navigation';
  import { page } from '$app/state';
  import { api, toasts, live } from '$lib/live.svelte.js';
  import { relTime, bytes, duration } from '$lib/format.js';
  import { cn } from '$lib/utils.js';
  import { authClient } from '$lib/auth-client.js';

  import * as Card from '$lib/components/ui/card/index.js';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import * as Table from '$lib/components/ui/table/index.js';
  import * as Tabs from '$lib/components/ui/tabs/index.js';
  import * as Select from '$lib/components/ui/select/index.js';
  import * as Alert from '$lib/components/ui/alert/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { Checkbox } from '$lib/components/ui/checkbox/index.js';

  import PageHeader from '$lib/components/PageHeader.svelte';
  import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
  import LogStream from '$lib/components/LogStream.svelte';

  import GitFork from '@lucide/svelte/icons/git-fork';
  import Cloud from '@lucide/svelte/icons/cloud';
  import Plus from '@lucide/svelte/icons/plus';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import CircleAlert from '@lucide/svelte/icons/circle-alert';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal';
  import Server from '@lucide/svelte/icons/server';
  import Cpu from '@lucide/svelte/icons/cpu';
  import UserRound from '@lucide/svelte/icons/user-round';
  import Users from '@lucide/svelte/icons/users';
  import FolderGit2 from '@lucide/svelte/icons/folder-git-2';
  import HardDrive from '@lucide/svelte/icons/hard-drive';
  import KeyRound from '@lucide/svelte/icons/key-round';
  import History from '@lucide/svelte/icons/clock-fading';
  import Link2Off from '@lucide/svelte/icons/link-2-off';
  import Plug from '@lucide/svelte/icons/plug';
  import Save from '@lucide/svelte/icons/save';
  import Lock from '@lucide/svelte/icons/lock';
  import ExternalLink from '@lucide/svelte/icons/external-link';
  import RefreshCcw from '@lucide/svelte/icons/refresh-ccw';
  import Download from '@lucide/svelte/icons/download';
  import LoaderCircle from '@lucide/svelte/icons/loader-circle';
  import ArrowRight from '@lucide/svelte/icons/arrow-right';

  let { data } = $props();

  const TABS = ['general', 'system', 'github', 'cloudflare', 'account', 'users'];
  let tab = $state(untrack(() => {
    const t = page.url.searchParams.get('tab');
    return TABS.includes(t) ? t : 'general';
  }));

  function onTabChange(value) {
    tab = value;
    const url = new URL(page.url);
    value === 'general' ? url.searchParams.delete('tab') : url.searchParams.set('tab', value);
    replaceState(url, {});
  }

  let projectsDir = $state(untrack(() => data.config.projectsDir));
  let githubToken = $state('');
  let cfToken = $state('');
  let savingDir = $state(false);
  let savingToken = $state(false);
  let savingCf = $state(false);

  let currentPassword = $state('');
  let newPassword = $state('');
  let confirmPassword = $state('');
  let pwBusy = $state(false);
  let pwError = $state('');

  let userOpen = $state(false);
  let newUser = $state({ email: '', name: '', password: '', role: 'user' });
  let userBusy = $state(false);
  let userError = $state('');

  let removeOpen = $state(false);
  let removeTarget = $state(null);

  const MACHINE = $derived([
    ['Hostname', data.host?.hostname],
    ['Distribution', data.host?.distro],
    ['Kernel', data.host?.kernel],
    ['Architecture', data.host?.arch],
    ['Manufacturer', data.host?.manufacturer ?? '—'],
    ['Model', data.host?.model ?? '—'],
    ['Virtualised', data.host?.virtual ? 'yes' : 'no'],
    ['Uptime', live.metrics?.fast ? duration(live.metrics.fast.uptime * 1000) : '—'],
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

  const cfNamed = $derived(data.tunnels.filter((t) => t.kind === 'named').length);
  const cfReady = $derived(
    data.cloudflare.connected && !!data.config.cloudflareAccountId && data.binary.installed,
  );

  let editingToken = $state(false);
  let editingAccount = $state(false);

  const cfHops = $derived([
    { label: 'This machine', sub: 'panel running', icon: Server, lit: true },
    {
      label: 'cloudflared',
      sub: data.binary.installed ? 'installed' : 'not installed',
      icon: Lock,
      lit: data.binary.installed,
    },
    {
      label: 'Cloudflare',
      sub: !data.cloudflare.connected
        ? 'no token'
        : data.config.cloudflareAccountId
          ? (data.cloudflare.accountName ?? 'account set')
          : 'no account',
      icon: Cloud,
      lit: data.cloudflare.connected && !!data.config.cloudflareAccountId,
    },
  ]);

  let cfAccountId = $state(data.config?.cloudflareAccountId ?? '');
  let savingCfAccount = $state(false);

  async function saveCloudflareAccount() {
    savingCfAccount = true;
    try {
      await api('/api/settings', { action: 'cloudflare-account', accountId: cfAccountId.trim() });
      toasts.ok('Account saved');
      editingAccount = false;
      await invalidateAll();
    } finally {
      savingCfAccount = false;
    }
  }

  let installingCf = $state(false);
  let cfInstallLines = $state([]);

  async function installCloudflared() {
    installingCf = true;
    cfInstallLines = [];
    let ok = false;
    try {
      await streamPost('/api/tunnels/install', {}, (event, payload) => {
        if (event === 'line') cfInstallLines = [...cfInstallLines, payload];
        if (event === 'done') ok = payload.ok;
      });
    } catch (err) {
      cfInstallLines = [...cfInstallLines, { stream: 'err', line: err.message }];
    }
    installingCf = false;
    if (ok) {
      toasts.ok('cloudflared installed');
      await invalidateAll();
    } else {
      toasts.error('Install failed', 'See the output above.');
    }
  }

  const pwValid = $derived(newPassword.length >= 10 && newPassword === confirmPassword && !!currentPassword);

  async function saveProjectsDir() {
    savingDir = true;
    try {
      await api('/api/settings', { action: 'projects-dir', dir: projectsDir });
      toasts.ok('Projects directory updated', projectsDir);
      await invalidateAll();
    } catch {
    } finally {
      savingDir = false;
    }
  }

  async function saveToken() {
    savingToken = true;
    try {
      const res = await api('/api/settings', { action: 'github-token', token: githubToken });
      githubToken = '';
      toasts.ok('GitHub connected', `Signed in as ${res.github.login}`);
      await invalidateAll();
    } catch {
    } finally {
      savingToken = false;
    }
  }

  let rechecking = $state(false);

  async function recheckGithub() {
    rechecking = true;
    try {
      const res = await api('/api/settings', { action: 'recheck-github' });
      const g = res.github;
      g.visiblePrivate > 0
        ? toasts.ok('Private repositories visible', `${g.visibleRepos} repos (${g.visiblePrivate} private)`)
        : toasts.error('Still no private access', `Token ending ${g.tokenTail} sees ${g.visibleRepos} public repos only.`);
      await invalidateAll();
    } catch {
    } finally {
      rechecking = false;
    }
  }

  async function disconnectGithub() {
    await api('/api/settings', { action: 'github-token', token: '' });
    toasts.ok('GitHub disconnected');
    await invalidateAll();
  }

  async function saveCloudflare() {
    savingCf = true;
    try {
      const res = await api('/api/settings', { action: 'cloudflare-token', token: cfToken });
      cfToken = '';
      editingToken = false;
      toasts.ok('Cloudflare connected', res.cloudflare.accountName ?? 'token verified');
      await invalidateAll();
    } catch {
    } finally {
      savingCf = false;
    }
  }

  async function disconnectCloudflare() {
    await api('/api/settings', { action: 'cloudflare-token', token: '' });
    toasts.ok('Cloudflare disconnected');
    await invalidateAll();
  }


  async function changePassword() {
    pwBusy = true;
    pwError = '';
    const { error } = await authClient.changePassword({
      currentPassword,
      newPassword,
      revokeOtherSessions: true,
    });
    pwBusy = false;
    if (error) {
      pwError = error.message || 'Could not change the password.';
      return;
    }
    currentPassword = newPassword = confirmPassword = '';
    toasts.ok('Password changed', 'Other sessions were signed out.');
  }

  async function createUser() {
    userBusy = true;
    userError = '';
    const { error } = await authClient.admin.createUser({
      email: newUser.email,
      password: newUser.password,
      name: newUser.name || newUser.email.split('@')[0],
      role: newUser.role,
    });
    userBusy = false;
    if (error) {
      userError = error.message || 'Could not create the user.';
      return;
    }
    toasts.ok('User created', newUser.email);
    userOpen = false;
    newUser = { email: '', name: '', password: '', role: 'user' };
    await invalidateAll();
  }

  async function removeUser() {
    const { error } = await authClient.admin.removeUser({ userId: removeTarget.id });
    if (error) {
      toasts.error('Could not remove user', error.message);
      return;
    }
    toasts.ok('User removed', removeTarget.email);
    await invalidateAll();
  }
</script>

<svelte:head><title>Settings · {data.host?.hostname}</title></svelte:head>

<PageHeader title="Settings" icon={SlidersHorizontal} subtitle="integrations · account · access">
  {#snippet actions()}
    <span class="panel tabular text-muted-foreground rounded-full px-3 py-1.5 font-mono text-[11px]">
      {data.sessions} session{data.sessions === 1 ? '' : 's'}
    </span>
  {/snippet}
</PageHeader>

<div class="flex-1 p-5 pt-3.5 md:p-6 md:pt-3.5">
  <Tabs.Root value={tab} onValueChange={onTabChange} class="space-y-4">
    <Tabs.List>
      <Tabs.Trigger value="general" class="gap-1.5">
        <SlidersHorizontal class="size-3.5" /> General
      </Tabs.Trigger>
      <Tabs.Trigger value="system" class="gap-1.5"><Server class="size-3.5" /> System</Tabs.Trigger>
      <Tabs.Trigger value="github" class="gap-1.5"><GitFork class="size-3.5" /> GitHub</Tabs.Trigger>
      <Tabs.Trigger value="cloudflare" class="gap-1.5"><Cloud class="size-3.5" /> Cloudflare</Tabs.Trigger>
      <Tabs.Trigger value="account" class="gap-1.5"><UserRound class="size-3.5" /> Account</Tabs.Trigger>
      <Tabs.Trigger value="users" class="gap-1.5"><Users class="size-3.5" /> Users</Tabs.Trigger>
    </Tabs.List>

    <Tabs.Content value="general" class="max-w-3xl space-y-3">
      <Card.Root>
        <Card.Header>
          <Card.Title class="flex items-center gap-2 text-base"><FolderGit2 class="text-muted-foreground size-4" /> Projects directory</Card.Title>
          <Card.Description>
            Repositories are cloned here, and every repository and app action is restricted to paths
            beneath it.
          </Card.Description>
        </Card.Header>
        <Card.Content>
          <div class="flex gap-2">
            <Input bind:value={projectsDir} spellcheck="false" class="font-mono text-xs" />
            <Button class="accent-fill rounded-xl px-4 font-semibold" disabled={savingDir || projectsDir === data.config.projectsDir} onclick={saveProjectsDir}>
              <Save class="size-4" />
              {savingDir ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </Card.Content>
      </Card.Root>

      <Card.Root>
        <Card.Header>
          <Card.Title class="flex items-center gap-2 text-base"><HardDrive class="text-muted-foreground size-4" /> Storage</Card.Title>
        </Card.Header>
        <Card.Content class="space-y-4">
          <dl class="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[minmax(9rem,auto)_1fr]">
            <dt class="text-muted-foreground">Data directory</dt>
            <dd class="font-mono text-xs break-all">{data.dataDir}</dd>
            <dt class="text-muted-foreground">Database</dt>
            <dd class="font-mono text-xs break-all">{data.dataDir}/panel.db</dd>
            <dt class="text-muted-foreground">Encryption key</dt>
            <dd class="font-mono text-xs break-all">{data.dataDir}/secret.key</dd>
            <dt class="text-muted-foreground">Session secret</dt>
            <dd class="font-mono text-xs break-all">{data.dataDir}/auth.secret</dd>
          </dl>
          <Alert.Root>
            <Alert.Description class="text-xs">
              One SQLite file holds everything: settings, database connections, tunnels, users and
              sessions. Secrets are encrypted with AES-256-GCM using <code class="font-mono">secret.key</code>,
              stored beside the database rather than inside it — so back the whole directory up as a unit,
              and keep it out of version control.
            </Alert.Description>
          </Alert.Root>
        </Card.Content>
      </Card.Root>
    </Tabs.Content>

    <Tabs.Content value="system" class="max-w-3xl space-y-3">
      <Card.Root>
        <Card.Header>
          <Card.Title class="flex items-center gap-2 text-base">
            <Server class="text-muted-foreground size-4" /> Machine
          </Card.Title>
        </Card.Header>
        <Card.Content>
          <dl class="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[minmax(9rem,auto)_1fr]">
            {#each MACHINE as [key, value] (key)}
              <dt class="text-muted-foreground">{key}</dt>
              <dd class="font-mono text-xs break-all">{value}</dd>
            {/each}
          </dl>
        </Card.Content>
      </Card.Root>

      <Card.Root>
        <Card.Header>
          <Card.Title class="flex items-center gap-2 text-base">
            <Cpu class="text-muted-foreground size-4" /> CPU &amp; toolchain
          </Card.Title>
        </Card.Header>
        <Card.Content>
          <dl class="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[minmax(9rem,auto)_1fr]">
            {#each TOOLCHAIN as [key, value] (key)}
              <dt class="text-muted-foreground">{key}</dt>
              <dd class="font-mono text-xs break-all">{value}</dd>
            {/each}
          </dl>
        </Card.Content>
      </Card.Root>
    </Tabs.Content>

    <Tabs.Content value="github" class="max-w-3xl">
      <Card.Root>
        <Card.Header class="flex-row items-center gap-3">
          <Card.Title class="flex items-center gap-2 text-base"><GitFork class="text-muted-foreground size-4" /> GitHub integration</Card.Title>
          {#if data.github.connected}
            <Badge variant="outline" class="border-ok/40 text-ok ml-auto gap-1.5">
              <GitFork class="size-3" />{data.github.login}
            </Badge>
          {:else}
            <Badge variant="outline" class="text-muted-foreground ml-auto">not connected</Badge>
          {/if}
        </Card.Header>
        <Card.Content class="space-y-4">
          {#if data.github.connected}
            <dl class="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[minmax(9rem,auto)_1fr]">
              <dt class="text-muted-foreground">Account</dt>
              <dd class="font-mono text-xs">{data.github.name ?? data.github.login}</dd>
              <dt class="text-muted-foreground">Token</dt>
              <dd class="font-mono text-xs">
                {data.github.fineGrained ? 'fine-grained' : 'classic'} · ends
                <strong>{data.github.tokenTail}</strong>
              </dd>
              <dt class="text-muted-foreground">Visible to token</dt>
              <dd class="tabular font-mono text-xs">
                {data.github.visibleRepos} repos — {data.github.visiblePublic} public, {data.github
                  .visiblePrivate} private
              </dd>
              <dt class="text-muted-foreground">Account totals</dt>
              <dd class="tabular font-mono text-xs">
                {data.github.publicRepos} public, {data.github.privateRepos} private
              </dd>
            </dl>

            {#if data.github.privateBlocked}
              <Alert.Root>
                <TriangleAlert class="size-4" />
                <Alert.Description class="space-y-2 text-xs">
                  <p>
                    This fine-grained token can see <strong>no private repositories</strong>. A
                    fine-grained token only lists repositories you explicitly granted it — the
                    <em>Repository access</em> setting, not the permissions.
                  </p>
                  <p>
                    Edit the token and set <strong>Repository access</strong> to “All repositories”, or
                    “Only select repositories” with the private ones ticked. If they belong to an
                    organisation, an owner may also need to approve the token.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    class="h-7"
                    href="https://github.com/settings/personal-access-tokens"
                    target="_blank"
                    rel="noreferrer"
                  >
                    <ExternalLink class="size-3.5" /> Edit token access
                  </Button>
                </Alert.Description>
              </Alert.Root>
            {/if}

            <div class="flex gap-2">
              <Button variant="outline" size="sm" disabled={rechecking} onclick={recheckGithub}>
                <RefreshCcw class={cn('size-4', rechecking && 'animate-spin')} />
                {rechecking ? 'Checking…' : 'Re-check access'}
              </Button>
              <Button variant="destructive" size="sm" class="ml-auto" onclick={disconnectGithub}>
                <Link2Off class="size-4" /> Disconnect
              </Button>
            </div>
          {:else}
            <p class="text-muted-foreground text-sm">
              A personal access token lets the panel list your repositories and clone private ones.
              This panel only ever <strong>reads</strong> — it never pushes.
            </p>

            <div class="space-y-2 rounded-lg border p-3">
              <p class="text-sm font-medium">Create a fine-grained token (recommended)</p>
              <ol class="text-muted-foreground list-decimal space-y-1 pl-4 text-xs">
                <li>Open GitHub → Settings → Developer settings → Personal access tokens.</li>
                <li>
                  <strong>Repository access</strong>: pick only the repositories you plan to deploy.
                </li>
                <li>
                  <strong>Permissions → Repository → Contents: Read-only</strong>. That is the only one
                  needed; Metadata is granted automatically.
                </li>
                <li>Generate, copy the token, and paste it below.</li>
              </ol>
              <div class="flex flex-wrap gap-2 pt-1">
                <Button
                  variant="outline"
                  size="sm"
                  class="h-7"
                  href="https://github.com/settings/personal-access-tokens/new"
                  target="_blank"
                  rel="noreferrer"
                >
                  <ExternalLink class="size-3.5" /> Create fine-grained token
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  class="h-7"
                  href="https://github.com/settings/tokens/new?scopes=repo&description=Server+Control+Panel"
                  target="_blank"
                  rel="noreferrer"
                >
                  Classic token instead
                </Button>
              </div>
              <p class="text-muted-foreground pt-1 text-xs">
                A classic token needs the <code class="font-mono">repo</code> scope, which grants
                read <em>and write</em> to every repository you can reach — including organisation
                ones. Prefer fine-grained.
              </p>
            </div>
            {#if data.github.reason && data.github.reason !== 'No GitHub token configured.'}
              <Alert.Root variant="destructive">
                <CircleAlert class="size-4" />
                <Alert.Description>{data.github.reason}</Alert.Description>
              </Alert.Root>
            {/if}
            <div class="flex gap-2">
              <Input type="password" bind:value={githubToken} placeholder="github_pat_… or ghp_…" autocomplete="off" />
              <Button class="accent-fill rounded-xl px-4 font-semibold" disabled={savingToken || !githubToken.trim()} onclick={saveToken}>
                <Plug class="size-4" />
                {savingToken ? 'Verifying…' : 'Connect'}
              </Button>
            </div>
            <p class="text-muted-foreground text-xs">
              Stored encrypted. Injected only into HTTPS clone URLs, stripped from the repository's git
              config afterwards, and redacted from all command output.
            </p>
          {/if}
        </Card.Content>
      </Card.Root>
    </Tabs.Content>

    <Tabs.Content value="cloudflare" class="max-w-3xl">
      <div class="panel-raised space-y-4.5 rounded-2xl p-5">
        <div class="flex items-start gap-3">
          <div class="min-w-0 flex-1">
            <p class="text-[15px] font-semibold">Cloudflare Tunnel</p>
            <p class="text-muted-foreground mt-1 max-w-[56ch] text-[12.5px] leading-relaxed">
              Your machine dials out to Cloudflare and holds the line open. Requests for your hostname
              come back down it, so nothing here has to listen on the public internet.
            </p>
          </div>
          <span
            class={cn(
              'tabular flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[10.5px]',
              cfReady ? 'bg-ok/14 text-ok' : 'bg-warn/14 text-warn',
            )}
          >
            <span class="dot"></span>{cfReady ? 'ready' : 'not set up'}
          </span>
        </div>

        <div class="flex items-start py-1">
          {#each cfHops as hop, i (hop.label)}
            {@const Icon = hop.icon}
            {#if i > 0}
              <div class="grid h-11.5 flex-none basis-8 place-items-center">
                <div
                  class={cn(
                    'h-0.5 w-full rounded-sm',
                    hop.lit && cfHops[i - 1].lit ? 'bg-ok' : 'bg-foreground/12',
                  )}
                ></div>
              </div>
            {/if}
            <div class="flex min-w-0 flex-1 flex-col items-center gap-2">
              <div
                class={cn(
                  'grid size-11.5 place-items-center rounded-2xl',
                  hop.lit ? 'panel text-foreground' : 'text-foreground/35 ring-foreground/6 ring-1',
                )}
              >
                <Icon class="size-5" />
              </div>
              <div class="min-w-0 text-center">
                <p class={cn('text-[12px] font-medium', hop.lit ? '' : 'text-foreground/35')}>
                  {hop.label}
                </p>
                <p class="text-muted-foreground truncate font-mono text-[9.5px]">{hop.sub}</p>
              </div>
            </div>
          {/each}
        </div>

        <div class="bg-border h-px"></div>

        <div class="divide-border divide-y">
          <div class="space-y-2.5 py-3.5 first:pt-0">
            <div class="flex flex-wrap items-center gap-2.5">
              <p class="w-28 shrink-0 text-[13px] font-medium">API token</p>
              {#if data.cloudflare.connected && !editingToken}
                <span class="text-muted-foreground min-w-0 flex-1 truncate font-mono text-[11.5px]">
                  {data.cloudflare.accountName ?? 'valid'} · ends {data.config.cloudflareTokenTail ?? '····'}
                </span>
                <Button variant="ghost" size="sm" class="h-7 shrink-0 rounded-lg" onclick={() => (editingToken = true)}>
                  Change
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  class="text-bad hover:text-bad h-7 shrink-0 rounded-lg"
                  onclick={disconnectCloudflare}
                >
                  <Link2Off class="size-3.5" />
                </Button>
              {:else}
                <div class="flex min-w-0 flex-1 gap-2">
                  <Input
                    type="password"
                    bind:value={cfToken}
                    placeholder="Paste the token"
                    autocomplete="off"
                    class="font-mono text-xs"
                  />
                  <Button
                    class="accent-fill shrink-0 rounded-xl px-4 font-semibold"
                    disabled={savingCf || !cfToken.trim()}
                    onclick={saveCloudflare}
                  >
                    {savingCf ? 'Verifying…' : 'Save'}
                  </Button>
                  {#if data.cloudflare.connected}
                    <Button
                      variant="ghost"
                      size="sm"
                      class="h-8.5 shrink-0 rounded-lg"
                      onclick={() => ((editingToken = false), (cfToken = ''))}
                    >
                      Cancel
                    </Button>
                  {/if}
                </div>
              {/if}
            </div>

            <div class="panel space-y-3 rounded-xl p-3.5">
              <div class="flex flex-wrap items-baseline gap-2">
                <span class="eyebrow">What the token needs</span>
                <a
                  href="https://dash.cloudflare.com/profile/api-tokens"
                  target="_blank"
                  rel="noreferrer"
                  class="text-primary ml-auto inline-flex items-center gap-1 text-[11.5px] hover:underline"
                >
                  Create a token<ExternalLink class="size-3" />
                </a>
              </div>

              <div class="grid gap-3 sm:grid-cols-2">
                <div class="space-y-1.5">
                  <p class="text-muted-foreground text-[11px]">Permissions</p>
                  <div class="space-y-1 font-mono text-[11px]">
                    <p>Account · Cloudflare Tunnel · Edit</p>
                    <p>Zone · Zone · Read</p>
                    <p>Zone · DNS · Edit</p>
                  </div>
                </div>
                <div class="space-y-1.5">
                  <p class="text-muted-foreground text-[11px]">Resources</p>
                  <div class="space-y-1 font-mono text-[11px]">
                    <p>Account Resources · Include · your account</p>
                    <p>Zone Resources · Include · All zones</p>
                  </div>
                </div>
              </div>

              <p class="text-muted-foreground text-[11.5px] leading-relaxed">
                Tunnel · Edit creates the tunnel, Zone · Read finds the domain, DNS · Edit points the
                hostname at it. All three are needed — a token missing Zone permissions verifies fine
                and then cannot route anything.
              </p>
            </div>

            {#if data.cloudflare.reason && data.cloudflare.reason !== 'No Cloudflare API token configured.'}
              <Alert.Root variant={data.cloudflare.connected ? 'default' : 'destructive'}>
                <CircleAlert class="size-4" />
                <Alert.Description class="text-xs">{data.cloudflare.reason}</Alert.Description>
              </Alert.Root>
            {/if}
          </div>

          <div class="space-y-2.5 py-3.5">
            <div class="flex flex-wrap items-center gap-2.5">
              <p class="w-28 shrink-0 text-[13px] font-medium">Account</p>
              {#if data.config.cloudflareAccountId && !editingAccount}
                <span class="text-muted-foreground min-w-0 flex-1 truncate font-mono text-[11.5px]">
                  {data.cloudflare.accountName ?? data.config.cloudflareAccountId}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  class="h-7 shrink-0 rounded-lg"
                  onclick={() => ((cfAccountId = data.config.cloudflareAccountId), (editingAccount = true))}
                >
                  Change
                </Button>
              {:else}
                <div class="flex min-w-0 flex-1 gap-2">
                  <Input
                    bind:value={cfAccountId}
                    placeholder="32 hexadecimal characters"
                    spellcheck="false"
                    class="font-mono text-xs"
                  />
                  <Button
                    class="accent-fill shrink-0 rounded-xl px-4 font-semibold"
                    disabled={savingCfAccount || !cfAccountId.trim()}
                    onclick={saveCloudflareAccount}
                  >
                    {savingCfAccount ? 'Saving…' : 'Save'}
                  </Button>
                  {#if data.config.cloudflareAccountId}
                    <Button
                      variant="ghost"
                      size="sm"
                      class="h-8.5 shrink-0 rounded-lg"
                      onclick={() => (editingAccount = false)}
                    >
                      Cancel
                    </Button>
                  {/if}
                </div>
              {/if}
            </div>

            {#if !data.config.cloudflareAccountId}
              <p class="text-muted-foreground pl-[7.5rem] text-[11.5px]">
                Required — a tunnel is created under an account. The hex string in your
                <a
                  href="https://dash.cloudflare.com"
                  target="_blank"
                  rel="noreferrer"
                  class="text-primary inline-flex items-center gap-1 hover:underline"
                >
                  Cloudflare dashboard URL<ExternalLink class="size-3" />
                </a>.
              </p>
            {/if}
          </div>

          <div class="space-y-2.5 py-3.5">
            <div class="flex flex-wrap items-center gap-2.5">
              <p class="w-28 shrink-0 text-[13px] font-medium">cloudflared</p>
              <span class="text-muted-foreground min-w-0 flex-1 truncate font-mono text-[11.5px]">
                {#if data.binary.installed}
                  {data.binary.version}
                {:else}
                  not installed · downloads to ~/.local/bin, no sudo
                {/if}
              </span>
              {#if !data.binary.installed}
                <Button
                  variant="ghost"
                  size="sm"
                  class="panel h-8 shrink-0 rounded-lg px-3"
                  disabled={installingCf}
                  onclick={installCloudflared}
                >
                  {#if installingCf}
                    <LoaderCircle class="size-3.5 animate-spin" />
                  {:else}
                    <Download class="size-3.5" />
                  {/if}
                  {installingCf ? 'Installing…' : 'Install'}
                </Button>
              {/if}
            </div>

            {#if cfInstallLines.length && !data.binary.installed}
              <LogStream lines={cfInstallLines} height="200px" />
            {/if}
          </div>

          {#if cfReady}
            <div class="flex flex-wrap items-center gap-2.5 py-3.5">
              <p class="w-28 shrink-0 text-[13px] font-medium">Tunnels</p>
              <span class="text-muted-foreground min-w-0 flex-1 truncate font-mono text-[11.5px]">
                {cfNamed} named · route a hostname from an app's Network tab
              </span>
              <Button variant="ghost" size="sm" class="panel h-8 shrink-0 rounded-lg px-3" href="/tunnels">
                Open Tunnels <ArrowRight class="size-3.5" />
              </Button>
            </div>
          {/if}
        </div>
      </div>
    </Tabs.Content>

    <Tabs.Content value="account" class="max-w-xl space-y-3">
      <Card.Root>
        <Card.Header>
          <Card.Title class="flex items-center gap-2 text-base"><UserRound class="text-muted-foreground size-4" /> Your account</Card.Title>
        </Card.Header>
        <Card.Content>
          <dl class="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[minmax(6rem,auto)_1fr]">
            <dt class="text-muted-foreground">Name</dt>
            <dd class="font-mono text-xs">{data.user?.name ?? '—'}</dd>
            <dt class="text-muted-foreground">Email</dt>
            <dd class="font-mono text-xs">{data.user?.email}</dd>
            <dt class="text-muted-foreground">Role</dt>
            <dd class="font-mono text-xs">{data.user?.role ?? 'user'}</dd>
          </dl>
        </Card.Content>
      </Card.Root>

      <Card.Root>
        <Card.Header>
          <Card.Title class="flex items-center gap-2 text-base"><KeyRound class="text-muted-foreground size-4" /> Change password</Card.Title>
          <Card.Description>All your other sessions are signed out when it changes.</Card.Description>
        </Card.Header>
        <Card.Content class="space-y-4">
          <div class="space-y-2">
            <Label for="cur-pw">Current password</Label>
            <Input id="cur-pw" type="password" bind:value={currentPassword} autocomplete="current-password" />
          </div>
          <div class="space-y-2">
            <Label for="new-pw">New password</Label>
            <Input id="new-pw" type="password" bind:value={newPassword} autocomplete="new-password" />
            <p class="text-muted-foreground text-xs">At least 10 characters.</p>
          </div>
          <div class="space-y-2">
            <Label for="conf-pw">Confirm new password</Label>
            <Input id="conf-pw" type="password" bind:value={confirmPassword} autocomplete="new-password" />
          </div>
          {#if confirmPassword && newPassword !== confirmPassword}
            <Alert.Root>
              <CircleAlert class="size-4" />
              <Alert.Description>The two passwords do not match.</Alert.Description>
            </Alert.Root>
          {/if}
          {#if pwError}
            <Alert.Root variant="destructive">
              <CircleAlert class="size-4" />
              <Alert.Description>{pwError}</Alert.Description>
            </Alert.Root>
          {/if}
          <Button disabled={pwBusy || !pwValid} onclick={changePassword}>
            <Lock class="size-4" />
            {pwBusy ? 'Updating…' : 'Change password'}
          </Button>
        </Card.Content>
      </Card.Root>
    </Tabs.Content>

    <Tabs.Content value="users" class="max-w-4xl space-y-3">
      <Card.Root class="gap-0 py-0">
        <Card.Header class="flex-row items-center gap-3 border-b py-3">
          <Card.Title class="flex items-center gap-2 text-base"><Users class="text-muted-foreground size-4" /> Users</Card.Title>
          <Badge variant="outline">{data.users.length}</Badge>
          {#if data.isAdmin}
            <Button size="sm" class="ml-auto h-8" onclick={() => (userOpen = true)}>
              <Plus class="size-4" /> Add user
            </Button>
          {/if}
        </Card.Header>
        <Table.Root>
          <Table.Header>
            <Table.Row class="hover:bg-transparent">
              <Table.Head>Email</Table.Head>
              <Table.Head>Name</Table.Head>
              <Table.Head class="w-28">Role</Table.Head>
              <Table.Head class="w-28">Created</Table.Head>
              <Table.Head class="w-28"></Table.Head>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {#each data.users as u (u.id)}
              <Table.Row>
                <Table.Cell>
                  {u.email}
                  {#if u.id === data.user?.id}
                    <Badge variant="outline" class="border-info/40 text-info ml-1.5 text-[10px]">you</Badge>
                  {/if}
                </Table.Cell>
                <Table.Cell class="text-muted-foreground">{u.name ?? '—'}</Table.Cell>
                <Table.Cell>
                  <Badge variant={u.role === 'admin' ? 'default' : 'secondary'}>{u.role ?? 'user'}</Badge>
                  {#if u.banned}
                    <Badge variant="outline" class="border-bad/40 text-bad ml-1">banned</Badge>
                  {/if}
                </Table.Cell>
                <Table.Cell class="text-muted-foreground text-xs whitespace-nowrap">
                  {relTime(u.createdAt)}
                </Table.Cell>
                <Table.Cell class="text-right">
                  {#if data.isAdmin && u.id !== data.user?.id}
                    <Button
                      variant="ghost"
                      size="sm"
                      class="text-bad hover:text-bad hover:bg-bad/10 h-7 px-2"
                      onclick={() => {
                        removeTarget = u;
                        removeOpen = true;
                      }}
                    >
                      <Trash2 class="size-3.5" />
                    </Button>
                  {/if}
                </Table.Cell>
              </Table.Row>
            {/each}
          </Table.Body>
        </Table.Root>
      </Card.Root>

      {#if data.isAdmin && data.audit.length}
        <Card.Root class="gap-0 py-0">
          <Card.Header class="flex-row items-center gap-3 border-b py-3">
            <Card.Title class="flex items-center gap-2 text-base"><History class="text-muted-foreground size-4" /> Recent activity</Card.Title>
            <span class="text-muted-foreground ml-auto text-xs">last {data.audit.length} actions</span>
          </Card.Header>
          <div class="max-h-80 overflow-auto">
            <Table.Root>
              <Table.Header class="bg-card sticky top-0 z-10">
                <Table.Row class="hover:bg-transparent">
                  <Table.Head class="w-28">When</Table.Head>
                  <Table.Head>Who</Table.Head>
                  <Table.Head>Action</Table.Head>
                  <Table.Head>Target</Table.Head>
                  <Table.Head class="w-20"></Table.Head>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {#each data.audit as a (a.id)}
                  <Table.Row>
                    <Table.Cell class="text-muted-foreground text-xs whitespace-nowrap">
                      {relTime(a.at)}
                    </Table.Cell>
                    <Table.Cell class="text-xs">{a.userEmail ?? '—'}</Table.Cell>
                    <Table.Cell class="font-mono text-xs">{a.action}</Table.Cell>
                    <Table.Cell class="max-w-48 truncate text-xs" title={a.target}>{a.target ?? '—'}</Table.Cell>
                    <Table.Cell class="text-right">
                      {#if !a.ok}
                        <Badge variant="outline" class="border-bad/40 text-bad text-[10px]">failed</Badge>
                      {/if}
                    </Table.Cell>
                  </Table.Row>
                {/each}
              </Table.Body>
            </Table.Root>
          </div>
        </Card.Root>
      {/if}

    </Tabs.Content>
  </Tabs.Root>
</div>

<Dialog.Root bind:open={userOpen}>
  <Dialog.Content>
    <Dialog.Header>
      <Dialog.Title>Add a user</Dialog.Title>
      <Dialog.Description>They can sign in immediately with this password.</Dialog.Description>
    </Dialog.Header>
    <div class="space-y-4">
      <div class="space-y-2">
        <Label for="nu-email">Email</Label>
        <Input id="nu-email" type="email" bind:value={newUser.email} autocomplete="off" />
      </div>
      <div class="space-y-2">
        <Label for="nu-name">Name <span class="text-muted-foreground">(optional)</span></Label>
        <Input id="nu-name" bind:value={newUser.name} autocomplete="off" />
      </div>
      <div class="space-y-2">
        <Label for="nu-pw">Temporary password</Label>
        <Input id="nu-pw" type="password" bind:value={newUser.password} autocomplete="new-password" />
        <p class="text-muted-foreground text-xs">At least 10 characters.</p>
      </div>
      <div class="space-y-2">
        <Label>Role</Label>
        <Select.Root type="single" bind:value={newUser.role}>
          <Select.Trigger class="w-full">{newUser.role}</Select.Trigger>
          <Select.Content>
            <Select.Item value="user">user</Select.Item>
            <Select.Item value="admin">admin</Select.Item>
          </Select.Content>
        </Select.Root>
      </div>
      {#if userError}
        <Alert.Root variant="destructive">
          <CircleAlert class="size-4" />
          <Alert.Description>{userError}</Alert.Description>
        </Alert.Root>
      {/if}
    </div>
    <Dialog.Footer>
      <Button variant="outline" onclick={() => (userOpen = false)}>Cancel</Button>
      <Button disabled={userBusy || !newUser.email || newUser.password.length < 10} onclick={createUser}>
        {userBusy ? 'Creating…' : 'Create user'}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<ConfirmDialog
  bind:open={removeOpen}
  title="Remove {removeTarget?.email}?"
  description="This deletes the account and signs out all of its sessions."
  confirmLabel="Remove user"
  destructive
  onconfirm={removeUser}
/>
