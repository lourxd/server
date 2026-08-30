<script>
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { cn } from '$lib/utils.js';

  let { status = 'unknown', class: className = '' } = $props();

  const TONE = {
    online: 'border-ok/40 bg-ok/10 text-ok',
    healthy: 'border-ok/40 bg-ok/10 text-ok',
    active: 'border-ok/40 bg-ok/10 text-ok',
    launching: 'border-warn/40 bg-warn/10 text-warn',
    stopping: 'border-warn/40 bg-warn/10 text-warn',
    'waiting restart': 'border-warn/40 bg-warn/10 text-warn',
    errored: 'border-bad/40 bg-bad/10 text-bad',
    error: 'border-bad/40 bg-bad/10 text-bad',
  };
</script>

<Badge
  variant="outline"
  class={cn('gap-1.5 font-medium', TONE[status] ?? 'border-idle/40 bg-idle/10 text-idle', className)}
>
  <span class="size-1.5 rounded-full bg-current"></span>
  {status}
</Badge>
