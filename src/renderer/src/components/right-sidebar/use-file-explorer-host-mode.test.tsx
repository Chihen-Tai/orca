// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createStore, type StoreApi } from 'zustand/vanilla'
import { useStore } from 'zustand'
import { useFileExplorerHostMode, type FileExplorerHostMode } from './use-file-explorer-host-mode'

type FakeState = {
  sshTargetLabels: Map<string, string>
  runtimeEnvironments: { id: string; name: string }[]
  fileSearchStateByWorktree: Record<string, { seedRequestId?: number; focusRequestId?: number }>
}

let mockStore: StoreApi<FakeState>

vi.mock('@/store', () => {
  const api = () => mockStore
  const useAppStore = <T,>(selector: (state: FakeState) => T): T => useStore(api(), selector)
  useAppStore.subscribe = (listener: (s: FakeState, p: FakeState) => void) =>
    api().subscribe(listener)
  useAppStore.getState = () => api().getState()
  return { useAppStore }
})
vi.mock('./file-explorer-operation-owner', () => ({
  getFileExplorerOperationOwnerFromState: () => ({ kind: 'local' })
}))
vi.mock('./use-file-explorer-host-browser', () => ({
  useFileExplorerHostBrowser: () => ({ reset: () => {} })
}))

let root: Root
let latest: FileExplorerHostMode

function Harness(): null {
  latest = useFileExplorerHostMode({ activeWorktreeId: 'wt-1', worktreePath: '/repo' })
  return null
}

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  mockStore = createStore<FakeState>(() => ({
    sshTargetLabels: new Map(),
    runtimeEnvironments: [],
    fileSearchStateByWorktree: {}
  }))
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { fs: { browseHostDir: vi.fn() } }
  })
  root = createRoot(document.createElement('div'))
  await act(async () => root.render(<Harness />))
})

afterEach(() => {
  act(() => root.unmount())
})

const api = () => mockStore

describe('useFileExplorerHostMode', () => {
  it('returns to Project mode when a workspace Contents search is requested', async () => {
    await act(async () => latest.enter())
    expect(latest.active).toBe(true)

    await act(async () =>
      api().setState({ fileSearchStateByWorktree: { 'wt-1': { focusRequestId: 1 } } })
    )
    expect(latest.active).toBe(false)

    await act(async () => latest.enter())
    await act(async () =>
      api().setState({
        fileSearchStateByWorktree: { 'wt-1': { focusRequestId: 1, seedRequestId: 3 } }
      })
    )
    expect(latest.active).toBe(false)
  })

  it('ignores search requests for other workspaces', async () => {
    await act(async () => latest.enter())

    await act(async () =>
      api().setState({ fileSearchStateByWorktree: { 'wt-2': { focusRequestId: 1 } } })
    )

    expect(latest.active).toBe(true)
  })
})
