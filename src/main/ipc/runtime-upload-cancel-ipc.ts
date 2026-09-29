import { ipcMain, type WebContents } from 'electron'
import {
  cancelRuntimeUpload,
  forgetRuntimeUploadCancellation,
  forgetRuntimeUploadCancellationsForSender,
  scopeRuntimeUploadId
} from './runtime-upload-cancellation'
import { parseTransferId } from './transfer-id'

const sendersWithCleanup = new WeakSet<Pick<WebContents, 'once'>>()

function readUploadId(args: unknown): string | undefined {
  return args && typeof args === 'object' && 'uploadId' in args
    ? parseTransferId(args.uploadId)
    : undefined
}

function forgetCancelsWhenSenderCloses(sender: Pick<WebContents, 'id' | 'once'>): void {
  if (typeof sender.once !== 'function' || sendersWithCleanup.has(sender)) {
    return
  }
  sendersWithCleanup.add(sender)
  const senderId = sender.id
  sender.once('destroyed', () => forgetRuntimeUploadCancellationsForSender(senderId))
}

export function registerRuntimeUploadCancelHandlers(): void {
  // Why: the drop UI cancels a whole dropped source, so the id it sends is the
  // one every file of that source streams under.
  ipcMain.handle('fs:cancelRuntimeUpload', (event, args: unknown): void => {
    const uploadId = readUploadId(args)
    if (uploadId) {
      forgetCancelsWhenSenderCloses(event.sender)
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
