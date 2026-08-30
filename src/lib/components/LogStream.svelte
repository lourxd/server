<script>
  import { tick } from 'svelte';
  import { cn } from '$lib/utils.js';

  let { lines = [], height = '440px', filter = $bindable(''), autoscroll = $bindable(true) } = $props();

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
  class="bg-muted/40 overflow-auto rounded-md border p-3 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap"
>
  {#if !shown.length}
    <span class="text-muted-foreground">
      {lines.length ? 'No lines match the filter.' : 'Waiting for output…'}
    </span>
  {/if}
  {#each shown as l, i (i)}
    <div class={cn(l.stream === 'err' ? 'text-bad' : 'text-foreground/85')}>{l.line}</div>
  {/each}
</div>
