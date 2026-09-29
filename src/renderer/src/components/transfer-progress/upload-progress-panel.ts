import type { RuntimeImportProgressHandlers } from '@/runtime/runtime-upload-progress-tracker'
import {
  openTransferProgressPanel,
  type TransferProgressPanelHandle
} from './open-transfer-progress-panel'

export type UploadProgressPanel = {
  progress: RuntimeImportProgressHandlers
  /** Sources the user cancelled, whose resulting failure is not an error to report. */
  cancelledSourcePaths: ReadonlySet<string>
  /** Tears the panel down for a flow that failed before it could settle. */
  close: () => void
}

/** Import progress handlers that drive one upload panel; it opens once rows exist. */
export function createUploadProgressPanel(): UploadProgressPanel {
  let panel: TransferProgressPanelHandle | null = null
  const cancelledSourcePaths = new Set<string>()
  const sourcePathsByUploadId = new Map<string, string>()
  const cancelRow = (uploadId: string): void => {
    const sourcePath = sourcePathsByUploadId.get(uploadId)
    if (sourcePath) {
      cancelledSourcePaths.add(sourcePath)
    }
    panel?.markCancelling(uploadId)
    void window.api.fs.cancelRuntimeUpload({ uploadId })
  }
  return {
    progress: {
      onStart: (rows) => {
        // Why: a drop that stages nothing never flashes an empty panel.
        if (rows.length === 0) {
          return
        }
        for (const row of rows) {
          sourcePathsByUploadId.set(row.uploadId, row.sourcePath)
        }
        panel = openTransferProgressPanel(
          'upload',
          rows.map((row) => ({
            transferId: row.uploadId,
            name: row.name,
            sentBytes: 0,
            totalBytes: row.totalBytes,
            status: 'active' as const,
            ...(row.kind ? { kind: row.kind } : {})
          })),
          cancelRow
        )
      },
      onRowProgress: (uploadId, sentBytes, totalBytes, kind) =>
        panel?.updateRow(uploadId, {
          sentBytes,
          ...(totalBytes === undefined ? {} : { totalBytes }),
          ...(kind ? { kind } : {})
        }),
      onRowSettled: (uploadId, status, detail) => {
        const sourcePath = sourcePathsByUploadId.get(uploadId)
        // Why: a cancelled source reports failed; one that finished anyway reports done.
        const cancelled = sourcePath !== undefined && cancelledSourcePaths.has(sourcePath)
        panel?.updateRow(uploadId, {
          status: status === 'failed' && cancelled ? 'cancelled' : status,
          ...(detail ? { detail } : {})
        })
      },
      onFinish: () => panel?.settle()
    },
    cancelledSourcePaths,
    close: () => panel?.close()
  }
}
