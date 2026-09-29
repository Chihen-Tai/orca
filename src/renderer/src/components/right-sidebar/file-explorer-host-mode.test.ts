import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fetchHostDirectoryListing,
  filterHostEntries,
  getHostBrowseAvailability,
  planHostFileOpen,
  resolveHostEntry
} from './file-explorer-host-mode'

const { browseRuntimeServerDirectoryMock } = vi.hoisted(() => ({
  browseRuntimeServerDirectoryMock: vi.fn()
}))

vi.mock('@/runtime/runtime-server-directory-browser', () => ({
  browseRuntimeServerDirectory: browseRuntimeServerDirectoryMock
}))

const browseHostDir = vi.fn()
const resolveHostBrowseEntry = vi.fn()
const sshBrowseDir = vi.fn()
const listFiles = vi.fn()
const search = vi.fn()
const authorizeExternalPath = vi.fn()

beforeEach(() => {
  for (const mock of [
    browseHostDir,
    resolveHostBrowseEntry,
    sshBrowseDir,
    listFiles,
    search,
    authorizeExternalPath,
    browseRuntimeServerDirectoryMock
  ]) {
    mock.mockReset()
  }
  vi.stubGlobal('window', {
    api: {
      fs: { browseHostDir, resolveHostBrowseEntry, listFiles, search, authorizeExternalPath },
      ssh: { browseDir: sshBrowseDir }
    }
  })
})

const file = { name: 'notes.txt', isDirectory: false, isSymlink: false }
const link = { name: 'link', isDirectory: false, isSymlink: true }
const dir = { name: 'src', isDirectory: true, isSymlink: false }

describe('getHostBrowseAvailability', () => {
  it('maps each Explorer owner to its host listing source', () => {
    expect(getHostBrowseAvailability({ kind: 'local' }, true)).toEqual({
      available: true,
      source: { kind: 'local' }
    })
    expect(getHostBrowseAvailability({ kind: 'ssh', connectionId: 'ssh-1' }, true)).toEqual({
      available: true,
      source: { kind: 'ssh', connectionId: 'ssh-1' }
    })
    expect(
      getHostBrowseAvailability(
        { kind: 'runtime', environmentId: 'env-1', executionHostId: 'runtime:env-1' },
        false
      )
    ).toEqual({ available: true, source: { kind: 'runtime', environmentId: 'env-1' } })
  })

  it('refuses SSH on clients without the desktop browse and resolve APIs', () => {
    expect(getHostBrowseAvailability({ kind: 'ssh', connectionId: 'ssh-1' }, false)).toEqual({
      available: false,
      reason: 'unsupported-client'
    })
  })

  it('keeps paired-server browsing available on clients without desktop APIs', () => {
    expect(
      getHostBrowseAvailability(
        { kind: 'runtime', environmentId: 'env-1', executionHostId: 'runtime:env-1' },
        false
      )
    ).toEqual({ available: true, source: { kind: 'runtime', environmentId: 'env-1' } })
  })

  it('refuses owners whose listing would show the wrong machine or nothing', () => {
    expect(getHostBrowseAvailability({ kind: 'local' }, false)).toEqual({
      available: false,
      reason: 'unsupported-client'
    })
    expect(
      getHostBrowseAvailability(
        { kind: 'runtime', environmentId: 'env-1', executionHostId: 'ssh:box' },
        true
      )
    ).toEqual({ available: false, reason: 'runtime-remote-host' })
    expect(getHostBrowseAvailability({ kind: 'unresolved' }, true)).toEqual({
      available: false,
      reason: 'unresolved'
    })
  })
})

