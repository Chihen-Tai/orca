import { useCallback, useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import {
  getExecutionHostLabel,
  LOCAL_EXECUTION_HOST_ID,
  toRuntimeExecutionHostId,
  toSshExecutionHostId
} from '../../../../shared/execution-host'
import { getFileExplorerOperationOwnerFromState } from './file-explorer-operation-owner'
import { getHostBrowseAvailability, type HostBrowseAvailability } from './file-explorer-host-mode'
import {
  useFileExplorerHostBrowser,
  type FileExplorerHostBrowser
} from './use-file-explorer-host-browser'

export type FileExplorerHostMode = {
  active: boolean
  availability: HostBrowseAvailability
  hostLabel: string
  filterQuery: string
  setFilterQuery: (query: string) => void
  enter: () => void
  exit: () => void
  browser: FileExplorerHostBrowser
  toolbar: { active: boolean; unavailableLabel: string | null; onToggle: () => void }
}

/** Host mode is session-only and follows one workspace; restarting Orca returns to Project. */
export function useFileExplorerHostMode({
  activeWorktreeId,
  worktreePath
}: {
  activeWorktreeId: string | null
  worktreePath: string | null
}): FileExplorerHostMode {
  const [hostWorktreeId, setHostWorktreeId] = useState<string | null>(null)
  const [filterQuery, setFilterQuery] = useState('')
  const owner = useAppStore(
    useShallow((s) => getFileExplorerOperationOwnerFromState(s, activeWorktreeId))
  )
  const availability = useMemo(
    () => getHostBrowseAvailability(owner, typeof window.api.fs.browseHostDir === 'function'),
    [owner]
  )
  const source = availability.available ? availability.source : null
  const active =
    availability.available && activeWorktreeId !== null && hostWorktreeId === activeWorktreeId

  const sshTargetLabels = useAppStore((s) => s.sshTargetLabels)
  const runtimeEnvironments = useAppStore((s) => s.runtimeEnvironments)
  const hostLabel = useMemo(() => {
    if (source?.kind === 'ssh') {
      return (
        sshTargetLabels.get(source.connectionId) ??
        getExecutionHostLabel(toSshExecutionHostId(source.connectionId))
      )
    }
    if (source?.kind === 'runtime') {
      return (
        runtimeEnvironments.find((entry) => entry.id === source.environmentId)?.name ??
        getExecutionHostLabel(toRuntimeExecutionHostId(source.environmentId))
      )
    }
    return getExecutionHostLabel(LOCAL_EXECUTION_HOST_ID)
  }, [runtimeEnvironments, source, sshTargetLabels])

  const browser = useFileExplorerHostBrowser({
    active,
    source,
    worktreeId: activeWorktreeId,
    worktreePath
  })
  const resetBrowser = browser.reset

  const enter = useCallback(() => {
    if (availability.available && activeWorktreeId) {
      resetBrowser()
      setFilterQuery('')
      setHostWorktreeId(activeWorktreeId)
    }
  }, [activeWorktreeId, availability.available, resetBrowser])
  const exit = useCallback(() => {
    setHostWorktreeId(null)
    setFilterQuery('')
  }, [])

  const toolbar = useMemo(
    () => ({
      active,
      unavailableLabel: getHostModeUnavailableLabel(availability),
      onToggle: active ? exit : enter
    }),
    [active, availability, enter, exit]
  )

  return useMemo(
    () => ({
      active,
      availability,
      hostLabel,
      filterQuery,
      setFilterQuery,
      enter,
      exit,
      browser,
      toolbar
    }),
    [active, availability, hostLabel, filterQuery, enter, exit, browser, toolbar]
  )
}

export function getHostModeUnavailableLabel(availability: HostBrowseAvailability): string | null {
  if (availability.available) {
    return null
  }
  switch (availability.reason) {
    case 'runtime-remote-host':
      return translate(
        'fileExplorer.host.unavailableRuntimeRemote',
        'Host browsing is not available for workspaces this server reaches over SSH'
      )
    case 'unsupported-client':
      return translate(
        'fileExplorer.host.unavailableClient',
        'Host browsing is not available in this client'
      )
    case 'unresolved':
      return translate(
        'fileExplorer.host.unavailableUnresolved',
        'Host browsing is available once the workspace host is known'
      )
  }
}
