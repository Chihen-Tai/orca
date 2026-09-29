import { describe, expect, it, vi } from 'vitest'
import type { FileStat, FileUploadSession, IFilesystemProvider } from '../providers/types'
import { SshImportCreatedLedger } from './filesystem-import-ssh-rollback'

function createProvider(lstat: (path: string) => Promise<FileStat>): IFilesystemProvider {
  return {
    readDir: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    writeFileBase64: vi.fn(),
    writeFileBase64Chunk: vi.fn(),
    stat: vi.fn(),
    lstat: vi.fn(lstat),
    deletePath: vi.fn(),
    createFile: vi.fn(),
    createDir: vi.fn(),
    createDirNoClobber: vi.fn(),
    rename: vi.fn(),
    renameNoClobber: vi.fn(),
    copy: vi.fn(),
    realpath: vi.fn(),
    search: vi.fn(),
    listFiles: vi.fn(),
    watch: vi.fn()
  }
}

const session: FileUploadSession = { uploadFile: vi.fn(), close: vi.fn() }

describe('SshImportCreatedLedger identity reads', () => {
  it('keeps at most 16 identity reads in flight and still completes every one', async () => {
    let inFlight = 0
    let peak = 0
    const pending: (() => void)[] = []
    const provider = createProvider(async (path) => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await new Promise<void>((resolve) => pending.push(resolve))
      inFlight -= 1
      return { size: 0, type: 'file', mtime: 0, dev: 1, ino: path.length }
    })
    const ledger = new SshImportCreatedLedger(provider, session)

    const entries = Array.from({ length: 40 }, (_, index) =>
      ledger.record(`/r/f${index}`, 'file', 0)
    )
    await vi.waitFor(() => expect(pending).toHaveLength(16))
    // Why: releasing reads one at a time lets each freed slot admit the next queued read.
    while (pending.length > 0) {
      pending.shift()?.()
      await new Promise((resolve) => setImmediate(resolve))
    }

    const identities = await Promise.all(entries.map((entry) => entry.identity))
    expect(peak).toBe(16)
    expect(identities.every((identity) => identity !== null)).toBe(true)
  })
})
