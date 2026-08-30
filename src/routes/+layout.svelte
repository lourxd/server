<script>
  import '../app.css';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { live } from '$lib/live.svelte.js';
  import { bytes } from '$lib/format.js';
  import { authClient } from '$lib/auth-client.js';
  import { cn } from '$lib/utils.js';

  import { Toaster } from '$lib/components/ui/sonner/index.js';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Separator } from '$lib/components/ui/separator/index.js';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';

  import LayoutDashboard from '@lucide/svelte/icons/layout-dashboard';
  import Boxes from '@lucide/svelte/icons/boxes';
  import Cpu from '@lucide/svelte/icons/cpu';
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
    { href: '/system', label: 'System', icon: Cpu },
  ];

  const isActive = (href) => (href === '/' ? page.url.pathname === '/' : page.url.pathname.startsWith(href));

  const mem = $derived(live.metrics?.fast?.memory);
  const cpu = $derived(live.metrics?.fast?.cpu);
  const initial = $derived((data.user?.name ?? data.user?.email ?? '?').charAt(0).toUpperCase());
</script>

{#if !data.authed}
  {@render children?.()}
{:else}
  <div class="flex min-h-screen">
    <aside
      class="bg-sidebar border-sidebar-border sticky top-0 hidden h-screen w-56 shrink-0 flex-col border-r md:flex"
    >
      <div class="flex items-center gap-2.5 px-4 py-3.5">
        <div class="from-ok to-info grid size-8 place-items-center rounded-lg bg-gradient-to-br">
          <Server class="size-4 text-white" />
        </div>
        <div class="min-w-0">
          <div class="truncate text-sm font-semibold">{data.host?.hostname ?? 'server'}</div>
          <div class="text-muted-foreground truncate text-xs">{data.host?.distro ?? ''}</div>
        </div>
      </div>

      <Separator />

      <nav class="flex-1 space-y-0.5 overflow-y-auto p-2">
        {#each NAV as item (item.href)}
          {@const Icon = item.icon}
          <a
            href={item.href}
            class={cn(
              'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors',
              isActive(item.href)
                ? 'bg-sidebar-accent text-foreground font-medium'
                : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground',
            )}
          >
            <Icon class="size-4 shrink-0" />
            <span class="truncate">{item.label}</span>
            {#if item.href === '/apps' && live.apps.length}
              <Badge
                variant="outline"
                class={cn(
                  'ml-auto px-1.5 py-0 text-[10px]',
                  live.errored ? 'border-bad/40 text-bad' : 'border-ok/40 text-ok',
                )}
              >
                {live.online}/{live.apps.length}
              </Badge>
            {/if}
          </a>
        {/each}
      </nav>

      <div class="space-y-2 p-2">
        {#if cpu && mem}
          <div class="text-muted-foreground tabular flex items-center gap-1.5 px-1.5 text-[11px]">
            <Badge
              variant="outline"
              class={cn('gap-1 px-1.5 py-0', live.connected ? 'border-ok/40 text-ok' : 'border-bad/40 text-bad')}
            >
              <span class="size-1.5 rounded-full bg-current"></span>
              {live.connected ? 'live' : 'offline'}
            </Badge>
            <span>{cpu.load}% · {bytes(mem.used)}</span>
          </div>
        {/if}

        <DropdownMenu.Root>
          <DropdownMenu.Trigger>
            {#snippet child({ props })}
              <button
                {...props}
                class="hover:bg-sidebar-accent flex w-full items-center gap-2 rounded-md p-2 text-left transition-colors"
              >
                <div
                  class="bg-primary text-primary-foreground grid size-7 shrink-0 place-items-center rounded-md text-xs font-semibold"
                >
                  {initial}
                </div>
                <div class="min-w-0 flex-1">
                  <p class="truncate text-xs font-medium">{data.user?.name ?? 'Account'}</p>
                  <p class="text-muted-foreground truncate text-[11px]">{data.user?.email}</p>
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
      class="bg-sidebar border-sidebar-border fixed inset-x-0 bottom-0 z-40 flex overflow-x-auto border-t md:hidden"
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

    <div class="flex min-w-0 flex-1 flex-col pb-16 md:pb-0">
      {@render children?.()}
    </div>
  </div>

  <Toaster position="bottom-right" richColors closeButton />
{/if}
