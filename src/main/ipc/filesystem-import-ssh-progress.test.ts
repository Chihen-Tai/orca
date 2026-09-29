import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FileUploadSession, IFilesystemProvider } from '../providers/types'
import {
  importSshSourceWithProgress,
  measureLocalUploadBytes,
  toSshImportProgressTarget
} from './filesystem-import-ssh-progress'
import {
  cancelRuntimeUpload,
  forgetRuntimeUploadCancellation,
  scopeRuntimeUploadId
} from './runtime-upload-cancellation'

type UploadOptions = Parameters<FileUploadSession['uploadFile']>[2]

const SENDER_ID = 7
const SCOPED_ID = scopeRuntimeUploadId(SENDER_ID, 'u1')

function createSender() {
  return { id: SENDER_ID, isDestroyed: vi.fn(() => false), send: vi.fn() }
}

function createProvider(): Pick<IFilesystemProvider, 'deletePath'> & {
  deletePath: ReturnType<typeof vi.fn>
} {
  return { deletePath: vi.fn().mockResolvedValue(undefined) }
}

describe('SSH import progress', () => {
  const roots: string[] = []

  afterEach(async () => {
    forgetRuntimeUploadCancellation(SCOPED_ID)
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  async function createSource(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'orca-ssh-import-progress-'))
    roots.push(root)
    await mkdir(join(root, 'src', 'nested'), { recursive: true })
    await writeFile(join(root, 'src', 'a.txt'), 'abcd')
    await writeFile(join(root, 'src', 'nested', 'b.txt'), 'efghij')
    await symlink(join(root, 'src', 'a.txt'), join(root, 'src', 'link.txt'))
    return join(root, 'src')
  }

  it('measures the bytes an upload will move, skipping symlinks', async () => {
    expect(await measureLocalUploadBytes(await createSource())).toBe(10)
  })

  it('builds a target only when progress ids were sent', () => {
    const sender = createSender()
    expect(toSshImportProgressTarget(null, { '/a': 'u1' })).toBeUndefined()
    expect(toSshImportProgressTarget({ sender }, undefined)).toBeUndefined()
    expect(toSshImportProgressTarget({ sender }, { '/a': 'u1', '/b': '', '/c': 3 })).toEqual({
      sender,
      uploadIdsBySourcePath: { '/a': 'u1' }
    })
  })

  it('runs the plain session when the source has no progress id', async () => {
    const session: FileUploadSession = { uploadFile: vi.fn(), close: vi.fn() }
    const run = vi
      .fn()
      .mockResolvedValue({ sourcePath: '/a', status: 'skipped', reason: 'missing' })

    await importSshSourceWithProgress(undefined, '/a', createProvider(), session, run)

    expect(run).toHaveBeenCalledWith(session)
  })

  it('reports the measured total up front and the running byte count per source', async () => {
    const sourcePath = await createSource()
    const sender = createSender()
    const uploadFile = vi.fn(async (_local: string, _remote: string, options: UploadOptions) => {
      options?.onBytesTransferred?.(4)
    })
    const session: FileUploadSession = { uploadFile, close: vi.fn() }

    await importSshSourceWithProgress(
      { sender, uploadIdsBySourcePath: { [sourcePath]: 'u1' } },
      sourcePath,
      createProvider(),
      session,
      async (tracked) => {
        await tracked.uploadFile('/l/a', '/r/a', { exclusive: true })
        await tracked.uploadFile('/l/b', '/r/b', { exclusive: true })
        await tracked.uploadFile('/l/c', '/r/c', { exclusive: true })
        tracked.close()
        return { sourcePath, status: 'imported', destPath: '/r', kind: 'directory', renamed: false }
      }
    )

    const events = sender.send.mock.calls.map(([, progress]) => progress)
    expect(events[0]).toEqual({ uploadId: 'u1', sentBytes: 0, totalBytes: 10 })
    // Why: the third file pushes past the measured total; the bar must stop at full.
    expect(events.at(-1)).toEqual({ uploadId: 'u1', sentBytes: 10, totalBytes: 10 })
    expect(session.close).not.toHaveBeenCalled()
  })

  function cancellingUpload(createsRemoteFile: boolean) {
    return vi.fn(
      (_local: string, _remote: string, options: UploadOptions) =>
        new Promise<void>((_resolve, reject) => {
          if (createsRemoteFile) {
            options?.onRemoteCreated?.()
          }
          options?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
          cancelRuntimeUpload(SCOPED_ID)
        })
    )
  }

  async function runCancelledUpload(createsRemoteFile: boolean) {
    const sourcePath = await createSource()
    const provider = createProvider()
    await expect(
      importSshSourceWithProgress(
        { sender: createSender(), uploadIdsBySourcePath: { [sourcePath]: 'u1' } },
        sourcePath,
        provider,
        { uploadFile: cancellingUpload(createsRemoteFile), close: vi.fn() },
        async (tracked) => {
          await tracked.uploadFile('/l/a', '/r/a', { exclusive: true })
          return { sourcePath, status: 'imported', destPath: '/r/a', kind: 'file', renamed: false }
        }
      )
    ).rejects.toThrow('aborted')
    return provider
  }

  it('aborts the in-flight file on cancel and removes the partial file it created', async () => {
    const provider = await runCancelledUpload(true)
    expect(provider.deletePath).toHaveBeenCalledWith('/r/a', false)
  })

  it('leaves a file it never created alone when cancel races an exclusive-create loss', async () => {
    const provider = await runCancelledUpload(false)
    expect(provider.deletePath).not.toHaveBeenCalled()
  })

  it('rolls back a source whose cancel arrives after its last byte', async () => {
    const sourcePath = await createSource()
    const provider = createProvider()

    const result = await importSshSourceWithProgress(
      { sender: createSender(), uploadIdsBySourcePath: { [sourcePath]: 'u1' } },
      sourcePath,
      provider,
      { uploadFile: vi.fn(), close: vi.fn() },
      async () => {
        // Why: an empty folder uploads no file, so nothing observes the signal mid-run.
        cancelRuntimeUpload(SCOPED_ID)
        return {
          sourcePath,
          status: 'imported',
          destPath: '/r/src',
          kind: 'directory',
          renamed: false
        }
      }
    )

    expect(result).toEqual({ sourcePath, status: 'failed', reason: 'Upload cancelled' })
    expect(provider.deletePath).toHaveBeenCalledWith('/r/src', true)
  })

  it('ignores a cancel sent for the same id from another window', async () => {
    const sourcePath = await createSource()
    const provider = createProvider()

    const result = await importSshSourceWithProgress(
      { sender: createSender(), uploadIdsBySourcePath: { [sourcePath]: 'u1' } },
      sourcePath,
      provider,
      { uploadFile: vi.fn(), close: vi.fn() },
      async () => {
        cancelRuntimeUpload(scopeRuntimeUploadId(SENDER_ID + 1, 'u1'))
        return { sourcePath, status: 'imported', destPath: '/r/a', kind: 'file', renamed: false }
      }
    )

    expect(result.status).toBe('imported')
    expect(provider.deletePath).not.toHaveBeenCalled()
    forgetRuntimeUploadCancellation(scopeRuntimeUploadId(SENDER_ID + 1, 'u1'))
  })
})
