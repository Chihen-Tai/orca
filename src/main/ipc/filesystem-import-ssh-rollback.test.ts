import { describe, expect, it, vi } from 'vitest'
import type { FileStat, FileUploadSession, IFilesystemProvider } from '../providers/types'
import { IDENTITY_READ_DEADLINE_MS, SshImportCreatedLedger } from './filesystem-import-ssh-rollback'

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

  it('gives up on an identity whose read would start past the deadline, so it cannot be a swap', async () => {
    let clock = 0
    const now = vi.spyOn(Date, 'now').mockImplementation(() => clock)
    const pending: (() => void)[] = []
    const provider = createProvider(async (path) => {
      await new Promise<void>((resolve) => pending.push(resolve))
      return { size: 0, type: 'file', mtime: 0, dev: 1, ino: path.length }
    })
    const ledger = new SshImportCreatedLedger(provider, session)
    try {
      const entries = Array.from({ length: 20 }, (_, index) =>
        ledger.record(`/r/f${index}`, 'file', 0)
      )
      await vi.waitFor(() => expect(pending).toHaveLength(16))
      // Why: the queued four would read long after their create, when a swap may already be there.
      clock = IDENTITY_READ_DEADLINE_MS + 1
      while (pending.length > 0) {
        pending.shift()?.()
        await new Promise((resolve) => setImmediate(resolve))
      }

      const identities = await Promise.all(entries.map((entry) => entry.identity))
      expect(identities.slice(0, 16).every((identity) => identity !== null)).toBe(true)
      expect(identities.slice(16)).toEqual([null, null, null, null])
      expect(provider.lstat).toHaveBeenCalledTimes(16)
    } finally {
      now.mockRestore()
    }
  })
})
