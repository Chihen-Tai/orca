import type { FileUploadSession, IFilesystemProvider } from '../providers/types'

export type CreatedRemoteEntry = {
  path: string
  kind: 'file' | 'directory'
  /** Bytes this import wrote at most; a larger file at the path is no longer only ours. */
  maxBytes?: number
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

  record(entry: CreatedRemoteEntry): void {
    this.created.push(entry)
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

  private async remove(entry: CreatedRemoteEntry): Promise<void> {
    if (entry.kind === 'file' && entry.maxBytes !== undefined) {
      // Why: between our create and the cancel, another client may have replaced or grown the
      // file; anything that is not a regular file within what we wrote is kept and reported.
      const stat = await this.provider.stat(entry.path)
      if (stat.type !== 'file' || stat.size > entry.maxBytes) {
        throw new Error(`${entry.path} changed after this upload created it`)
      }
    }
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
          ledger.record({ path: dirPath, kind: 'directory' })
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
