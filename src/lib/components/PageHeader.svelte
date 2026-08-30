<script>
  let { title, subtitle = '', children, actions } = $props();
</script>

<header class="flex flex-wrap items-center gap-3.5 px-5 pt-4.5 pb-1 md:px-6">
  <div class="min-w-0">
    <h1 class="text-[25px] font-semibold">{title}</h1>
    {#if subtitle}
      <p class="text-muted-foreground mt-0.5 font-mono text-[11.5px]">{subtitle}</p>
    {/if}
  </div>
  {@render children?.()}
  <div class="ml-auto flex flex-wrap items-center gap-2">
    {@render actions?.()}
  </div>
</header>
