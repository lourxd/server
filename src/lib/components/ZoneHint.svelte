<script>
  let { zones = [] } = $props();
</script>

{#if zones.length}
  <p class="text-muted-foreground text-[11.5px]">
    Must sit under {zones.map((z) => z.name).join(', ')}.
  </p>
{:else}
  <p class="text-warn text-[11.5px]">
    This Cloudflare token cannot see any zone, so no hostname can be routed yet. It needs
    <span class="font-mono">Zone · Zone · Read</span> and
    <span class="font-mono">Zone · DNS · Edit</span>, with the domain included in its Zone Resources.
  </p>
{/if}
