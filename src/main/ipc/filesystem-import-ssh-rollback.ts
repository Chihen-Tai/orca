import type { FileStat, FileUploadSession, IFilesystemProvider } from '../providers/types'

export type CreatedRemoteEntry = {
  path: string
  kind: 'file' | 'directory'
  /** Identity taken right after our exclusive create, so a replaced node is recognised. */
  identity: Promise<FileStat | null>
  /** Upper bound on the bytes this import wrote into the file (read-side count, so never low). */
  maxBytes: number
}

/**
 * What one tracked SSH import created, so a cancel can undo exactly that.
 *
 * Why not `rm -rf` of the import root: another client (an agent, an editor) may
 * write into the new folder before the cancel lands, and those files are not ours.
 */
export class SshImportCreatedLedger {
  private readonly created: CreatedRemoteEntry[] = []
  private readonly removed = new Set<string>()

  constructor(
    private readonly provider: IFilesystemProvider,
    private readonly session: FileUploadSession,
    private readonly assertCurrent?: () => void
  ) {}

  /** Records an entry our exclusive create just made; the returned entry takes later byte counts. */
  record(path: string, kind: 'file' | 'directory', maxBytes: number): CreatedRemoteEntry {
    // Why: not awaited, so the transfer never waits on it; the create was exclusive, so the
    // identity this reads is ours.
    const identity = this.provider.lstat
      ? this.provider.lstat(path).catch(() => null)
      : Promise.resolve(null)
    const entry = { path, kind, identity, maxBytes }
    this.created.push(entry)
    return entry
  }

  /**
   * What this import created that is still on the host, in reverse creation order:
   * a rollback's failures, or everything when no rollback ran (a dropped connection).
   */
  get remaining(): readonly string[] {
    return this.created
      .toReversed()
      .filter((entry) => !this.removed.has(entry.path))
      .map((entry) => entry.path)
  }

  /** Children first (reverse creation order); a non-empty directory is kept. Idempotent. */
  async rollback(): Promise<void> {
    for (const entry of this.created.toReversed()) {
      if (this.removed.has(entry.path)) {
        continue
      }
      try {
        // Why: a replacement session must never inherit cleanup from the retired owner.
        this.assertCurrent?.()
        await this.remove(entry)
        this.removed.add(entry.path)
      } catch {
        // Why: kept in `remaining`, which the result reports instead of swallowing.
      }
    }
  }

  /**
   * Proves the path still holds what we created: lstat (a symlink is never ours), the same
   * dev/ino as at creation (an atomic-rename save or a swapped node changes them), and no more
   * bytes than we wrote. A path we cannot verify is kept and reported, never removed.
   */
  private async assertStillOurs(entry: CreatedRemoteEntry): Promise<void> {
    if (!this.provider.lstat) {
      throw new Error(`cannot verify ${entry.path} before removing it`)
    }
    const [created, current] = await Promise.all([entry.identity, this.provider.lstat(entry.path)])
    const changed =
      current.type !== entry.kind ||
      (entry.kind === 'file' && current.size > entry.maxBytes) ||
      (created?.ino !== undefined &&
        current.ino !== undefined &&
        (created.ino !== current.ino || created.dev !== current.dev))
    if (changed) {
      throw new Error(`${entry.path} changed after this upload created it`)
    }
  }

  private async remove(entry: CreatedRemoteEntry): Promise<void> {
    await this.assertStillOurs(entry)
    if (this.session.removeCreatedEntry) {
      await this.session.removeCreatedEntry(entry.path, entry.kind)
      return
    }
    if (entry.kind === 'directory') {
      // Why: the relay's only directory delete is recursive; keeping the folder is the safe loss.
      throw new Error('No non-recursive directory removal on this transport')
    }
    await this.provider.deletePath(entry.path, false)
  }
}

/**
 * The provider the import runs against: it records the directories it creates, and
 * turns the import's own recursive failure cleanup into the ledger's exact rollback.
 */
export function createLedgerTrackedProvider(
  provider: IFilesystemProvider,
  ledger: SshImportCreatedLedger
): IFilesystemProvider {
  return new Proxy(provider, {
    get(target, property) {
      if (property === 'createDirNoClobber') {
        return async (dirPath: string): Promise<void> => {
          await target.createDirNoClobber(dirPath)
          ledger.record(dirPath, 'directory', 0)
        }
      }
      if (property === 'deletePath') {
        return async (targetPath: string, recursive?: boolean): Promise<void> =>
          recursive ? ledger.rollback() : target.deletePath(targetPath, recursive)
      }
      const value: unknown = Reflect.get(target, property, target)
      return typeof value === 'function' ? value.bind(target) : value
    }
  })
}

export { describeUploadCancelledWithLeftovers as describeCancelledImport } from '../../shared/ssh-import-cancel-reason'
