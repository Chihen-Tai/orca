import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runSshUploadWithProgress } from './ssh-upload-progress-client'

const { uuids } = vi.hoisted(() => ({ uuids: { next: 0 } }))

vi.mock('@/lib/browser-uuid', () => ({
  createBrowserUuid: () => `u${++uuids.next}`
}))

type ProgressEvent = { uploadId: string; sentBytes: number; totalBytes: number }

describe('runSshUploadWithProgress', () => {
  let emitProgress: ((event: ProgressEvent) => void) | undefined
  const releaseRuntimeUpload = vi.fn()
  const unsubscribe = vi.fn()

  beforeEach(() => {
    uuids.next = 0
    emitProgress = undefined
    releaseRuntimeUpload.mockReset().mockResolvedValue(undefined)
    unsubscribe.mockReset()
    vi.stubGlobal('window', {
      api: {
        fs: {
          releaseRuntimeUpload,
          onUploadProgress: (callback: (event: ProgressEvent) => void) => {
            emitProgress = callback
            return unsubscribe
          }
        }
      }
    })
  })

  function createHandlers() {
    return { onStart: vi.fn(), onRowProgress: vi.fn(), onRowSettled: vi.fn(), onFinish: vi.fn() }
  }

  it('runs without ids when nobody tracks progress', async () => {
    const run = vi.fn().mockResolvedValue('result')
    await expect(runSshUploadWithProgress(['/a'], undefined, run, () => 'done')).resolves.toBe(
      'result'
    )
    expect(run).toHaveBeenCalledWith(undefined)
  })

  it('opens one row per source, routes only its own progress, and settles from the result', async () => {
    const handlers = createHandlers()
    const run = vi.fn(async (uploadIds: Record<string, string> | undefined) => {
      emitProgress?.({ uploadId: 'someone-else', sentBytes: 1, totalBytes: 1 })
      emitProgress?.({ uploadId: uploadIds!['/local/videos'], sentBytes: 5, totalBytes: 10 })
      return { failedPaths: ['/local/b.txt'] }
    })

    await runSshUploadWithProgress(
      ['/local/videos', '/local/b.txt'],
      handlers,
      run,
      (result, path) => (result.failedPaths.includes(path) ? 'failed' : 'done')
    )

    expect(run).toHaveBeenCalledWith({ '/local/videos': 'u1', '/local/b.txt': 'u2' })
    expect(handlers.onStart).toHaveBeenCalledWith([
      { uploadId: 'u1', name: 'videos', totalBytes: 0, sourcePath: '/local/videos' },
      { uploadId: 'u2', name: 'b.txt', totalBytes: 0, sourcePath: '/local/b.txt' }
    ])
    expect(handlers.onRowProgress.mock.calls).toEqual([['u1', 5, 10]])
    expect(handlers.onRowSettled.mock.calls).toEqual([
      ['u1', 'done'],
      ['u2', 'failed']
    ])
    expect(handlers.onFinish).toHaveBeenCalledTimes(1)
    expect(unsubscribe).toHaveBeenCalledTimes(1)
    expect(releaseRuntimeUpload.mock.calls).toEqual([[{ uploadId: 'u1' }], [{ uploadId: 'u2' }]])
  })

  it('still releases ids and finishes when the import throws', async () => {
    const handlers = createHandlers()
    await expect(
      runSshUploadWithProgress(
        ['/a'],
        handlers,
        async () => {
          throw new Error('connection dropped')
        },
        () => 'done'
      )
    ).rejects.toThrow('connection dropped')
    expect(handlers.onRowSettled).not.toHaveBeenCalled()
    expect(handlers.onFinish).toHaveBeenCalledTimes(1)
    expect(releaseRuntimeUpload).toHaveBeenCalledWith({ uploadId: 'u1' })
  })
})
