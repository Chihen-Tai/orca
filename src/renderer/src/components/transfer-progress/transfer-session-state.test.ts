import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  endTransferSession,
  getTransferSession,
  settleTransferSession,
  startTransferSession,
  subscribeToTransferSessions,
  summarizeTransferSession,
  toggleTransferCollapsed,
  updateTransferRow,
  type TransferRow
} from './transfer-session-state'

function row(overrides: Partial<TransferRow> = {}): TransferRow {
  return {
    transferId: 'a',
    name: 'a.bin',
    sentBytes: 0,
    totalBytes: 100,
    status: 'active',
    ...overrides
  }
}

afterEach(() => {
  endTransferSession('s')
  endTransferSession('other')
})

describe('runtime upload session state', () => {
  it('notifies subscribers when a row advances', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeToTransferSessions(listener)
    startTransferSession('s', 'upload', [row()])
    updateTransferRow('s', 'a', { sentBytes: 25 })

    expect(listener).toHaveBeenCalledTimes(2)
    expect(getTransferSession('s')?.rows[0]?.sentBytes).toBe(25)
    unsubscribe()
  })

  it('replaces the row object so a memoized bar re-renders', () => {
    startTransferSession('s', 'upload', [row()])
    const before = getTransferSession('s')?.rows[0]
    updateTransferRow('s', 'a', { sentBytes: 10 })

    expect(getTransferSession('s')?.rows[0]).not.toBe(before)
  })

  it('refuses to drag a cancelled row back into uploading', () => {
    startTransferSession('s', 'upload', [row()])
    updateTransferRow('s', 'a', { status: 'cancelled' })
    updateTransferRow('s', 'a', { sentBytes: 90, status: 'active' })

    const settled = getTransferSession('s')?.rows[0]
    expect(settled?.status).toBe('cancelled')
    expect(settled?.sentBytes).toBe(0)
  })

  it('keeps a cancelled row cancelled when the import later reports it failed', () => {
    startTransferSession('s', 'upload', [row()])
    updateTransferRow('s', 'a', { status: 'cancelled' })
    updateTransferRow('s', 'a', { status: 'failed' })

    expect(getTransferSession('s')?.rows[0]?.status).toBe('cancelled')
  })

  it('leaves other sessions untouched', () => {
    startTransferSession('s', 'upload', [row()])
    startTransferSession('other', 'upload', [row({ transferId: 'b' })])
    updateTransferRow('s', 'a', { sentBytes: 50 })

    expect(getTransferSession('other')?.rows[0]?.sentBytes).toBe(0)
  })

  it('ignores updates for a session that already ended', () => {
    startTransferSession('s', 'upload', [row()])
    endTransferSession('s')

    expect(() => updateTransferRow('s', 'a', { sentBytes: 10 })).not.toThrow()
    expect(getTransferSession('s')).toBeUndefined()
  })

  it('keeps rows when settled so the panel can state the outcome', () => {
    startTransferSession('s', 'upload', [row({ status: 'cancelled' })])
    settleTransferSession('s')

    const session = getTransferSession('s')
    expect(session?.settled).toBe(true)
    expect(session?.rows).toHaveLength(1)
  })

  it('toggles collapse in the store so the panel can be remounted to re-measure', () => {
    startTransferSession('s', 'upload', [row()])
    expect(getTransferSession('s')?.collapsed).toBe(false)

    toggleTransferCollapsed('s')
    expect(getTransferSession('s')?.collapsed).toBe(true)

    toggleTransferCollapsed('s')
    expect(getTransferSession('s')?.collapsed).toBe(false)
  })

  it('survives a collapse toggle on a session that already ended', () => {
    expect(() => toggleTransferCollapsed('gone')).not.toThrow()
  })

  it('settles only once', () => {
    startTransferSession('s', 'upload', [row()])
    settleTransferSession('s')
    const listener = vi.fn()
    const unsubscribe = subscribeToTransferSessions(listener)
    settleTransferSession('s')

    expect(listener).not.toHaveBeenCalled()
    unsubscribe()
  })

  it('does not notify when nothing actually changed', () => {
    startTransferSession('s', 'upload', [row({ status: 'done' })])
    const listener = vi.fn()
    const unsubscribe = subscribeToTransferSessions(listener)
    updateTransferRow('s', 'a', { sentBytes: 10 })

    expect(listener).not.toHaveBeenCalled()
    unsubscribe()
  })
})

describe('summarizeTransferSession', () => {
  it('averages across rows by bytes, not by row count', () => {
    const summary = summarizeTransferSession({
      sessionId: 's',
      direction: 'upload',
      settled: true,
      collapsed: false,
      rows: [
        row({ transferId: 'a', sentBytes: 10, totalBytes: 10 }),
        row({ transferId: 'b', sentBytes: 0, totalBytes: 90 })
      ]
    })

    expect(summary.percent).toBe(10)
  })

  it('drops cancelled rows from the denominator so the bar can still finish', () => {
    const summary = summarizeTransferSession({
      sessionId: 's',
      direction: 'upload',
      settled: true,
      collapsed: false,
      rows: [
        row({ transferId: 'a', sentBytes: 100, totalBytes: 100, status: 'done' }),
        row({ transferId: 'b', sentBytes: 20, totalBytes: 900, status: 'cancelled' })
      ]
    })

    expect(summary.percent).toBe(100)
    expect(summary.totalBytes).toBe(100)
  })

  it('counts only rows still moving as active', () => {
    const summary = summarizeTransferSession({
      sessionId: 's',
      direction: 'upload',
      settled: true,
      collapsed: false,
      rows: [
        row({ transferId: 'a', status: 'done' }),
        row({ transferId: 'b', status: 'active' }),
        row({ transferId: 'c', status: 'cancelled' })
      ]
    })

    expect(summary.activeCount).toBe(1)
  })

  it('is zero percent rather than NaN for an all-empty drop', () => {
    const summary = summarizeTransferSession({
      sessionId: 's',
      direction: 'upload',
      settled: true,
      collapsed: false,
      rows: [row({ sentBytes: 0, totalBytes: 0 })]
    })

    expect(summary.percent).toBe(0)
  })
})
