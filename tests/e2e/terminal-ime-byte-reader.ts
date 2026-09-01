import { randomUUID } from 'node:crypto'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { Page } from '@stablyai/playwright-test'
import { expect } from '@stablyai/playwright-test'
import { getTerminalContent, sendToTerminal, waitForTerminalOutput } from './helpers/terminal'

export type TerminalImeByteReader = {
  expectedLineCount: number
  readyMarker: string
  resultPrefix: string
  scriptPath: string
  outputPath: string
}

export function createTerminalImeByteReader(
  testRepoPath: string,
  expectedLineCount: number
): TerminalImeByteReader {
  const runId = randomUUID().replaceAll('-', '')
  const readyMarker = `ORCA_IME_READER_READY_${runId}`
  const resultPrefix = `ORCA_IME_BYTES_${runId}`
  const scriptPath = path.join(testRepoPath, `.orca-ime-byte-reader-${runId}.cjs`)
  const outputPath = path.join(testRepoPath, `.orca-ime-byte-reader-${runId}.log`)
  const source = `
const expectedLineCount = ${expectedLineCount}
const readyMarker = ${JSON.stringify(readyMarker)}
const resultPrefix = ${JSON.stringify(resultPrefix)}
const outputPath = ${JSON.stringify(outputPath)}
const fs = require('node:fs')
let pending = Buffer.alloc(0)
let receivedLineCount = 0

const emit = (line) => {
  fs.appendFileSync(outputPath, line + '\\n')
  process.stdout.write(line + '\\n')
}

fs.writeFileSync(outputPath, '')
emit(readyMarker)
process.stdin.on('data', (chunk) => {
  pending = Buffer.concat([pending, Buffer.from(chunk)])
  let newlineIndex = pending.indexOf(0x0a)
  while (newlineIndex >= 0) {
    // Why: a Unix pty's line discipline turns the terminal's CR into a bare LF, but Windows
    // ConPTY hands the reader CRLF. Drop the CR so a recorded line-feed expectation holds on
    // every substrate; the IME payload bytes ahead of it are compared unchanged.
    const rawLine = pending.subarray(0, newlineIndex + 1)
    const hasCarriageReturn = rawLine.length > 1 && rawLine[rawLine.length - 2] === 0x0d
    const line = hasCarriageReturn
      ? Buffer.concat([rawLine.subarray(0, rawLine.length - 2), Buffer.from([0x0a])])
      : rawLine
    pending = pending.subarray(newlineIndex + 1)
    receivedLineCount += 1
    emit(resultPrefix + ':' + receivedLineCount + ':' + line.toString('hex'))
    if (receivedLineCount === expectedLineCount) {
      process.exit(0)
    }
    newlineIndex = pending.indexOf(0x0a)
  }
})
`
  writeFileSync(scriptPath, source)
  return { expectedLineCount, readyMarker, resultPrefix, scriptPath, outputPath }
}

export async function startTerminalImeByteReader(
  page: Page,
  ptyId: string,
  reader: TerminalImeByteReader
): Promise<void> {
  await sendToTerminal(page, ptyId, `node ${JSON.stringify(reader.scriptPath)}\r`)
  await expect
    .poll(() => readFileSafely(reader.outputPath), { timeout: 10_000 })
    .toContain(reader.readyMarker)
  await waitForTerminalOutput(page, reader.readyMarker, 1_000, 20_000).catch(() => undefined)
}

export async function waitForTerminalImeBytes(
  page: Page,
  reader: TerminalImeByteReader,
  timeoutMs = 15_000
): Promise<string[]> {
  let results: string[] = []
  await expect
    .poll(
      async () => {
        results = readTerminalImeByteResults(readFileSafely(reader.outputPath), reader.resultPrefix)
        if (results.length < reader.expectedLineCount) {
          const terminal = await getTerminalContent(page, 100_000)
          results = readTerminalImeByteResults(terminal, reader.resultPrefix)
        }
        return results.length
      },
      { timeout: timeoutMs, message: 'IME byte reader did not receive every expected line' }
    )
    .toBe(reader.expectedLineCount)
  return results
}

export function removeTerminalImeByteReader(reader: TerminalImeByteReader): void {
  rmSync(reader.scriptPath, { force: true })
  rmSync(reader.outputPath, { force: true })
}

function readFileSafely(filePath: string): string {
  try {
    return readFileSync(filePath, 'utf8')
  } catch {
    return ''
  }
}

function readTerminalImeByteResults(source: string, resultPrefix: string): string[] {
  const resultPattern = new RegExp(`${resultPrefix}:(\\d+):([0-9a-f]+)`, 'g')
  const bySequence = new Map<number, string>()
  for (const match of source.matchAll(resultPattern)) {
    bySequence.set(Number(match[1]), match[2])
  }
  return [...bySequence.entries()].sort(([left], [right]) => left - right).map(([, hex]) => hex)
}
