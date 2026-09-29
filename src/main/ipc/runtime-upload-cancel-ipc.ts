import { ipcMain } from 'electron'
import {
  cancelRuntimeUpload,
  forgetRuntimeUploadCancellation,
  scopeRuntimeUploadId
} from './runtime-upload-cancellation'

function readUploadId(args: unknown): string | null {
  if (!args || typeof args !== 'object' || !('uploadId' in args)) {
    return null
  }
  return typeof args.uploadId === 'string' && args.uploadId !== '' ? args.uploadId : null
}

export function registerRuntimeUploadCancelHandlers(): void {
  // Why: the drop UI cancels a whole dropped source, so the id it sends is the
  // one every file of that source streams under.
  ipcMain.handle('fs:cancelRuntimeUpload', (event, args: unknown): void => {
    const uploadId = readUploadId(args)
    if (uploadId) {
      cancelRuntimeUpload(scopeRuntimeUploadId(event.sender.id, uploadId))
    }
  })

  // Why: ids are minted per drop, but a cancel recorded for one must not outlive
  // it and abort a later upload that happens to reuse the id.
  ipcMain.handle('fs:releaseRuntimeUpload', (event, args: unknown): void => {
    const uploadId = readUploadId(args)
    if (uploadId) {
      forgetRuntimeUploadCancellation(scopeRuntimeUploadId(event.sender.id, uploadId))
    }
  })
}
