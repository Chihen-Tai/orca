import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as AgentStatusModule from '@/lib/agent-status'
import { buildWorkspaceSessionPayload, SESSION_RELEVANT_FIELDS } from '../../lib/workspace-session'
import { buildWorkspaceSessionPatch } from '../../lib/workspace-session-patch'
import { createStoreSessionMockApi } from './store-session-test-harness'
import { createTestStore, makeWorktree } from './store-test-helpers'

vi.mock('sonner', () => ({ toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/agent-status', async (importOriginal) => {
  const actual = await importOriginal<typeof AgentStatusModule>()
  return { ...actual, detectAgentStatusFromTitle: vi.fn().mockReturnValue(null) }
})

createStoreSessionMockApi()

const WORKTREE_ID = 'repo-1::/workspace'
const WORKSPACE_FILE = '/workspace/src/a.ts'
const HOST_FILE = '/home/allen/.bashrc'

function prepareStore() {
  const store = createTestStore()
  store.setState({
    repos: [
      { id: 'repo-1', path: '/workspace', displayName: 'Repo', badgeColor: '#000', addedAt: 0 }
    ],
    worktreesByRepo: {
      'repo-1': [makeWorktree({ id: WORKTREE_ID, repoId: 'repo-1', path: '/workspace' })]
    },
    activeWorktreeId: WORKTREE_ID
  })
  return store
}

function openWorkspaceAndHostFiles(store: ReturnType<typeof prepareStore>): void {
  store.getState().openFile(
    {
      filePath: WORKSPACE_FILE,
      relativePath: 'src/a.ts',
      worktreeId: WORKTREE_ID,
      language: 'typescript',
      mode: 'edit',
      runtimeEnvironmentId: null
    },
    { preview: false, suppressActiveRuntimeFallback: true }
  )
  store.getState().openFile(
    {
      filePath: HOST_FILE,
      relativePath: HOST_FILE,
      worktreeId: WORKTREE_ID,
      language: 'shell',
      mode: 'edit',
      readOnly: true,
      hostBrowse: true,
      runtimeEnvironmentId: null
    },
    { preview: false, forceContentReload: true, suppressActiveRuntimeFallback: true }
  )
}

describe('Explorer Host mode tabs across restart', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('drops the Host tab chrome with its file and keeps group references valid', () => {
    const store = prepareStore()
    openWorkspaceAndHostFiles(store)
    const hostTab = store
      .getState()
      .unifiedTabsByWorktree[WORKTREE_ID]?.find(
        (tab) => tab.contentType === 'editor' && tab.entityId === HOST_FILE
      )
    expect(hostTab).toBeDefined()
    expect(store.getState().activeFileIdByWorktree[WORKTREE_ID]).toBe(hostTab?.entityId)

    const persisted = buildWorkspaceSessionPayload(store.getState())
    const restarted = prepareStore()
    restarted.getState().hydrateTabsSession(persisted)
    restarted.getState().hydrateEditorSession(persisted)
    const state = restarted.getState()

    const tabs = state.unifiedTabsByWorktree[WORKTREE_ID] ?? []
    expect(tabs.some((tab) => tab.entityId === hostTab?.entityId)).toBe(false)
    expect(tabs.map((tab) => tab.entityId)).toEqual([WORKSPACE_FILE])
    expect(state.openFiles.map((file) => file.filePath)).toEqual([WORKSPACE_FILE])
    const tabIds = new Set(tabs.map((tab) => tab.id))
    for (const group of state.groupsByWorktree[WORKTREE_ID] ?? []) {
      expect(group.activeTabId === null || tabIds.has(group.activeTabId)).toBe(true)
      expect(group.tabOrder.every((tabId) => tabIds.has(tabId))).toBe(true)
    }
    expect(state.activeFileIdByWorktree[WORKTREE_ID]).not.toBe(hostTab?.entityId)
  })

  it('persists the tab again once the file is reopened writable', () => {
    const store = prepareStore()
    openWorkspaceAndHostFiles(store)
    store.getState().openFile({
      filePath: HOST_FILE,
      relativePath: HOST_FILE,
      worktreeId: WORKTREE_ID,
      language: 'shell',
      mode: 'edit',
      runtimeEnvironmentId: null
    })

    const persisted = buildWorkspaceSessionPayload(store.getState())

    expect(persisted.unifiedTabs?.[WORKTREE_ID]?.map((tab) => tab.entityId)).toContain(HOST_FILE)
    expect(persisted.openFilesByWorktree?.[WORKTREE_ID]?.map((file) => file.filePath)).toContain(
      HOST_FILE
    )
  })

  it('rewrites the tab chrome when a Host tab is reopened writable', () => {
    const store = prepareStore()
    openWorkspaceAndHostFiles(store)
    const before = store.getState()

    store.getState().openFile({
      filePath: HOST_FILE,
      relativePath: HOST_FILE,
      worktreeId: WORKTREE_ID,
      language: 'shell',
      mode: 'edit',
      runtimeEnvironmentId: null
    })
    const after = store.getState()
    // Why: mirror the session writer, which patches only the fields whose references changed.
    const changed = SESSION_RELEVANT_FIELDS.filter((field) => before[field] !== after[field])
    const patch = buildWorkspaceSessionPatch(after, changed)

    expect(patch.unifiedTabs?.[WORKTREE_ID]?.map((tab) => tab.entityId)).toEqual([
      WORKSPACE_FILE,
      HOST_FILE
    ])
  })
})
