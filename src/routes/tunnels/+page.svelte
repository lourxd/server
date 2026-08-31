<script>
  import PageHeader from '$lib/components/PageHeader.svelte';
  import CloudflareTunnels from '$lib/components/CloudflareTunnels.svelte';

  let { data } = $props();

  const running = $derived(data.tunnels.filter((t) => t.running).length);
</script>

<svelte:head><title>Tunnels · {data.host?.hostname}</title></svelte:head>

<PageHeader
  title="Tunnels"
  subtitle={data.tunnels.length
    ? `${running} of ${data.tunnels.length} connected`
    : 'nothing exposed'}
/>

<div class="flex flex-col gap-3.5 p-5 pt-3.5 md:p-6 md:pt-3.5">
  <CloudflareTunnels {data} />
</div>
