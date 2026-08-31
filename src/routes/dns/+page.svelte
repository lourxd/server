<script>
  import PageHeader from '$lib/components/PageHeader.svelte';
  import CloudflareDns from '$lib/components/CloudflareDns.svelte';

  let { data } = $props();
</script>

<svelte:head><title>DNS · {data.host?.hostname}</title></svelte:head>

<PageHeader
  title="DNS"
  subtitle={data.zones.length ? data.zones.map((z) => z.name).join(' · ') : 'no zones visible'}
/>

<div class="flex flex-col gap-3.5 p-5 pt-3.5 md:p-6 md:pt-3.5">
  <CloudflareDns {data} />
</div>
