<script>
  let { title, subtitle = '', icon: Icon = null, meta, actions } = $props();
</script>

<header
  class="bg-background/75 border-border/60 sticky top-0 z-30 flex flex-wrap items-center gap-x-4 gap-y-2.5 border-b px-5 py-3 backdrop-blur-xl md:px-6"
>
  <div class="flex min-w-0 items-center gap-3">
    {#if Icon}
      <div class="accent-wash text-primary grid size-9.5 shrink-0 place-items-center rounded-2xl">
        <Icon class="size-4.5" />
      </div>
    {/if}
    <div class="min-w-0">
      <h1 class="truncate text-[22px] leading-tight font-semibold">{title}</h1>
      {#if meta}
        {@render meta()}
      {:else if subtitle}
        <p class="text-muted-foreground mt-0.5 truncate font-mono text-[11.5px]">{subtitle}</p>
      {/if}
    </div>
  </div>

  <div class="ml-auto flex flex-wrap items-center gap-2">
    {@render actions?.()}
  </div>
</header>
