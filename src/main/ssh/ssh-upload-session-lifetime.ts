import type { FileUploadSession } from '../providers/filesystem-provider-contract'
import type { SshConnectionWorkLedger } from './ssh-connection-work-ledger'

export async function openTrackedSshUploadSession(
  ledger: SshConnectionWorkLedger,
  open: () => Promise<FileUploadSession>
): Promise<FileUploadSession> {
  const lifetime = ledger.beginSession()
  let session: FileUploadSession
  try {
    session = await lifetime.run(open)
  } catch (error) {
    lifetime.close(error)
    throw error
  }
  let closed = false
  // Why: optional, so it must be forwarded explicitly; without it a cancel's rollback falls back
  // to keeping every folder and deleting files by path instead of the remote's guarded removal.
  const removeCreatedEntry = session.removeCreatedEntry?.bind(session)
  return {
    uploadFile: (...args) => lifetime.run(() => session.uploadFile(...args)),
    ...(removeCreatedEntry
      ? {
          removeCreatedEntry: (remotePath: string, kind: 'file' | 'directory') =>
            lifetime.run(() => removeCreatedEntry(remotePath, kind))
        }
      : {}),
    close: () => {
      if (closed) {
        return
      }
      closed = true
      try {
        session.close()
      } catch (error) {
        lifetime.close(error)
        throw error
      }
      lifetime.close()
    }
  }
}
