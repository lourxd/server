<script>
  import { cn } from '$lib/utils.js';

  let { status = 'unknown', class: className = '' } = $props();

  const TONE = {
    online: 'bg-ok/14 text-ok',
    healthy: 'bg-ok/14 text-ok',
    active: 'bg-ok/14 text-ok',
    streaming: 'bg-ok/14 text-ok',
    launching: 'bg-warn/15 text-warn',
    stopping: 'bg-warn/15 text-warn',
    'waiting restart': 'bg-warn/15 text-warn',
    errored: 'bg-bad/16 text-bad',
    error: 'bg-bad/16 text-bad',
  };
</script>

<span
  class={cn(
    'inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[11.5px] font-medium',
    TONE[status] ?? 'bg-foreground/7 text-idle',
    className,
  )}
>
  <span class="dot"></span>
  {status}
</span>
