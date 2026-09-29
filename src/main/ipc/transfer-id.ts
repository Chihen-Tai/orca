/** One validation rule for renderer-minted upload and download ids. */
export function parseTransferId(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}
