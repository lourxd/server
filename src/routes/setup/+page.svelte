<script>
  import { goto } from '$app/navigation';
  import { authClient } from '$lib/auth-client.js';

  import * as Card from '$lib/components/ui/card/index.js';
  import * as Alert from '$lib/components/ui/alert/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Label } from '$lib/components/ui/label/index.js';

  import Server from '@lucide/svelte/icons/server';
  import CircleAlert from '@lucide/svelte/icons/circle-alert';
  import LoaderCircle from '@lucide/svelte/icons/loader-circle';

  let name = $state('');
  let email = $state('');
  let password = $state('');
  let confirm = $state('');
  let error = $state('');
  let busy = $state(false);

  const mismatch = $derived(confirm.length > 0 && password !== confirm);
  const tooShort = $derived(password.length > 0 && password.length < 10);
  const valid = $derived(email && password.length >= 10 && password === confirm);

  async function submit(e) {
    e.preventDefault();
    busy = true;
    error = '';
    const { error: err } = await authClient.signUp.email({
      email,
      password,
      name: name || email.split('@')[0],
    });
    busy = false;
    if (err) {
      error = err.message || 'Could not create the account.';
      return;
    }
    await goto('/', { invalidateAll: true });
  }
</script>

<svelte:head><title>First run setup · Server Control Panel</title></svelte:head>

<div class="grid min-h-screen place-items-center p-5">
  <div class="w-full max-w-md space-y-6">
    <div class="flex flex-col items-center gap-3 text-center">
      <div class="from-ok to-info grid size-11 place-items-center rounded-xl bg-gradient-to-br">
        <Server class="size-5 text-white" />
      </div>
      <div>
        <h1 class="text-xl font-semibold tracking-tight">Create the owner account</h1>
        <p class="text-muted-foreground mt-1 text-sm">
          This is the first run. The account you create becomes the administrator, and sign-ups close
          immediately afterwards.
        </p>
      </div>
    </div>

    <Card.Root>
      <Card.Content>
        <form onsubmit={submit} class="space-y-4">
          <div class="space-y-2">
            <Label for="name">Name <span class="text-muted-foreground font-normal">(optional)</span></Label>
            <Input id="name" bind:value={name} autocomplete="name" />
          </div>
          <div class="space-y-2">
            <Label for="email">Email</Label>
            <!-- svelte-ignore a11y_autofocus -->
            <Input id="email" type="email" bind:value={email} autocomplete="username" autofocus required />
          </div>
          <div class="space-y-2">
            <Label for="password">Password</Label>
            <Input id="password" type="password" bind:value={password} autocomplete="new-password" required />
            <p class="text-muted-foreground text-xs">At least 10 characters.</p>
          </div>
          <div class="space-y-2">
            <Label for="confirm">Confirm password</Label>
            <Input id="confirm" type="password" bind:value={confirm} autocomplete="new-password" required />
          </div>

          {#if tooShort}
            <Alert.Root>
              <CircleAlert class="size-4" />
              <Alert.Description>Password must be at least 10 characters.</Alert.Description>
            </Alert.Root>
          {:else if mismatch}
            <Alert.Root>
              <CircleAlert class="size-4" />
              <Alert.Description>The two passwords do not match.</Alert.Description>
            </Alert.Root>
          {/if}
          {#if error}
            <Alert.Root variant="destructive">
              <CircleAlert class="size-4" />
              <Alert.Description>{error}</Alert.Description>
            </Alert.Root>
          {/if}

          <Button type="submit" class="w-full" disabled={busy || !valid}>
            {#if busy}<LoaderCircle class="size-4 animate-spin" />{/if}
            {busy ? 'Creating account…' : 'Create account and sign in'}
          </Button>
        </form>
      </Card.Content>
    </Card.Root>
  </div>
</div>
