import { ipcMain, type WebContents } from 'electron'
import {
  cancelRuntimeUpload,
  forgetRuntimeUploadCancellation,
  forgetRuntimeUploadCancellationsForSender,
  scopeRuntimeUploadId
} from './runtime-upload-cancellation'
import { parseTransferId } from './transfer-id'
import { abortWhenRendererGone } from './renderer-lifetime-abort'

type CancelSender = Pick<WebContents, 'id' | 'once' | 'removeListener'>

const sendersWithCleanup = new WeakSet<CancelSender>()

function readUploadId(args: unknown): string | undefined {
  return args && typeof args === 'object' && 'uploadId' in args
    ? parseTransferId(args.uploadId)
    : undefined
}

/**
 * A renderer that reloads or crashes can never release its drops, and it keeps the same
 * WebContents, so `destroyed` alone would strand its remembered cancels until the window closes.
 */
function forgetCancelsWhenRendererGoes(sender: CancelSender): void {
  if (typeof sender.once !== 'function' || sendersWithCleanup.has(sender)) {
    return
  }
  sendersWithCleanup.add(sender)
  const senderId = sender.id
  const lifetime = abortWhenRendererGone(sender)
  lifetime.signal.addEventListener(
    'abort',
    () => {
      lifetime.dispose()
      forgetRuntimeUploadCancellationsForSender(senderId)
      // Why: a reloaded renderer reuses this WebContents; its next cancel re-arms cleanup.
      sendersWithCleanup.delete(sender)
    },
    { once: true }
  )
}

export function registerRuntimeUploadCancelHandlers(): void {
  // Why: the drop UI cancels a whole dropped source, so the id it sends is the
  // one every file of that source streams under.
  ipcMain.handle('fs:cancelRuntimeUpload', (event, args: unknown): void => {
    const uploadId = readUploadId(args)
    if (uploadId) {
      forgetCancelsWhenRendererGoes(event.sender)
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