describe('fetchHostDirectoryListing', () => {
  it('lists local directories through the names-only host channel', async () => {
    const listing = { resolvedPath: '/home/allen', entries: [dir], pathFlavor: 'posix' }
    browseHostDir.mockResolvedValue(listing)

    await expect(fetchHostDirectoryListing({ kind: 'local' }, '/home/allen')).resolves.toBe(listing)
    expect(browseHostDir).toHaveBeenCalledWith({ dirPath: '/home/allen' })
    expect(authorizeExternalPath).not.toHaveBeenCalled()
  })

  it('lists SSH directories on the workspace host and marks entries as non-symlinks', async () => {
    sshBrowseDir.mockResolvedValue({
      resolvedPath: '/Data2/allen921103',
      entries: [{ name: 'project', isDirectory: true }],
      pathFlavor: 'posix'
    })

    await expect(
      fetchHostDirectoryListing({ kind: 'ssh', connectionId: 'ssh-1' }, '/Data2/allen921103')
    ).resolves.toEqual({
      resolvedPath: '/Data2/allen921103',
      entries: [{ name: 'project', isDirectory: true, isSymlink: false }],
      pathFlavor: 'posix'
    })
    expect(sshBrowseDir).toHaveBeenCalledWith({ targetId: 'ssh-1', dirPath: '/Data2/allen921103' })
  })

  it('lists runtime directories on the runtime server', async () => {
    browseRuntimeServerDirectoryMock.mockResolvedValue({
      resolvedPath: 'C:\\Users\\allen',
      entries: [],
      pathFlavor: 'win32'
    })

    await fetchHostDirectoryListing({ kind: 'runtime', environmentId: 'env-1' }, 'C:\\Users\\allen')

    expect(browseRuntimeServerDirectoryMock).toHaveBeenCalledWith('env-1', 'C:\\Users\\allen')
  })

  it('never falls back to workspace search or file-list APIs', async () => {
    browseHostDir.mockResolvedValue({ resolvedPath: '/', entries: [], pathFlavor: 'posix' })
    await fetchHostDirectoryListing({ kind: 'local' }, '/')
    expect(listFiles).not.toHaveBeenCalled()
    expect(search).not.toHaveBeenCalled()
  })
})

describe('resolveHostEntry', () => {
  const root = '/home/allen/codes'

  it('trusts listed directories without a round trip', async () => {
    await expect(
      resolveHostEntry({ kind: 'local' }, '/home/allen/src', dir, root)
    ).resolves.toEqual({
      kind: 'directory',
      realPath: '/home/allen/src',
      workspaceRelativePath: null
    })
    expect(resolveHostBrowseEntry).not.toHaveBeenCalled()
  })

  it('classifies local and SSH non-directories in the main process', async () => {
    const resolved = { kind: 'directory', realPath: '/mnt/data', workspaceRelativePath: null }
    resolveHostBrowseEntry.mockResolvedValue(resolved)

    await expect(
      resolveHostEntry({ kind: 'local' }, '/home/allen/link', link, root)
    ).resolves.toEqual(resolved)
    await resolveHostEntry({ kind: 'ssh', connectionId: 'ssh-1' }, '/home/allen/x', file, root)

    expect(resolveHostBrowseEntry).toHaveBeenNthCalledWith(1, {
      targetPath: '/home/allen/link',
      workspaceRoot: root
    })
    expect(resolveHostBrowseEntry).toHaveBeenNthCalledWith(2, {
      targetPath: '/home/allen/x',
      workspaceRoot: root,
      connectionId: 'ssh-1'
    })
    expect(authorizeExternalPath).not.toHaveBeenCalled()
  })

  it('probes only runtime symlinks and treats only "not a directory" as a file', async () => {
    const runtime = { kind: 'runtime', environmentId: 'env-1' } as const

    await expect(resolveHostEntry(runtime, '/srv/notes.txt', file, root)).resolves.toEqual({
      kind: 'file',
      realPath: '/srv/notes.txt',
      workspaceRelativePath: null
    })
    expect(browseRuntimeServerDirectoryMock).not.toHaveBeenCalled()

    browseRuntimeServerDirectoryMock.mockResolvedValueOnce({ resolvedPath: '/srv/link' })
    await expect(resolveHostEntry(runtime, '/srv/link', link, root)).resolves.toMatchObject({
      kind: 'directory'
    })

    browseRuntimeServerDirectoryMock.mockRejectedValueOnce(
      new Error('/srv/link is not a directory')
    )
    await expect(resolveHostEntry(runtime, '/srv/link', link, root)).resolves.toMatchObject({
      kind: 'file'
    })

    browseRuntimeServerDirectoryMock.mockRejectedValueOnce(new Error('Runtime RPC timed out'))
    await expect(resolveHostEntry(runtime, '/srv/link', link, root)).rejects.toThrow(/timed out/)
  })
})

