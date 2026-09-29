// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DirEntry } from '../../../../shared/filesystem-entry-types'
import { FileExplorerHostList, HOST_LIST_RENDER_LIMIT } from './FileExplorerHostList'
import { shouldIgnoreFileExplorerKeyTarget } from './useFileExplorerKeys'
import type { FileExplorerHostMode } from './use-file-explorer-host-mode'

let root: Root
let container: HTMLDivElement

function hostMode(entries: DirEntry[], overrides: Partial<FileExplorerHostMode['browser']> = {}) {
  const browser = {
    listing: { resolvedPath: '/home/allen', entries, pathFlavor: 'posix' as const },
    loading: false,
    error: null,
    canNavigateUp: true,
    navigate: vi.fn(),
    navigateUp: vi.fn(),
    refresh: vi.fn(),
    activateEntry: vi.fn(),
    ...overrides
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the list reads only `browser` and `filterQuery`.
  return { browser, filterQuery: '' } as unknown as FileExplorerHostMode
}

async function render(mode: FileExplorerHostMode, showDotfiles = true): Promise<void> {
  await act(async () => {
    root.render(<FileExplorerHostList hostMode={mode} showDotfiles={showDotfiles} />)
  })
}

function rowLabels(): string[] {
  return [...container.querySelectorAll('button')].map((button) => button.textContent ?? '')
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  document.body.replaceChildren()
})

const codes = { name: 'codes', isDirectory: true, isSymlink: false }
const documents = { name: 'Documents', isDirectory: true, isSymlink: false }
const bashrc = { name: '.bashrc', isDirectory: false, isSymlink: false }

describe('FileExplorerHostList', () => {
  it('lists a Parent row above sibling folders and activates entries', async () => {
    const mode = hostMode([codes, documents, bashrc])
    await render(mode)

    expect(rowLabels()).toEqual(['Parent directory', 'codes', 'Documents', '.bashrc'])
    act(() => container.querySelectorAll('button')[0]?.click())
    act(() => container.querySelectorAll('button')[2]?.click())
    expect(mode.browser.navigateUp).toHaveBeenCalledTimes(1)
    expect(mode.browser.activateEntry).toHaveBeenCalledWith(documents)
  })

  it('omits the Parent row at a filesystem root and hides dotfiles when asked', async () => {
    await render(hostMode([codes, bashrc], { canNavigateUp: false }), false)

    expect(rowLabels()).toEqual(['codes'])
  })

  it('keeps tree shortcuts from acting on the hidden tree selection', async () => {
    await render(hostMode([codes]))

    const row = container.querySelectorAll('button')[1]
    expect(shouldIgnoreFileExplorerKeyTarget(row ?? null)).toBe(true)
  })

  it('caps very large folders and says how to narrow them', async () => {
    const many = Array.from({ length: HOST_LIST_RENDER_LIMIT + 5 }, (_, index) => ({
      name: `f${index}`,
      isDirectory: false,
      isSymlink: false
    }))
    await render(hostMode(many))

    expect(container.querySelectorAll('button')).toHaveLength(HOST_LIST_RENDER_LIMIT + 1)
    expect(container.textContent).toContain(
      `Showing ${HOST_LIST_RENDER_LIMIT} of ${HOST_LIST_RENDER_LIMIT + 5} items`
    )
  })
})
