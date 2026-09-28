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
import { cancelRuntimeUpload, forgetRuntimeUploadCancellation } from './runtime-upload-cancellation'

type UploadOptions = Parameters<FileUploadSession['uploadFile']>[2]

function createSender() {
  return { isDestroyed: vi.fn(() => false), send: vi.fn() }
}

function createProvider(): Pick<IFilesystemProvider, 'deletePath'> & {
  deletePath: ReturnType<typeof vi.fn>
} {
  return { deletePath: vi.fn().mockResolvedValue(undefined) }
}

describe('SSH import progress', () => {
  const roots: string[] = []

  afterEach(async () => {
    forgetRuntimeUploadCancellation('u1')
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

  it('aborts the in-flight file on cancel and removes its partial remote copy', async () => {
    const sourcePath = await createSource()
    const provider = createProvider()
    const uploadFile = vi.fn(
      (_local: string, _remote: string, options: UploadOptions) =>
        new Promise<void>((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
          cancelRuntimeUpload('u1')
        })
    )

    await expect(
      importSshSourceWithProgress(
        { sender: createSender(), uploadIdsBySourcePath: { [sourcePath]: 'u1' } },
        sourcePath,
        provider,
        { uploadFile, close: vi.fn() },
        async (tracked) => {
          await tracked.uploadFile('/l/a', '/r/a', { exclusive: true })
          return { sourcePath, status: 'imported', destPath: '/r/a', kind: 'file', renamed: false }
        }
      )
    ).rejects.toThrow('aborted')
    expect(provider.deletePath).toHaveBeenCalledWith('/r/a', false)
  })
})
