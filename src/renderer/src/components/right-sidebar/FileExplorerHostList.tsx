import React from 'react'
import { CornerLeftUp, Folder, Link } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { getFileTypeIcon } from '@/lib/file-type-icons'
import type { DirEntry } from '../../../../shared/filesystem-entry-types'
import { FileExplorerTreeStatus } from './FileExplorerTreeStatus'
import { filterHostEntries } from './file-explorer-host-mode'
import type { FileExplorerHostMode } from './use-file-explorer-host-mode'

// Why: Host folders like /usr/lib can hold tens of thousands of entries; the filter narrows past this.
export const HOST_LIST_RENDER_LIMIT = 2000

const ROW_CLASS =
  'flex w-full items-center gap-1 rounded-sm px-2 py-1 text-left text-xs transition-colors hover:bg-accent hover:text-foreground'

function HostEntryIcon({ entry }: { entry: DirEntry }): React.JSX.Element {
  if (entry.isDirectory) {
    return <Folder className="size-3 shrink-0 text-muted-foreground" />
  }
  if (entry.isSymlink) {
    return <Link className="size-3 shrink-0 text-muted-foreground" />
  }
  return React.createElement(getFileTypeIcon(entry.name), {
    className: 'size-3 shrink-0 text-muted-foreground'
  })
}

export function FileExplorerHostList({
  hostMode,
  showDotfiles
}: {
  hostMode: FileExplorerHostMode
  showDotfiles: boolean
}): React.JSX.Element {
  const { browser, filterQuery } = hostMode
  const entries = browser.listing
    ? filterHostEntries(browser.listing.entries, filterQuery, showDotfiles)
    : []
  const visibleEntries = entries.slice(0, HOST_LIST_RENDER_LIMIT)
  const status = (
    <FileExplorerTreeStatus
      isLoading={browser.loading && !browser.listing}
      error={browser.error}
      isEmpty={browser.listing !== null && entries.length === 0}
      scopedToFolder
    />
  )
  return (
    <div
      className="absolute inset-0 z-10 flex min-h-0 flex-col overflow-y-auto scrollbar-sleek bg-background px-1 py-1"
      data-file-explorer-host-list=""
      // Why: tree shortcuts (Delete, rename, paste) act on the hidden tree's selection.
      data-ignore-file-explorer-keys="true"
    >
      {browser.canNavigateUp ? (
        <button type="button" className={ROW_CLASS} onClick={browser.navigateUp}>
          <CornerLeftUp className="size-3 shrink-0 text-muted-foreground" />
          <span className="truncate">
            {translate('fileExplorer.host.parentDirectory', 'Parent directory')}
          </span>
        </button>
      ) : null}
      {browser.error !== null || !browser.listing || entries.length === 0 ? (
        <div className="min-h-0 flex-1">{status}</div>
      ) : (
        visibleEntries.map((entry) => (
          <button
            key={entry.name}
            type="button"
            className={ROW_CLASS}
            title={entry.name}
            onClick={() => browser.activateEntry(entry)}
          >
            <HostEntryIcon entry={entry} />
            <span className="truncate">{entry.name}</span>
          </button>
        ))
      )}
      {entries.length > visibleEntries.length ? (
        <div className="px-2 py-1 text-[11px] text-muted-foreground">
          {translate(
            'fileExplorer.host.truncated',
            'Showing {{shown}} of {{total}} items. Filter by name to narrow the list.',
            { shown: visibleEntries.length, total: entries.length }
          )}
        </div>
      ) : null}
    </div>
  )
}