describe('planHostFileOpen', () => {
  const local = { kind: 'local' } as const

  it('opens files inside the workspace through the normal writable path', () => {
    expect(
      planHostFileOpen({
        source: local,
        worktreePath: '/home/allen/codes',
        entryPath: '/home/allen/codes/src/a.ts',
        workspaceRelativePath: 'src/a.ts'
      })
    ).toEqual({
      kind: 'workspace',
      filePath: '/home/allen/codes/src/a.ts',
      relativePath: 'src/a.ts'
    })
  })

  it('keeps a workspace symlink that leaves the workspace read-only (canonical verdict wins)', () => {
    for (const source of [local, { kind: 'ssh', connectionId: 'ssh-1' } as const]) {
      expect(
        planHostFileOpen({
          source,
          worktreePath: '/home/allen/codes',
          entryPath: '/home/allen/codes/link-out',
          workspaceRelativePath: null
        })
      ).toEqual({ kind: 'external', filePath: '/home/allen/codes/link-out' })
    }
  })

  it('falls back to the literal path only for paired servers', () => {
    expect(
      planHostFileOpen({
        source: { kind: 'runtime', environmentId: 'env-1' },
        worktreePath: '/srv/codes',
        entryPath: '/srv/codes/src/a.ts',
        workspaceRelativePath: null
      })
    ).toEqual({ kind: 'workspace', filePath: '/srv/codes/src/a.ts', relativePath: 'src/a.ts' })
  })

  it('uses canonical ownership so a symlink into the workspace reuses the tree tab', () => {
    for (const source of [local, { kind: 'ssh', connectionId: 'ssh-1' } as const]) {
      expect(
        planHostFileOpen({
          source,
          worktreePath: '/home/allen/codes',
          entryPath: '/home/allen/shortcut/a.ts',
          workspaceRelativePath: 'src/a.ts'
        })
      ).toEqual({
        kind: 'workspace',
        filePath: '/home/allen/codes/src/a.ts',
        relativePath: 'src/a.ts'
      })
    }
  })

  it('opens files outside the workspace as external, except on runtimes', () => {
    const outside = {
      worktreePath: '/home/allen/codes',
      entryPath: '/home/allen/.bashrc',
      workspaceRelativePath: null
    }
    expect(planHostFileOpen({ source: local, ...outside })).toEqual({
      kind: 'external',
      filePath: '/home/allen/.bashrc'
    })
    expect(
      planHostFileOpen({ source: { kind: 'runtime', environmentId: 'env-1' }, ...outside })
    ).toEqual({ kind: 'unsupported' })
  })

  it('keeps Windows workspace files on the workspace separator', () => {
    expect(
      planHostFileOpen({
        source: local,
        worktreePath: 'C:\\Users\\allen\\codes',
        entryPath: 'C:\\Users\\allen\\codes\\src\\a.ts',
        workspaceRelativePath: 'src\\a.ts'
      })
    ).toEqual({
      kind: 'workspace',
      filePath: 'C:\\Users\\allen\\codes\\src\\a.ts',
      relativePath: 'src/a.ts'
    })
  })
})

describe('filterHostEntries', () => {
  it('filters only the listed folder by name and honors hidden dotfiles', () => {
    const entries = [dir, file, { name: '.ssh', isDirectory: true, isSymlink: false }]
    expect(filterHostEntries(entries, 'NOTES', true)).toEqual([file])
    expect(filterHostEntries(entries, '', false)).toEqual([dir, file])
    expect(filterHostEntries(entries, 'ssh', true)).toHaveLength(1)
  })
})
