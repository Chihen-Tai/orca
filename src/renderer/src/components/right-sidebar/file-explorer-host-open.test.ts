import { beforeEach, describe, expect, it, vi } from 'vitest'

const { toastErrorMock, openFileMock } = vi.hoisted(() => ({
  toastErrorMock: vi.fn(),
  openFileMock: vi.fn()
}))

vi.mock('sonner', () => ({ toast: { error: toastErrorMock } }))
vi.mock('@/store', () => ({ useAppStore: { getState: () => ({ openFile: openFileMock }) } }))
vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string) => fallback
}))

import { openHostFile } from './file-explorer-host-open'

beforeEach(() => {
  toastErrorMock.mockReset()
  openFileMock.mockReset()
})

describe('openHostFile', () => {
  it('opens files outside the workspace read-only and marks them session-only', () => {
    openHostFile({
      plan: { kind: 'external', filePath: '/home/allen/.bashrc' },
      source: { kind: 'local' },
      worktreeId: 'wt-1'
    })

    const [file, options] = openFileMock.mock.calls[0] ?? []
    expect(file).toEqual(
      expect.objectContaining({
        filePath: '/home/allen/.bashrc',
        relativePath: '/home/allen/.bashrc',
        worktreeId: 'wt-1',
        mode: 'edit',
        readOnly: true,
        hostBrowse: true,
        runtimeEnvironmentId: null
      })
    )
    expect(file).not.toHaveProperty('liveTail')
    expect(file).not.toHaveProperty('externalSshTargetId')
    expect(options).toEqual(expect.objectContaining({ suppressActiveRuntimeFallback: true }))
  })

  it('binds external SSH files to the workspace SSH target', () => {
    openHostFile({
      plan: { kind: 'external', filePath: '/Data2/allen921103/notes.md' },
      source: { kind: 'ssh', connectionId: 'ssh-1' },
      worktreeId: 'wt-1'
    })

    expect(openFileMock.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ readOnly: true, hostBrowse: true, externalSshTargetId: 'ssh-1' })
    )
  })

  it('opens workspace files through the normal writable Explorer path', () => {
    openHostFile({
      plan: {
        kind: 'workspace',
        filePath: '/home/allen/codes/src/a.ts',
        relativePath: 'src/a.ts'
      },
      source: { kind: 'runtime', environmentId: 'env-1' },
      worktreeId: 'wt-1'
    })

    const [file, options] = openFileMock.mock.calls[0] ?? []
    expect(file).toEqual(
      expect.objectContaining({ relativePath: 'src/a.ts', runtimeEnvironmentId: 'env-1' })
    )
    expect(file).not.toHaveProperty('readOnly')
    expect(file).not.toHaveProperty('hostBrowse')
    expect(options).toEqual(expect.objectContaining({ suppressActiveRuntimeFallback: false }))
  })

  it('explains instead of opening runtime files outside the workspace', () => {
    openHostFile({
      plan: { kind: 'unsupported' },
      source: { kind: 'runtime', environmentId: 'env-1' },
      worktreeId: 'wt-1'
    })

    expect(openFileMock).not.toHaveBeenCalled()
    expect(toastErrorMock).toHaveBeenCalledTimes(1)
  })
})
