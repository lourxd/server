<script>
  import { cn } from '$lib/utils.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Textarea } from '$lib/components/ui/textarea/index.js';
  import * as Alert from '$lib/components/ui/alert/index.js';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import { Label } from '$lib/components/ui/label/index.js';

  import Plus from '@lucide/svelte/icons/plus';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import KeyRound from '@lucide/svelte/icons/key-round';
  import Hash from '@lucide/svelte/icons/hash';
  import Eye from '@lucide/svelte/icons/eye';
  import EyeOff from '@lucide/svelte/icons/eye-off';
  import ClipboardPaste from '@lucide/svelte/icons/clipboard-paste';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';

  let { vars = $bindable([]) } = $props();

  let adding = $state(false);
  let draft = $state({ key: '', value: '', secret: false });
  const taken = $derived(vars.some((v) => v.key === draft.key.trim()) && !!draft.key.trim());
  const suggestSecret = $derived(!draft.secret && SECRET_HINT.test(draft.key));

  let pasting = $state(false);
  let pasteText = $state('');
  let revealed = $state(new Set());

  const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
  const SECRET_HINT = /(SECRET|TOKEN|KEY|PASSWORD|PASSWD|CREDENTIAL|PRIVATE|DSN|AUTH)/i;

  const duplicates = $derived.by(() => {
    const seen = new Map();
    for (const v of vars) {
      if (!v.key) continue;
      seen.set(v.key, (seen.get(v.key) ?? 0) + 1);
    }
    return new Set([...seen].filter(([, n]) => n > 1).map(([k]) => k));
  });

  const invalid = $derived(vars.filter((v) => v.key && !KEY_RE.test(v.key)).map((v) => v.key));
  const secretCount = $derived(vars.filter((v) => v.secret && v.key).length);

  export function problems() {
    return { duplicates: [...duplicates], invalid };
  }

  function openAdd() {
    draft = { key: '', value: '', secret: false };
    adding = true;
  }

  function commitAdd() {
    const key = draft.key.trim();
    if (!key) return;
    vars = [...vars.filter((v) => v.key !== key), { ...draft, key }];
    adding = false;
  }

  function remove(i) {
    vars = vars.filter((_, n) => n !== i);
  }

  
  
  function onValueInput(i, value) {
    const next = [...vars];
    next[i] = { ...next[i], value };
    if (value) next[i].stored = false;
    vars = next;
  }

  function toggleReveal(i) {
    const next = new Set(revealed);
    next.has(i) ? next.delete(i) : next.add(i);
    revealed = next;
  }

  function applyPaste() {
    const parsed = [];
    for (const raw of pasteText.split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq < 1) continue;
      const key = line.slice(0, eq).trim().replace(/^export\s+/, '');
      let value = line.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!key) continue;
      parsed.push({ key, value, secret: SECRET_HINT.test(key) });
    }
    if (!parsed.length) return;
    const byKey = new Map(vars.filter((v) => v.key).map((v) => [v.key, v]));
    for (const p of parsed) byKey.set(p.key, p);
    vars = [...byKey.values()];
    pasteText = '';
    pasting = false;
  }
</script>

