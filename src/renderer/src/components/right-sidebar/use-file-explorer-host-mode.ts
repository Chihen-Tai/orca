import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import {
  getExecutionHostLabel,
  LOCAL_EXECUTION_HOST_ID,
  toSshExecutionHostId
} from '../../../../shared/execution-host'
import { getFileExplorerOperationOwnerFromState } from './file-explorer-operation-owner'
import { getHostBrowseSource } from './file-explorer-host-mode'
import {
  useFileExplorerHostBrowser,
  type FileExplorerHostBrowser
} from './use-file-explorer-host-browser'

export type FileExplorerHostMode = {
  active: boolean
  hostLabel: string
  filterQuery: string
  setFilterQuery: (query: string) => void
  enter: () => void
  exit: () => void
  browser: FileExplorerHostBrowser
  toolbar: { active: boolean; unavailableLabel: string | null; onToggle: () => void }
}

type HostVisit = { worktreeId: string; entry: number }

/** Host mode is a session-only visit to one workspace; leaving the workspace ends it. */
export function useFileExplorerHostMode({
  activeWorktreeId,
  worktreePath
}: {
  activeWorktreeId: string | null
  worktreePath: string | null
}): FileExplorerHostMode {
  const [visit, setVisit] = useState<HostVisit | null>(null)
  const [filterQuery, setFilterQuery] = useState('')
  // Why: every entry gets a fresh browsing session, so a later visit never reuses an old listing.
  const entryCounterRef = useRef(0)
  const owner = useAppStore(
    useShallow((s) => getFileExplorerOperationOwnerFromState(s, activeWorktreeId))
  )
  const source = useMemo(
    () =>
      getHostBrowseSource(
        owner,
        typeof window.api.fs.browseHostDir === 'function' &&
          typeof window.api.fs.resolveHostBrowseEntry === 'function'
      ),
    [owner]
  )
  // Why: adjust during render (not in an effect) so a stale visit never paints.
  if (visit && visit.worktreeId !== activeWorktreeId) {
    setVisit(null)
    setFilterQuery('')
  }
  const active = visit !== null && visit.worktreeId === activeWorktreeId && source !== null

  const sshTargetLabels = useAppStore((s) => s.sshTargetLabels)
  const hostLabel =
    source?.kind === 'ssh'
      ? (sshTargetLabels.get(source.connectionId) ??
        getExecutionHostLabel(toSshExecutionHostId(source.connectionId)))
      : getExecutionHostLabel(LOCAL_EXECUTION_HOST_ID)

  const browser = useFileExplorerHostBrowser({
    visitKey: active ? `${visit.entry}` : null,
    source,
    worktreeId: activeWorktreeId,
    worktreePath
  })

  const enter = useCallback(() => {
    if (source && activeWorktreeId) {
      setFilterQuery('')
      setVisit({ worktreeId: activeWorktreeId, entry: ++entryCounterRef.current })
    }
  }, [activeWorktreeId, source])
  const exit = useCallback(() => {
    setVisit(null)
    setFilterQuery('')
  }, [])

  // Why: a workspace Contents search (seed or focus request) must be visible, not run behind the Host overlay.
  useEffect(() => {
    if (!active || !activeWorktreeId) {
      return
    }
    return useAppStore.subscribe((state, prev) => {
      const next = state.fileSearchStateByWorktree[activeWorktreeId]
      const before = prev.fileSearchStateByWorktree[activeWorktreeId]
      if (
        next?.seedRequestId !== before?.seedRequestId ||
        next?.focusRequestId !== before?.focusRequestId
      ) {
        exit()
      }
    })
  }, [active, activeWorktreeId, exit])

  const toolbar = useMemo(
    () => ({
      active,
      unavailableLabel: source
        ? null
        : translate(
            'fileExplorer.host.unavailable',
            'Host browsing is not available for this workspace'
          ),
      onToggle: active ? exit : enter
    }),
    [active, source, enter, exit]
  )

  return useMemo(
    () => ({ active, hostLabel, filterQuery, setFilterQuery, enter, exit, browser, toolbar }),
    [active, hostLabel, filterQuery, enter, exit, browser, toolbar]
  )
}
