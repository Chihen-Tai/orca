import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { detectLanguage } from '@/lib/language-detect'
import { useAppStore } from '@/store'
import type { HostBrowseSource, HostFileOpenPlan } from './file-explorer-host-mode'

export function openHostFile({
  plan,
  source,
  worktreeId
}: {
  plan: HostFileOpenPlan
  source: HostBrowseSource
  worktreeId: string
}): void {
  const { openFile } = useAppStore.getState()
  if (plan.kind === 'unsupported') {
    toast.error(
      translate(
        'fileExplorer.host.runtimeFileOutsideWorkspace',
        'Files outside the workspace cannot be opened on this remote server yet.'
      )
    )
    return
  }
  if (plan.kind === 'workspace') {
    const runtimeEnvironmentId = source.kind === 'runtime' ? source.environmentId : null
    openFile(
      {
        filePath: plan.filePath,
        relativePath: plan.relativePath,
        worktreeId,
        runtimeEnvironmentId: runtimeEnvironmentId ?? undefined,
        language: detectLanguage(plan.filePath),
        mode: 'edit'
      },
      {
        preview: true,
        focusEditor: true,
        suppressActiveRuntimeFallback: runtimeEnvironmentId === null
      }
    )
    return
  }
  openFile(
    {
      filePath: plan.filePath,
      // Why: relativePath === filePath is the external-file contract the editor reads by.
      relativePath: plan.filePath,
      worktreeId,
      runtimeEnvironmentId: null,
      language: detectLanguage(plan.filePath),
      mode: 'edit',
      readOnly: true,
      hostBrowse: true,
      ...(source.kind === 'ssh' ? { externalSshTargetId: source.connectionId } : {})
    },
    {
      preview: true,
      focusEditor: true,
      forceContentReload: true,
      suppressActiveRuntimeFallback: true
    }
  )
}
