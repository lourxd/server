<script>
  let { title, children, actions } = $props();
</script>

<header
  class="bg-background/95 supports-[backdrop-filter]:bg-background/70 sticky top-0 z-30 flex flex-wrap items-center gap-3 border-b px-5 py-3 backdrop-blur"
>
  <h1 class="text-lg font-semibold tracking-tight">{title}</h1>
  {@render children?.()}
  <div class="ml-auto flex flex-wrap items-center gap-2">
    {@render actions?.()}
  </div>
</header>
