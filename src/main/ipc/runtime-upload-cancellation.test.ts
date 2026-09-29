import { afterEach, describe, expect, it } from 'vitest'
import {
  cancelRuntimeUpload,
  forgetRuntimeUploadCancellation,
  isRuntimeUploadCancelled,
  isUploadCancelled,
  registerCancellableUpload,
  RuntimeUploadCancelledError,
  scopeRuntimeUploadId
} from './runtime-upload-cancellation'

afterEach(() => {
  forgetRuntimeUploadCancellation('u')
  forgetRuntimeUploadCancellation('v')
})

describe('runtime upload cancellation', () => {
  it('aborts an upload that is already running', () => {
    const { signal } = registerCancellableUpload('u')
    expect(signal.aborted).toBe(false)

    cancelRuntimeUpload('u')

    expect(signal.aborted).toBe(true)
  })

  it('aborts the next file when cancel lands between two files of one drop', () => {
    const first = registerCancellableUpload('u')
    first.release()
    cancelRuntimeUpload('u')

    const second = registerCancellableUpload('u')

    expect(second.signal.aborted).toBe(true)
  })

  it('leaves other uploads running', () => {
    const target = registerCancellableUpload('u')
    const bystander = registerCancellableUpload('v')

    cancelRuntimeUpload('u')

    expect(target.signal.aborted).toBe(true)
    expect(bystander.signal.aborted).toBe(false)
  })

  it('stops applying a cancel once the drop is forgotten', () => {
    cancelRuntimeUpload('u')
    forgetRuntimeUploadCancellation('u')

    expect(isUploadCancelled('u')).toBe(false)
    expect(registerCancellableUpload('u').signal.aborted).toBe(false)
  })

  it('releasing a superseded registration does not evict the live one', () => {
    const stale = registerCancellableUpload('u')
    const live = registerCancellableUpload('u')
    stale.release()

    cancelRuntimeUpload('u')

    expect(live.signal.aborted).toBe(true)
  })

  it('keeps windows apart even when they mint the same id', () => {
    expect(scopeRuntimeUploadId(1, 'u')).not.toBe(scopeRuntimeUploadId(2, 'u'))
  })

  it('forgets the oldest unreleased cancels instead of growing without bound', () => {
    const ids = Array.from({ length: 1025 }, (_, index) => `bulk-${index}`)
    for (const id of ids) {
      cancelRuntimeUpload(id)
    }
    expect(isUploadCancelled('bulk-0')).toBe(false)
    expect(isUploadCancelled('bulk-1024')).toBe(true)
    for (const id of ids) {
      forgetRuntimeUploadCancellation(id)
    }
  })

  it('recognises its own error and nothing else', () => {
    expect(isRuntimeUploadCancelled(new RuntimeUploadCancelledError())).toBe(true)
    expect(isRuntimeUploadCancelled(new Error('disk full'))).toBe(false)
    expect(isRuntimeUploadCancelled('cancelled')).toBe(false)
  })
})
