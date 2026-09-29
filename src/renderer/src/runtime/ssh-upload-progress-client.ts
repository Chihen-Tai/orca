import { createBrowserUuid } from '@/lib/browser-uuid'
import { basename } from '@/lib/path'
import type { RuntimeImportProgressHandlers } from './runtime-upload-progress-tracker'

/**
 * Drives upload progress for an SSH import, where main owns the byte pump.
 * Each dropped source gets one id; main measures it and streams its bytes on
 * `fs:uploadProgress`, and the same id cancels it.
 */
export async function runSshUploadWithProgress<T>(
  sourcePaths: string[],
  handlers: RuntimeImportProgressHandlers | undefined,
  run: (uploadIds: Record<string, string> | undefined) => Promise<T>,
  outcomeFor: (result: T, sourcePath: string) => { status: 'done' | 'failed'; detail?: string }
): Promise<T> {
  if (!handlers) {
    return run(undefined)
  }
  const uploadIds: Record<string, string> = {}
  const idsInFlight = new Set<string>()
  for (const sourcePath of sourcePaths) {
    const uploadId = createBrowserUuid()
    uploadIds[sourcePath] = uploadId
    idsInFlight.add(uploadId)
  }
  // Why: sizes are measured in main right before each source moves, so rows
  // start empty and take their total from the first progress event.
  handlers.onStart(
    sourcePaths.map((sourcePath) => ({
      uploadId: uploadIds[sourcePath],
      name: basename(sourcePath) || sourcePath,
      totalBytes: 0,
      sourcePath
    }))
  )
  const unsubscribe = window.api.fs.onUploadProgress((event) => {
    // Why: a concurrent drop in another pane shares this channel.
    if (idsInFlight.has(event.uploadId)) {
      handlers.onRowProgress(event.uploadId, event.sentBytes, event.totalBytes, event.kind)
    }
  })
  try {
    const result = await run(uploadIds)
    for (const sourcePath of sourcePaths) {
      const outcome = outcomeFor(result, sourcePath)
      handlers.onRowSettled(uploadIds[sourcePath], outcome.status, outcome.detail)
    }
    return result
  } finally {
    unsubscribe()
    for (const uploadId of idsInFlight) {
      void window.api.fs.releaseRuntimeUpload({ uploadId }).catch(() => {})
    }
    handlers.onFinish()
  }
}
