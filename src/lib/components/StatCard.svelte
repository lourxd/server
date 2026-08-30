<script>
  import { cn } from '$lib/utils.js';
  import RadialGauge from './RadialGauge.svelte';

  let {
    label,
    value,
    sub = '',
    percent = null,
    tone = 'var(--ok)',
    class: className = '',
    children,
  } = $props();
</script>

<div class={cn('panel-raised flex items-center gap-3.5 rounded-2xl p-4', className)}>
  {#if percent != null}
    <RadialGauge value={percent} {tone} {label} />
  {/if}
  <div class="min-w-0 flex-1">
    <p class="eyebrow">{label}</p>
    <p class="tabular mt-0.5 truncate text-xl font-semibold">{value}</p>
    {#if sub}<p class="text-muted-foreground mt-0.5 truncate font-mono text-[10.5px]">{sub}</p>{/if}
    {@render children?.()}
  </div>
</div>
