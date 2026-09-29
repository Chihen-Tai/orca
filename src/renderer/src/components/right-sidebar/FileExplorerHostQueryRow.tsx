import React from 'react'
import { translate } from '@/i18n/i18n'
import type { RightSidebarExplorerView } from '../../../../shared/ui-chrome-types'
import { FileExplorerNameFilter } from './FileExplorerNameFilter'
import type { FileExplorerHostMode } from './use-file-explorer-host-mode'

/** Host mode filters only the listed folder; Contents search stays scoped to Project mode. */
export function FileExplorerHostQueryRow({
  view,
  hostMode
}: {
  view: RightSidebarExplorerView
  hostMode: Pick<FileExplorerHostMode, 'filterQuery' | 'setFilterQuery'>
}): React.JSX.Element {
  const { filterQuery: query, setFilterQuery: onQueryChange } = hostMode
  if (view === 'search') {
    return (
      <p className="flex min-h-7 items-center text-[11px] text-muted-foreground">
        {translate(
          'fileExplorer.host.contentsUnavailable',
          'Contents search covers the workspace. Return to the workspace root to use it.'
        )}
      </p>
    )
  }
  return (
    <FileExplorerNameFilter
      query={query}
      scopeLabel={translate('fileExplorer.host.thisFolder', 'this folder')}
      onQueryChange={onQueryChange}
      onClear={() => onQueryChange('')}
    />
  )
}
