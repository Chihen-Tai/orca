import { createElement } from 'react'
import { toast } from 'sonner'
import { createBrowserUuid } from '@/lib/browser-uuid'
import { TransferProgressPanel } from './TransferProgressPanel'
import {
  endTransferSession,
  settleTransferSession,
  startTransferSession,
  updateTransferRow,
  type TransferDirection,
  type TransferRow
} from './transfer-session-state'

export type TransferProgressPanelHandle = {
  sessionId: string
  updateRow: (transferId: string, patch: Partial<Omit<TransferRow, 'transferId'>>) => void
  /** Holds the panel long enough to show how the transfer ended, then lets it leave. */
  settle: () => void
  /** Removes the panel at once, for paths that report their outcome elsewhere. */
  close: () => void
}

export function openTransferProgressPanel(
  direction: TransferDirection,
  rows: TransferRow[],
  onCancel: (transferId: string) => void
): TransferProgressPanelHandle {
  const sessionId = createBrowserUuid()
  let toastId: string | number | null = null
  startTransferSession(sessionId, direction, rows)
  // Why: createElement, not a direct call — the toast body must be its own
  // component or its hooks run outside a component boundary.
  const renderPanel = (id: string | number) =>
    createElement(TransferProgressPanel, {
      sessionId,
      onCancel,
      onDismiss: () => {
        toast.dismiss(id)
        endTransferSession(sessionId)
      },
      onLayoutChange: () => showPanel()
    })
  const panelOptions = { duration: Infinity, dismissible: false, unstyled: true }
  const showPanel = (): void => {
    // Why: the id key is omitted, not set to undefined. sonner spreads these
    // options over the id it just minted, so an explicit `id: undefined`
    // makes it register the toast under a different id than it returns —
    // and the next re-issue then adds a second panel instead of updating.
    toastId =
      toastId === null
        ? toast.custom(renderPanel, panelOptions)
        : toast.custom(renderPanel, { ...panelOptions, id: toastId })
  }
  showPanel()
  return {
    sessionId,
    updateRow: (transferId, patch) => updateTransferRow(sessionId, transferId, patch),
    settle: () => settleTransferSession(sessionId),
    close: () => {
      endTransferSession(sessionId)
      if (toastId !== null) {
        toast.dismiss(toastId)
      }
    }
  }
}
