import { lstat, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { WebContents } from 'electron'
import type { FileUploadSession, IFilesystemProvider } from '../providers/types'
import type { ImportItemResult } from '../../shared/filesystem-import-result-types'
import {
  RUNTIME_UPLOAD_PROGRESS_CHANNEL,
  throttleRuntimeUploadProgress
} from './runtime-upload-progress'
import { registerCancellableUpload } from './runtime-upload-cancellation'

export type SshImportProgressTarget = {
  sender: Pick<WebContents, 'isDestroyed' | 'send'>
  /** Renderer-minted id per dropped source; it keys progress events and cancellation. */
  uploadIdsBySourcePath: Record<string, string>
}

/** Reads the sender only when ids were sent, so callers without progress pass no event. */
export function toSshImportProgressTarget(
  event: { sender: SshImportProgressTarget['sender'] } | null | undefined,
  uploadIds: unknown
): SshImportProgressTarget | undefined {
  if (!event || !uploadIds || typeof uploadIds !== 'object') {
    return undefined
  }
  const uploadIdsBySourcePath: Record<string, string> = {}
  for (const [sourcePath, uploadId] of Object.entries(uploadIds)) {
    if (typeof uploadId === 'string' && uploadId !== '') {
      uploadIdsBySourcePath[sourcePath] = uploadId
    }
  }
  return { sender: event.sender, uploadIdsBySourcePath }
}

/** Bytes the SSH upload will move; symlinks and special files are skipped there too. */
export async function measureLocalUploadBytes(path: string): Promise<number> {
  const stat = await lstat(path)
  if (stat.isFile()) {
    return stat.size
  }
  if (!stat.isDirectory()) {
    return 0
  }
  let total = 0
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (entry.isDirectory() || entry.isFile()) {
      total += await measureLocalUploadBytes(join(path, entry.name))
    }
  }
  return total
}

/**
 * Runs one dropped source's SSH import with the same progress events and cancel
 * handle the runtime upload panel uses, so both transports share one UI.
 */
export async function importSshSourceWithProgress(
  target: SshImportProgressTarget | undefined,
  sourcePath: string,
  provider: Pick<IFilesystemProvider, 'deletePath'>,
  uploadSession: FileUploadSession,
  run: (session: FileUploadSession) => Promise<ImportItemResult>
): Promise<ImportItemResult> {
  const uploadId = target?.uploadIdsBySourcePath[sourcePath]
  if (!target || !uploadId) {
    return run(uploadSession)
  }
  const { sender } = target
  const totalBytes = await measureLocalUploadBytes(resolve(sourcePath)).catch(() => 0)
  const emit = throttleRuntimeUploadProgress((progress) => {
    if (!sender.isDestroyed()) {
      sender.send(RUNTIME_UPLOAD_PROGRESS_CHANNEL, progress)
    }
  })
  let sentBytes = 0
  emit({ uploadId, sentBytes, totalBytes })
  const cancellation = registerCancellableUpload(uploadId)
  const trackedSession: FileUploadSession = {
    uploadFile: async (localPath, remotePath, options) => {
      cancellation.signal.throwIfAborted()
      try {
        await uploadSession.uploadFile(localPath, remotePath, {
          ...options,
          signal: cancellation.signal,
          onBytesTransferred: (bytes) => {
            sentBytes += bytes
            // Why: a source can grow after it was measured; never report past full.
            emit({ uploadId, sentBytes: Math.min(sentBytes, totalBytes), totalBytes })
          }
        })
      } catch (error) {
        if (cancellation.signal.aborted && options?.exclusive) {
          // Why: the exclusive create proves this partial file is ours to remove.
          await provider.deletePath(remotePath, false).catch(() => {})
        }
        throw error
      }
    },
    // Why: the shared session outlives this source; its owner closes it once.
    close: () => {}
  }
  try {
    return await run(trackedSession)
  } finally {
    cancellation.release()
  }
}
