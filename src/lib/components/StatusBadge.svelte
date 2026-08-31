<script>
  import { cn } from '$lib/utils.js';
  import { describeStatus, TONE_CLASS } from '$lib/status.js';

  let { status = 'unknown', activity = null, class: className = '' } = $props();

  const state = $derived(describeStatus(status, activity));
</script>

<span
  class={cn(
    'inline-flex h-6 max-w-full shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[11.5px] font-medium',
    TONE_CLASS[state.tone] ?? TONE_CLASS.idle,
    className,
  )}
  title={state.raw && state.raw !== state.label ? state.raw : undefined}
>
  <span class={cn('dot shrink-0', state.busy && 'animate-pulse')}></span>
  <span class="truncate">{state.label}</span>
</span>
