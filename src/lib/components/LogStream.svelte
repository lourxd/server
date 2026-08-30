<script>
  import { tick } from 'svelte';
  import { cn } from '$lib/utils.js';

  let {
    lines = [],
    height = '440px',
    failed = false,
    filter = $bindable(''),
    autoscroll = $bindable(true),
  } = $props();

  let box = $state(null);

  const shown = $derived(
    filter ? lines.filter((l) => (l.line ?? '').toLowerCase().includes(filter.toLowerCase())) : lines,
  );

  $effect(() => {
    shown.length;
    if (!autoscroll || !box) return;
    tick().then(() => {
      if (box) box.scrollTop = box.scrollHeight;
    });
  });

  function onscroll() {
    if (!box) return;
    autoscroll = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
  }
</script>

<div
  bind:this={box}
  {onscroll}
  style="max-height:{height}"
  class="bg-background/60 overflow-auto rounded-xl p-3.5 font-mono text-[11.5px] leading-[1.75] break-words whitespace-pre-wrap ring-1 ring-[var(--panel-ring)]"
>
  {#if !shown.length}
    <span class="text-muted-foreground">
      {lines.length ? 'No lines match the filter.' : 'Waiting for output…'}
    </span>
  {/if}
  {#each shown as l, i (i)}
    <div
      class={cn(
        l.stream === 'err' ? 'text-muted-foreground' : 'text-foreground/80',
        failed && l.stream === 'err' && 'text-bad',
      )}
    >{l.line}</div>
  {/each}
</div>
