export const UPLOAD_CANCELLED_REASON = 'Upload cancelled'

// Why: reverse-order rollback leaves the outermost path last, which names the whole remnant.
function describeLeftovers(leftovers: readonly string[]): string {
  const root = leftovers.at(-1)
  return leftovers.length === 1
    ? `partial upload left at ${root}`
    : `${leftovers.length} partial items left under ${root}`
}

/** Appends what a rollback could not remove, so the result says it instead of hiding it. */
export function withUploadLeftovers(reason: string, leftovers: readonly string[]): string {
  return leftovers.length === 0 ? reason : `${reason}; ${describeLeftovers(leftovers)}`
}

export function describeUploadCancelledWithLeftovers(leftovers: readonly string[]): string {
  return withUploadLeftovers(UPLOAD_CANCELLED_REASON, leftovers)
}

export function hasUploadLeftovers(reason: string | undefined): boolean {
  return (
    reason !== undefined && /; (partial upload left at |\d+ partial items left under )/.test(reason)
  )
}
