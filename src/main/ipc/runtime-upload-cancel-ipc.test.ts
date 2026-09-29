import { afterEach, describe, expect, it, vi } from 'vitest'

const { handlers } = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, args: unknown) => unknown>()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, args: unknown) => unknown) => {
      handlers.set(channel, handler)
    }
  }
}))

import { registerRuntimeUploadCancelHandlers } from './runtime-upload-cancel-ipc'
import {
  forgetRuntimeUploadCancellation,
  isUploadCancelled,
  scopeRuntimeUploadId
} from './runtime-upload-cancellation'

registerRuntimeUploadCancelHandlers()

const windowOne = { sender: { id: 1 } }

function closableWindow(id: number) {
  const listeners: (() => void)[] = []
  return {
    sender: { id, once: (_event: string, listener: () => void) => listeners.push(listener) },
    close: () => listeners.forEach((listener) => listener())
  }
}

afterEach(() => {
  forgetRuntimeUploadCancellation(scopeRuntimeUploadId(1, 'u'))
})

describe('runtime upload cancel IPC', () => {
  it('records a cancel only for the window that sent it', () => {
    handlers.get('fs:cancelRuntimeUpload')!(windowOne, { uploadId: 'u' })
    expect(isUploadCancelled(scopeRuntimeUploadId(1, 'u'))).toBe(true)
    expect(isUploadCancelled(scopeRuntimeUploadId(2, 'u'))).toBe(false)
    expect(isUploadCancelled('u')).toBe(false)
  })

  it('releases the same window-scoped id', () => {
    handlers.get('fs:cancelRuntimeUpload')!(windowOne, { uploadId: 'u' })
    handlers.get('fs:releaseRuntimeUpload')!(windowOne, { uploadId: 'u' })
    expect(isUploadCancelled(scopeRuntimeUploadId(1, 'u'))).toBe(false)
  })

  it('ignores malformed requests instead of throwing', () => {
    for (const args of [null, undefined, {}, { uploadId: '' }, { uploadId: 3 }]) {
      expect(() => handlers.get('fs:cancelRuntimeUpload')!(windowOne, args)).not.toThrow()
      expect(() => handlers.get('fs:releaseRuntimeUpload')!(windowOne, args)).not.toThrow()
    }
  })

  it("drops a closed window's remembered cancels, since it can never release them", () => {
    const window = closableWindow(3)
    handlers.get('fs:cancelRuntimeUpload')!(window, { uploadId: 'u' })
    expect(isUploadCancelled(scopeRuntimeUploadId(3, 'u'))).toBe(true)

    window.close()

    expect(isUploadCancelled(scopeRuntimeUploadId(3, 'u'))).toBe(false)
  })
})
