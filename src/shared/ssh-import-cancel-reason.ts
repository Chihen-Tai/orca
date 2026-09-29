export const UPLOAD_CANCELLED_REASON = 'Upload cancelled'

/** A cancel that could not undo everything; the rest names what was left on the host. */
export function describeUploadCancelledWithLeftovers(leftovers: readonly string[]): string {
  if (leftovers.length === 0) {
    return UPLOAD_CANCELLED_REASON
  }
  // Why: reverse-order rollback leaves the outermost path last, which names the whole remnant.
  const root = leftovers.at(-1)
  return leftovers.length === 1
    ? `${UPLOAD_CANCELLED_REASON}; partial upload left at ${root}`
    : `${UPLOAD_CANCELLED_REASON}; ${leftovers.length} partial items left under ${root}`
}

export function isUploadCancelledWithLeftovers(reason: string | undefined): boolean {
  return reason?.startsWith(`${UPLOAD_CANCELLED_REASON}; `) === true
}
