import { createBrowserUuid } from '@/lib/browser-uuid'
import { isAbortSignalReason } from '../../../../shared/abort-signal-reason'
import type {
  RuntimeFileDownloadResult,
  RuntimeFileDownloadTransfer
} from '@/runtime/runtime-file-client-types'
import { createDownloadProgressTracker, type DownloadProgress } from './download-progress-tracker'
import {
  openTransferProgressPanel,
  type TransferProgressPanelHandle
} from './open-transfer-progress-panel'

// Why: a user cancel resolves as `{ canceled: true }`, like a dismissed save dialog, so callers keep one path.
export async function runRemoteDownloadWithProgress(
  name: string,
  run: (transfer: RuntimeFileDownloadTransfer) => Promise<RuntimeFileDownloadResult>
): Promise<RuntimeFileDownloadResult> {
  const rowId = createBrowserUuid()
  const controller = new AbortController()
  // Why: assigned inside the progress callback, which control-flow narrowing cannot see.
  const view: { panel: TransferProgressPanelHandle | null } = { panel: null }

  const cancel = (): void => {
    if (controller.signal.aborted) {
      return
    }
    controller.abort(new Error('Download canceled'))
    view.panel?.markCancelling(rowId)
  }

  const onProgress = (progress: DownloadProgress): void => {
    // Why: opening on the first event keeps a dismissed save dialog from flashing a panel.
    view.panel ??= openTransferProgressPanel(
      'download',
      [{ transferId: rowId, name, sentBytes: 0, totalBytes: 0, status: 'active' }],
      cancel
    )
    view.panel.updateRow(rowId, {
      sentBytes: progress.transferredBytes,
      totalBytes: progress.totalBytes ?? 0
    })
  }

  try {
    const result = await run({
      signal: controller.signal,
      trackProgress: (totalBytes) => createDownloadProgressTracker({ totalBytes, emit: onProgress })
    })
    // Why: a cancel that lost the race is still a download, which the caller's toast reports.
    view.panel?.close()
    return result
  } catch (error) {
    // Why: a dropped connection after the click is still a failure, not a cancel.
    if (isAbortSignalReason(controller.signal, error)) {
      view.panel?.updateRow(rowId, { status: 'cancelled' })
      view.panel?.settle()
      return { canceled: true }
    }
    view.panel?.close()
    throw error
  }
}
