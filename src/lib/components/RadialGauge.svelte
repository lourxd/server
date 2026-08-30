<script>
  import { cn } from '$lib/utils.js';

  let { value = 0, size = 66, stroke = 7, tone = 'var(--ok)', label = '', class: className = '' } = $props();

  const r = $derived((size - stroke) / 2 - 1);
  const circumference = $derived(2 * Math.PI * r);
  const clamped = $derived(Math.max(0, Math.min(100, value)));
  const dash = $derived(`${(clamped / 100) * circumference} ${circumference}`);
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 {size} {size}"
  class={cn('shrink-0', className)}
  role="img"
  aria-label="{label} {Math.round(clamped)}%"
>
  <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--muted)" stroke-width={stroke} />
  <circle
    cx={size / 2}
    cy={size / 2}
    r={r}
    fill="none"
    stroke={tone}
    stroke-width={stroke}
    stroke-linecap="round"
    stroke-dasharray={dash}
    transform="rotate(-90 {size / 2} {size / 2})"
    style="transition: stroke-dasharray 500ms ease"
  />
  <text
    x={size / 2}
    y={size / 2 + size * 0.06}
    text-anchor="middle"
    fill="var(--foreground)"
    font-size={size * 0.23}
    font-weight="600"
    font-family="var(--font-sans)"
  >{Math.round(clamped)}%</text>
</svg>
