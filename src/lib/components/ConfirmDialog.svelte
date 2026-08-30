<script>
  import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
  import { buttonVariants } from '$lib/components/ui/button/index.js';
  import { cn } from '$lib/utils.js';

  let {
    open = $bindable(false),
    title = 'Are you sure?',
    description = '',
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    destructive = false,
    onconfirm = () => {},
  } = $props();

  let busy = $state(false);

  async function confirm() {
    busy = true;
    try {
      await onconfirm();
      open = false;
    } finally {
      busy = false;
    }
  }
</script>

<AlertDialog.Root bind:open>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>{title}</AlertDialog.Title>
      <AlertDialog.Description>{description}</AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel disabled={busy}>{cancelLabel}</AlertDialog.Cancel>
      <AlertDialog.Action
        disabled={busy}
        onclick={(e) => {
          e.preventDefault();
          confirm();
        }}
        class={cn(destructive && buttonVariants({ variant: 'destructive' }))}
      >
        {busy ? 'Working…' : confirmLabel}
      </AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>
