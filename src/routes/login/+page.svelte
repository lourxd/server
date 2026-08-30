<script>
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { authClient } from '$lib/auth-client.js';

  import * as Card from '$lib/components/ui/card/index.js';
  import * as Alert from '$lib/components/ui/alert/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Label } from '$lib/components/ui/label/index.js';

  import Server from '@lucide/svelte/icons/server';
  import CircleAlert from '@lucide/svelte/icons/circle-alert';
  import LoaderCircle from '@lucide/svelte/icons/loader-circle';

  let email = $state('');
  let password = $state('');
  let error = $state('');
  let busy = $state(false);

  const next = $derived(page.url.searchParams.get('next') || '/');

  async function submit(e) {
    e.preventDefault();
    busy = true;
    error = '';
    const { error: err } = await authClient.signIn.email({ email, password });
    busy = false;
    if (err) {
      error = err.message || 'Sign in failed.';
      return;
    }
    await goto(next.startsWith('/') ? next : '/', { invalidateAll: true });
  }
</script>

<svelte:head><title>Sign in · Server Control Panel</title></svelte:head>

<div class="grid min-h-screen place-items-center p-5">
  <div class="w-full max-w-sm space-y-6">
    <div class="flex flex-col items-center gap-3 text-center">
      <div class="from-ok to-info grid size-11 place-items-center rounded-xl bg-gradient-to-br">
        <Server class="size-5 text-white" />
      </div>
      <div>
        <h1 class="text-xl font-semibold tracking-tight">Server Control Panel</h1>
        <p class="text-muted-foreground mt-1 text-sm">
          Sign in to manage apps, repositories and databases.
        </p>
      </div>
    </div>

    <Card.Root>
      <Card.Content>
        <form onsubmit={submit} class="space-y-4">
          <div class="space-y-2">
            <Label for="email">Email</Label>
            <!-- svelte-ignore a11y_autofocus -->
            <Input id="email" type="email" bind:value={email} autocomplete="username" autofocus required />
          </div>
          <div class="space-y-2">
            <Label for="password">Password</Label>
            <Input id="password" type="password" bind:value={password} autocomplete="current-password" required />
          </div>

          {#if error}
            <Alert.Root variant="destructive">
              <CircleAlert class="size-4" />
              <Alert.Description>{error}</Alert.Description>
            </Alert.Root>
          {/if}

          <Button type="submit" class="w-full" disabled={busy || !email || !password}>
            {#if busy}<LoaderCircle class="size-4 animate-spin" />{/if}
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      </Card.Content>
    </Card.Root>

    <p class="text-muted-foreground text-center text-xs">Sessions expire after 7 days</p>
  </div>
</div>
