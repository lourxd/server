<script>
  import * as Table from '$lib/components/ui/table/index.js';
  import { cell } from '$lib/format.js';
  import { cn } from '$lib/utils.js';
  import ChevronUp from '@lucide/svelte/icons/chevron-up';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import KeyRound from '@lucide/svelte/icons/key-round';

  let {
    columns = [],
    rows = [],
    orderBy = $bindable(null),
    orderDir = $bindable('asc'),
    sortable = false,
    onsort = null,
    maxHeight = '62vh',
  } = $props();

  function toggleSort(name) {
    if (!sortable) return;
    if (orderBy === name) orderDir = orderDir === 'asc' ? 'desc' : 'asc';
    else {
      orderBy = name;
      orderDir = 'asc';
    }
    onsort?.(orderBy, orderDir);
  }
</script>

<div class="overflow-auto" style="max-height:{maxHeight}">
  <Table.Root>
    <Table.Header class="bg-card sticky top-0 z-10">
      <Table.Row class="hover:bg-transparent">
        <Table.Head class="w-12 text-right">#</Table.Head>
        {#each columns as c (c.name)}
          <Table.Head
            class={cn('whitespace-nowrap', sortable && 'hover:text-foreground cursor-pointer select-none')}
            onclick={() => toggleSort(c.name)}
            title={c.type ? `${c.name} — ${c.type}` : c.name}
          >
            <span class="inline-flex items-center gap-1">
              {c.name}
              {#if c.primaryKey}<KeyRound class="size-3 opacity-60" />{/if}
              {#if orderBy === c.name}
                {#if orderDir === 'asc'}<ChevronUp class="size-3" />{:else}<ChevronDown class="size-3" />{/if}
              {/if}
            </span>
          </Table.Head>
        {/each}
      </Table.Row>
    </Table.Header>
    <Table.Body>
      {#each rows as row, i (i)}
        <Table.Row>
          <Table.Cell class="text-muted-foreground tabular text-right text-xs">{i + 1}</Table.Cell>
          {#each columns as c (c.name)}
            {@const v = row[c.name]}
            <Table.Cell class="max-w-[22rem] font-mono text-xs" title={cell(v)}>
              <div class={cn('truncate', v == null && 'text-muted-foreground italic')}>{cell(v)}</div>
            </Table.Cell>
          {/each}
        </Table.Row>
      {/each}
      {#if !rows.length}
        <Table.Row>
          <Table.Cell colspan={columns.length + 1} class="text-muted-foreground py-10 text-center">
            No rows
          </Table.Cell>
        </Table.Row>
      {/if}
    </Table.Body>
  </Table.Root>
</div>