<div class="space-y-2.5">
  <div class="flex flex-wrap items-center gap-2">
    <span class="eyebrow">Environment</span>
    {#if secretCount}
      <span class="tabular accent-wash rounded-full px-2 py-0.5 font-mono text-[10px]">
        {secretCount} secret{secretCount === 1 ? '' : 's'}
      </span>
    {/if}
    <div class="ml-auto flex items-center gap-1.5">
      <Button variant="ghost" size="sm" class="h-7 rounded-lg" onclick={() => (pasting = !pasting)}>
        <ClipboardPaste class="size-3.5" /> Paste .env
      </Button>
      <Button variant="outline" size="sm" class="h-7 rounded-lg" onclick={openAdd}>
        <Plus class="size-3.5" /> Add
      </Button>
    </div>
  </div>

  {#if pasting}
    <div class="panel space-y-2 rounded-xl p-3">
      <Textarea
        bind:value={pasteText}
        rows={5}
        spellcheck="false"
        placeholder={'DATABASE_URL=postgres://…\nSTRIPE_SECRET_KEY=sk_live_…\n# comments and `export` are ignored'}
        class="font-mono text-[11.5px]"
      />
      <div class="flex justify-end gap-1.5">
        <Button variant="ghost" size="sm" class="h-7" onclick={() => ((pasting = false), (pasteText = ''))}>
          Cancel
        </Button>
        <Button size="sm" class="accent-fill h-7 rounded-lg px-3 font-semibold" onclick={applyPaste}>
          Add these
        </Button>
      </div>
    </div>
  {/if}

  {#if !vars.length}
    <button
      type="button"
      onclick={openAdd}
      class="panel hover:brightness-125 flex w-full items-center justify-center gap-2 rounded-xl px-4 py-6 text-sm transition-all"
    >
      <Plus class="text-muted-foreground size-4" />
      <span class="text-muted-foreground">No variables. Add one, or paste a .env file.</span>
    </button>
  {:else}
    <div class="space-y-1.5">
      {#each vars as v, i (i)}
        {@const dup = v.key && duplicates.has(v.key)}
        {@const bad = v.key && !KEY_RE.test(v.key)}
        <div class="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] items-center gap-1.5">
          <div
            class={cn(
              'flex h-8.5 items-center gap-2 rounded-lg px-2.5 font-mono text-[11.5px]',
              'bg-input/30 border-input border',
              (dup || bad) && 'border-bad/60 text-bad',
            )}
          >
            <span
              class={cn('shrink-0', v.secret ? 'text-primary' : 'text-muted-foreground/50')}
              title={v.secret ? 'Secret — kept in .env at mode 0600' : 'Plain — passed to PM2'}
            >
              {#if v.secret}<KeyRound class="size-3.5" />{:else}<Hash class="size-3.5" />{/if}
            </span>
            <span class="truncate">{v.key}</span>
          </div>
          <Input
            value={v.value}
            oninput={(e) => onValueInput(i, e.currentTarget.value)}
            type={v.secret && !v.stored && !revealed.has(i) ? 'password' : 'text'}
            placeholder={v.stored ? '•••••••• stored, unchanged' : 'value'}
            spellcheck="false"
            class={cn('h-8.5 font-mono text-[11.5px]', v.stored && 'placeholder:text-primary/70')}
          />
          <div class="flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon"
              class="size-8 rounded-lg"
              disabled={!v.secret || v.stored}
              title={v.stored ? 'Stored on disk — type to replace it' : 'Reveal'}
              onclick={() => toggleReveal(i)}
            >
              {#if revealed.has(i)}<EyeOff class="size-3.5" />{:else}<Eye class="size-3.5" />{/if}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              class="hover:text-bad size-8 rounded-lg"
              title="Remove"
              onclick={() => remove(i)}
            >
              <Trash2 class="size-3.5" />
            </Button>
          </div>
        </div>
      {/each}
    </div>
  {/if}

  {#if duplicates.size || invalid.length}
    <Alert.Root>
      <TriangleAlert class="size-4" />
      <Alert.Description class="text-xs">
        {#if duplicates.size}
          <p>Duplicate keys — the last one wins: <strong>{[...duplicates].join(', ')}</strong></p>
        {/if}
        {#if invalid.length}
          <p>
            Not valid names — use letters, digits and underscore, not starting with a digit:
            <strong>{invalid.join(', ')}</strong>
          </p>
        {/if}
      </Alert.Description>
    </Alert.Root>
  {/if}

  <p class="text-muted-foreground text-[11.5px]">
    Values marked with the key icon are written to a <code class="font-mono">.env</code> file in the
    project (mode 0600) and never handed to PM2 — <code class="font-mono">pm2 save</code> writes its
    environment to a world-readable file. Everything else is passed to PM2 directly. A secret shown
    as <span class="text-primary/70">stored, unchanged</span> is already on disk and is never sent
    to this page; type to replace it, or leave it alone.
  </p>
</div>

<Dialog.Root bind:open={adding}>
  <Dialog.Content class="sm:max-w-md">
    <Dialog.Header>
      <Dialog.Title>New variable</Dialog.Title>
      <Dialog.Description>Whether it is a secret is fixed here — it cannot be changed later.</Dialog.Description>
    </Dialog.Header>

    <div class="space-y-4">
      <div class="space-y-1.5">
        <Label for="new-key">Name</Label>
        <Input
          id="new-key"
          bind:value={draft.key}
          placeholder="DATABASE_URL"
          spellcheck="false"
          class={cn('font-mono text-xs', draft.key && !KEY_RE.test(draft.key) && 'border-bad/60')}
        />
        {#if draft.key && !KEY_RE.test(draft.key)}
          <p class="text-bad text-[11.5px]">
            Letters, digits and underscore, not starting with a digit.
          </p>
        {:else if taken}
          <p class="text-warn text-[11.5px]">{draft.key} already exists and will be replaced.</p>
        {/if}
      </div>

      <div class="space-y-1.5">
        <Label for="new-value">Value</Label>
        <Input
          id="new-value"
          bind:value={draft.value}
          type={draft.secret ? 'password' : 'text'}
          spellcheck="false"
          class="font-mono text-xs"
        />
      </div>

      <div class="grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          onclick={() => (draft = { ...draft, secret: false })}
          class={cn(
            'rounded-xl p-3 text-left transition-all',
            draft.secret ? 'panel hover:brightness-125' : 'accent-wash',
          )}
        >
          <span class="flex items-center gap-2 text-[13px] font-medium">
            <Hash class="size-3.5" /> Plain
          </span>
          <span class="text-muted-foreground mt-1 block text-[11.5px] leading-snug">
            Passed to PM2. Fine for a port, a mode, a public URL.
          </span>
        </button>

        <button
          type="button"
          onclick={() => (draft = { ...draft, secret: true })}
          class={cn(
            'rounded-xl p-3 text-left transition-all',
            draft.secret ? 'accent-wash' : 'panel hover:brightness-125',
          )}
        >
          <span class="flex items-center gap-2 text-[13px] font-medium">
            <KeyRound class="size-3.5" /> Secret
          </span>
          <span class="text-muted-foreground mt-1 block text-[11.5px] leading-snug">
            Written to <code class="font-mono">.env</code> at 0600, never given to PM2.
          </span>
        </button>
      </div>

      {#if suggestSecret}
        <p class="text-muted-foreground text-[11.5px]">
          That name looks like a credential — secret is usually what you want.
        </p>
      {/if}
    </div>

    <Dialog.Footer>
      <Button variant="ghost" onclick={() => (adding = false)}>Cancel</Button>
      <Button
        class="accent-fill rounded-xl px-4 font-semibold"
        disabled={!draft.key.trim() || !KEY_RE.test(draft.key.trim())}
        onclick={commitAdd}
      >
        <Plus class="size-4" /> Add
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
