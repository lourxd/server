<script>
  import * as Card from '$lib/components/ui/card/index.js';
  import { Progress } from '$lib/components/ui/progress/index.js';
  import { cn } from '$lib/utils.js';

  let {
    label,
    value,
    sub = '',
    percent = null,
    icon = null,
    class: className = '',
    children,
  } = $props();

  const tone = $derived(percent == null ? '' : percent > 90 ? 'bg-bad' : percent > 70 ? 'bg-warn' : 'bg-ok');
</script>

<Card.Root class={cn('gap-0 py-4', className)}>
  <Card.Header class="gap-1 px-4 pb-2">
    <div class="flex items-center gap-2">
      <Card.Description class="text-[11px] font-semibold tracking-wide uppercase">
        {label}
      </Card.Description>
      {#if icon}
        {@const Icon = icon}
        <Icon class="text-muted-foreground ml-auto size-3.5" />
      {/if}
    </div>
    <Card.Title class="tabular text-2xl font-semibold">{value}</Card.Title>
    {#if sub}<p class="text-muted-foreground text-xs">{sub}</p>{/if}
  </Card.Header>
  <Card.Content class="px-4">
    {#if percent != null}
      <Progress value={percent} class="h-1.5" indicatorClass={tone} />
    {/if}
    {@render children?.()}
  </Card.Content>
</Card.Root>
