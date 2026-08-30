<script>
  let { data = [], color = 'var(--info)', height = 40, max = null, fill = true, label = '' } = $props();

  const width = 240;
  const points = $derived.by(() => {
    const vals = (data || []).filter((v) => Number.isFinite(v));
    if (vals.length < 2) return null;
    const top = max ?? Math.max(...vals, 1);
    const step = width / (vals.length - 1);
    return vals.map((v, i) => [i * step, height - (v / top) * (height - 2) - 1]);
  });
  const line = $derived(points ? points.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ') : '');
  const area = $derived(points ? `${line} L${width},${height} L0,${height} Z` : '');
  const uid = `sg-${Math.random().toString(36).slice(2, 9)}`;
</script>

<svg viewBox="0 0 {width} {height}" preserveAspectRatio="none" role="img" aria-label={label || 'trend'} style="width:100%;height:{height}px;display:block">
  {#if points}
    <defs>
      <linearGradient id={uid} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color={color} stop-opacity="0.32" />
        <stop offset="100%" stop-color={color} stop-opacity="0" />
      </linearGradient>
    </defs>
    {#if fill}<path d={area} fill="url(#{uid})" />{/if}
    <path d={line} fill="none" stroke={color} stroke-width="1.5" vector-effect="non-scaling-stroke" stroke-linejoin="round" />
  {:else}
    <line x1="0" y1={height - 1} x2={width} y2={height - 1} stroke="var(--border)" stroke-width="1" />
  {/if}
</svg>
