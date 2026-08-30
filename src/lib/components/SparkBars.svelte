<script>
  import { cn } from '$lib/utils.js';
  let { data = [], tone = 'var(--ok)', height = 26, bars = 14, class: className = '' } = $props();

  const shown = $derived.by(() => {
    const vals = (data ?? []).filter((v) => Number.isFinite(v)).slice(-bars);
    if (!vals.length) return [];
    const max = Math.max(...vals, 1);
    return vals.map((v, i) => ({ pct: Math.max((v / max) * 100, 6), last: i === vals.length - 1 }));
  });
</script>

<div class={cn('flex items-end gap-[2px]', className)} style="height:{height}px">
  {#each shown as bar, i (i)}
    <div
      class="w-1 rounded-[1px] transition-all duration-500"
      style="height:{bar.pct}%; background:{bar.last ? tone : 'color-mix(in srgb, var(--foreground) 17%, transparent)'}"
    ></div>
  {/each}
</div>
