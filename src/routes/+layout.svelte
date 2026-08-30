<script>
  import '../app.css';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { live } from '$lib/live.svelte.js';
  import { authClient } from '$lib/auth-client.js';
  import { cn } from '$lib/utils.js';

  import { Toaster } from '$lib/components/ui/sonner/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';

  import LayoutDashboard from '@lucide/svelte/icons/layout-dashboard';
  import Boxes from '@lucide/svelte/icons/boxes';
  import Network from '@lucide/svelte/icons/network';
  import GitFork from '@lucide/svelte/icons/git-fork';
  import Database from '@lucide/svelte/icons/database';
  import Settings from '@lucide/svelte/icons/settings';
  import LogOut from '@lucide/svelte/icons/log-out';
  import Server from '@lucide/svelte/icons/server';
  import ChevronsUpDown from '@lucide/svelte/icons/chevrons-up-down';
  import Sun from '@lucide/svelte/icons/sun';
  import Moon from '@lucide/svelte/icons/moon';
  import BookOpen from '@lucide/svelte/icons/book-open';

  let { data, children } = $props();

  $effect(() => {
    if (data.authed) live.connect();
  });

  let dark = $state(true);

  function toggleTheme() {
    dark = !dark;
    document.documentElement.classList.toggle('dark', dark);
  }

  async function signOut() {
    await authClient.signOut();
    await goto('/login', { invalidateAll: true });
  }

  const NAV = [
    { href: '/', label: 'Overview', icon: LayoutDashboard },
    { href: '/apps', label: 'Apps', icon: Boxes },
    { href: '/repos', label: 'Repositories', icon: GitFork },
    { href: '/databases', label: 'Databases', icon: Database },
    { href: '/network', label: 'Network', icon: Network },
  ];

  const isActive = (href) => (href === '/' ? page.url.pathname === '/' : page.url.pathname.startsWith(href));

  const initial = $derived((data.user?.name ?? data.user?.email ?? '?').charAt(0).toUpperCase());


</script>

{#if !data.authed}
  {@render children?.()}
{:else}
  <div class="flex min-h-screen">
    <aside
      class="sticky top-0 hidden h-screen w-58 shrink-0 flex-col p-3.5 md:flex"
    >
      <div class="flex items-center gap-2.5 px-1.5 pb-4">
        <div class="accent-fill grid size-8.5 shrink-0 place-items-center rounded-xl">
          <Server class="size-4" />
        </div>
        <div class="min-w-0">
          <div class="truncate text-sm font-semibold">{data.host?.hostname ?? 'server'}</div>
          <div class="text-muted-foreground truncate font-mono text-[10.5px]">{data.host?.distro ?? ''}</div>
        </div>
      </div>

      <nav class="flex-1 space-y-1 overflow-y-auto">
        {#each NAV as item (item.href)}
          {@const Icon = item.icon}
          <a
            href={item.href}
            class={cn(
              'flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm transition-colors',
              isActive(item.href)
                ? 'accent-wash text-foreground font-medium'
                : 'text-muted-foreground hover:bg-sidebar-accent hover:text-foreground',
            )}
          >
            <Icon class={cn('size-4.25 shrink-0', isActive(item.href) && 'text-primary')} />
            <span class="truncate">{item.label}</span>
            {#if item.href === '/apps' && live.errored}
              <span class="tabular bg-bad/16 text-bad ml-auto rounded-full px-1.5 font-mono text-[10.5px]">
                {live.errored}
              </span>
            {/if}
          </a>
        {/each}
      </nav>

      <div>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger>
            {#snippet child({ props })}
              <button
                {...props}
                class="panel hover:bg-sidebar-accent flex w-full items-center gap-2.5 rounded-xl p-2.5 text-left transition-colors"
              >
                <div
                  class="bg-foreground/10 text-foreground grid size-7.5 shrink-0 place-items-center rounded-lg text-xs font-bold"
                >
                  {initial}
                </div>
                <div class="min-w-0 flex-1">
                  <p class="truncate text-xs font-medium">{data.user?.name ?? 'Account'}</p>
                  <p class="text-muted-foreground truncate font-mono text-[10px]">{data.user?.email}</p>
                </div>
                <ChevronsUpDown class="text-muted-foreground size-3.5 shrink-0" />
              </button>
            {/snippet}
          </DropdownMenu.Trigger>

          <DropdownMenu.Content class="w-56" side="top" align="start">
            <DropdownMenu.Label class="font-normal">
              <p class="text-sm font-medium">{data.user?.name ?? 'Account'}</p>
              <p class="text-muted-foreground truncate text-xs">{data.user?.email}</p>
            </DropdownMenu.Label>
            <DropdownMenu.Separator />

            <DropdownMenu.Group>
              <DropdownMenu.Item onSelect={() => goto('/settings')}>
                <Settings class="size-4" /> Settings
              </DropdownMenu.Item>
              <DropdownMenu.Item
                closeOnSelect={false}
                onSelect={toggleTheme}
              >
                {#if dark}<Sun class="size-4" /> Light mode{:else}<Moon class="size-4" /> Dark mode{/if}
              </DropdownMenu.Item>
            </DropdownMenu.Group>

            <DropdownMenu.Separator />
            <DropdownMenu.Item onSelect={() => window.open('https://pm2.keymetrics.io/docs', '_blank')}>
              <BookOpen class="size-4" /> PM2 docs
            </DropdownMenu.Item>

            <DropdownMenu.Separator />
            <DropdownMenu.Item variant="destructive" onSelect={signOut}>
              <LogOut class="size-4" /> Sign out
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Root>
      </div>
    </aside>

        <nav
      class="bg-background/90 border-sidebar-border fixed inset-x-0 bottom-0 z-40 flex overflow-x-auto border-t backdrop-blur md:hidden"
    >
      {#each NAV as item (item.href)}
        {@const Icon = item.icon}
        <a
          href={item.href}
          class={cn(
            'flex flex-1 flex-col items-center gap-1 px-3 py-2 text-[10px]',
            isActive(item.href) ? 'text-foreground' : 'text-muted-foreground',
          )}
        >
          <Icon class="size-4" />
          {item.label}
        </a>
      {/each}
      <a
        href="/settings"
        class={cn(
          'flex flex-1 flex-col items-center gap-1 px-3 py-2 text-[10px]',
          isActive('/settings') ? 'text-foreground' : 'text-muted-foreground',
        )}
      >
        <Settings class="size-4" />
        Settings
      </a>
    </nav>

    <div class="flex min-w-0 flex-1 flex-col pb-16 md:pb-0 md:pl-0">
      {@render children?.()}
    </div>
  </div>

  <Toaster position="bottom-right" richColors closeButton />
{/if}
