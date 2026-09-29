import React, { createContext, useContext } from 'react'
import { cn } from '@/lib/utils'
import { FileExplorerHostBar } from './FileExplorerHostBar'
import { FileExplorerHostList } from './FileExplorerHostList'
import { FileExplorerToolbar } from './FileExplorerToolbar'
import { useFileExplorerHostMode, type FileExplorerHostMode } from './use-file-explorer-host-mode'

const HostModeContext = createContext<FileExplorerHostMode | null>(null)

/**
 * Owns Host-mode state below FileExplorerFiles so toggling re-renders only its subscribers;
 * `children` are elements from the parent render, so the tree bails out untouched.
 */
export function FileExplorerHostModeProvider({
  activeWorktreeId,
  worktreePath,
  children
}: {
  activeWorktreeId: string | null
  worktreePath: string | null
  children: React.ReactNode
}): React.JSX.Element {
  const hostMode = useFileExplorerHostMode({ activeWorktreeId, worktreePath })
  return <HostModeContext.Provider value={hostMode}>{children}</HostModeContext.Provider>
}

export function useFileExplorerHostModeContext(): FileExplorerHostMode {
  const hostMode = useContext(HostModeContext)
  if (!hostMode) {
    throw new Error('FileExplorerHostModeProvider is missing')
  }
  return hostMode
}

export function FileExplorerHostAwareToolbar(
  props: Omit<React.ComponentProps<typeof FileExplorerToolbar>, 'hostMode'>
): React.JSX.Element {
  const hostMode = useFileExplorerHostModeContext()
  return (
    <FileExplorerToolbar
      {...props}
      canRefresh={props.canRefresh && !hostMode.active}
      canCollapseAll={props.canCollapseAll && !hostMode.active}
      hostMode={hostMode.toolbar}
    />
  )
}

/** Hides Project-only chrome in Host mode without unmounting it. */
export function FileExplorerProjectOnly({
  children
}: {
  children: React.ReactNode
}): React.JSX.Element {
  const { active } = useFileExplorerHostModeContext()
  return <div className={cn(active ? 'hidden' : 'contents')}>{children}</div>
}

export function FileExplorerHostInertBoundary({
  children
}: {
  children: React.ReactNode
}): React.JSX.Element {
  const { active } = useFileExplorerHostModeContext()
  return (
    <div className="h-full min-h-0" inert={active}>
      {children}
    </div>
  )
}

/** Layered over the tree so entering Host mode never shifts the surrounding layout. */
export function FileExplorerHostOverlay({
  showDotfiles
}: {
  showDotfiles: boolean
}): React.JSX.Element | null {
  const hostMode = useFileExplorerHostModeContext()
  if (!hostMode.active) {
    return null
  }
  return (
    <div className="absolute inset-0 z-10 flex min-h-0 flex-col bg-background">
      <div className="flex min-h-0 flex-1 flex-col animate-in fade-in-0 duration-150 ease-out motion-reduce:animate-none">
        <FileExplorerHostBar hostMode={hostMode} />
        <FileExplorerHostList hostMode={hostMode} showDotfiles={showDotfiles} />
      </div>
    </div>
  )
}
