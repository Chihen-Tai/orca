import { getRelativePathInsideRoot, joinPath, normalizeRelativePath } from '@/lib/path'
import { browseRuntimeServerDirectory } from '@/runtime/runtime-server-directory-browser'
import { filterEntries } from '../sidebar/remote-file-browser-helpers'
import { parseExecutionHostId } from '../../../../shared/execution-host'
import type {
  DirEntry,
  HostBrowseEntryResolution,
  HostDirectoryListing
} from '../../../../shared/filesystem-entry-types'
import type { FileExplorerOperationOwner } from './file-explorer-types'

export type HostBrowseSource =
  | { kind: 'local' }
  | { kind: 'ssh'; connectionId: string }
  | { kind: 'runtime'; environmentId: string }

export type HostBrowseUnavailableReason =
  | 'unresolved'
  | 'unsupported-client'
  | 'runtime-remote-host'

export type HostBrowseAvailability =
  | { available: true; source: HostBrowseSource }
  | { available: false; reason: HostBrowseUnavailableReason }

export function getHostBrowseAvailability(
  owner: FileExplorerOperationOwner,
  hasLocalHostBrowse: boolean
): HostBrowseAvailability {
  switch (owner.kind) {
    case 'local':
      return hasLocalHostBrowse
        ? { available: true, source: { kind: 'local' } }
        : { available: false, reason: 'unsupported-client' }
    case 'ssh':
      return { available: true, source: { kind: 'ssh', connectionId: owner.connectionId } }
    case 'runtime':
      // Why: files.browseServerDir lists the runtime server's own disk, which is not the
      // workspace host when the runtime reaches it over SSH.
      return parseExecutionHostId(owner.executionHostId)?.kind === 'runtime'
        ? { available: true, source: { kind: 'runtime', environmentId: owner.environmentId } }
        : { available: false, reason: 'runtime-remote-host' }
    case 'unresolved':
      return { available: false, reason: 'unresolved' }
  }
}

export async function fetchHostDirectoryListing(
  source: HostBrowseSource,
  dirPath: string
): Promise<HostDirectoryListing> {
  switch (source.kind) {
    case 'local': {
      const browseHostDir = window.api.fs.browseHostDir
      if (!browseHostDir) {
        throw new Error('Host browsing is not available in this client')
      }
      return browseHostDir({ dirPath })
    }
    case 'ssh': {
      const listing = await window.api.ssh.browseDir({ targetId: source.connectionId, dirPath })
      // Why: `ls -p` cannot mark symlinks; non-directories are classified on click instead.
      return {
        ...listing,
        entries: listing.entries.map((entry) => ({ ...entry, isSymlink: false }))
      }
    }
    case 'runtime':
      return browseRuntimeServerDirectory(source.environmentId, dirPath)
  }
}

const RUNTIME_NOT_A_DIRECTORY_RE = /is not a directory/

export async function resolveHostEntry(
  source: HostBrowseSource,
  entryPath: string,
  entry: DirEntry,
  workspaceRoot: string
): Promise<HostBrowseEntryResolution> {
  if (entry.isDirectory) {
    return { kind: 'directory', realPath: entryPath, workspaceRelativePath: null }
  }
  switch (source.kind) {
    case 'local':
    case 'ssh': {
      const resolveEntry = window.api.fs.resolveHostBrowseEntry
      if (!resolveEntry) {
        throw new Error('Host browsing is not available in this client')
      }
      return resolveEntry({
        targetPath: entryPath,
        workspaceRoot,
        ...(source.kind === 'ssh' ? { connectionId: source.connectionId } : {})
      })
    }
    case 'runtime': {
      // Why: runtime listings report symlinks, so only those need a directory probe.
      // Why: runtimes expose no realpath outside the worktree; ownership falls back to the literal path.
      const unresolved = { realPath: entryPath, workspaceRelativePath: null }
      if (!entry.isSymlink) {
        return { kind: 'file', ...unresolved }
      }
      try {
        await browseRuntimeServerDirectory(source.environmentId, entryPath)
        return { kind: 'directory', ...unresolved }
      } catch (error) {
        if (error instanceof Error && RUNTIME_NOT_A_DIRECTORY_RE.test(error.message)) {
          return { kind: 'file', ...unresolved }
        }
        throw error
      }
    }
  }
}

export type HostFileOpenPlan =
  | { kind: 'workspace'; filePath: string; relativePath: string }
  | { kind: 'external'; filePath: string }
  | { kind: 'unsupported' }

export function planHostFileOpen({
  source,
  worktreePath,
  entryPath,
  workspaceRelativePath
}: {
  source: HostBrowseSource
  worktreePath: string
  entryPath: string
  workspaceRelativePath: string | null
}): HostFileOpenPlan {
  // Why: a symlink into the workspace must reuse the tree's writable tab, not open a
  // second read-only tab for the same file.
  const relativePath = getRelativePathInsideRoot(entryPath, worktreePath) || workspaceRelativePath
  if (relativePath) {
    return {
      kind: 'workspace',
      filePath: joinPath(worktreePath, relativePath),
      relativePath: normalizeRelativePath(relativePath)
    }
  }
  // Why: runtime file RPCs reject paths outside the owning worktree.
  return source.kind === 'runtime'
    ? { kind: 'unsupported' }
    : { kind: 'external', filePath: entryPath }
}

export function filterHostEntries(
  entries: DirEntry[],
  query: string,
  showDotfiles: boolean
): DirEntry[] {
  return filterEntries(
    showDotfiles ? entries : entries.filter((entry) => !entry.name.startsWith('.')),
    query
  )
}
