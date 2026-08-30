<script>
  import { cn } from '$lib/utils.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Textarea } from '$lib/components/ui/textarea/index.js';
  import * as Alert from '$lib/components/ui/alert/index.js';

  import Plus from '@lucide/svelte/icons/plus';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import KeyRound from '@lucide/svelte/icons/key-round';
  import Eye from '@lucide/svelte/icons/eye';
  import EyeOff from '@lucide/svelte/icons/eye-off';
  import ClipboardPaste from '@lucide/svelte/icons/clipboard-paste';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';

  let { vars = $bindable([]) } = $props();

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

  function add() {
    vars = [...vars, { key: '', value: '', secret: false }];
  }

  function remove(i) {
    vars = vars.filter((_, n) => n !== i);
  }

  function onKeyInput(i, key) {
    const next = [...vars];
    next[i] = { ...next[i], key };
    if (!next[i].touchedSecret) next[i].secret = SECRET_HINT.test(key);
    vars = next;
  }

  function toggleSecret(i) {
    const next = [...vars];
    next[i] = { ...next[i], secret: !next[i].secret, touchedSecret: true };
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
      <Button variant="outline" size="sm" class="h-7 rounded-lg" onclick={add}>
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
      onclick={add}
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
          <Input
            value={v.key}
            oninput={(e) => onKeyInput(i, e.currentTarget.value)}
            placeholder="KEY"
            spellcheck="false"
            class={cn('h-8.5 font-mono text-[11.5px]', (dup || bad) && 'border-bad/60 text-bad')}
          />
          <Input
            bind:value={v.value}
            type={v.secret && !revealed.has(i) ? 'password' : 'text'}
            placeholder="value"
            spellcheck="false"
            class="h-8.5 font-mono text-[11.5px]"
          />
          <div class="flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon"
              class={cn('size-8 rounded-lg', v.secret && 'text-primary')}
              title={v.secret ? 'Stored encrypted, written to .env' : 'Plain value, passed to PM2'}
              onclick={() => toggleSecret(i)}
            >
              <KeyRound class="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              class="size-8 rounded-lg"
              disabled={!v.secret}
              title="Reveal"
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
    environment to a world-readable file. Everything else is passed to PM2 directly.
  </p>
</div>
