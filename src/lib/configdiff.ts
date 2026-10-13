/**
 * Minimal, dependency-free line diff (LCS based) for config comparison.
 *
 * Configs are small enough that an O(n·m) LCS table is perfectly fine, and
 * keeping it in-house avoids pulling a diff library into the bundle. Pure and
 * unit-tested.
 */

export type DiffType = 'equal' | 'add' | 'remove'

export interface DiffLine {
  type: DiffType
  text: string
}

export interface DiffSummary {
  added: number
  removed: number
  unchanged: number
  changed: boolean
}

function splitLines(text: string): string[] {
  if (text === '') return []
  return text.replace(/\r\n/g, '\n').split('\n')
}

/** Full line diff of `before` → `after`, in order. */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = splitLines(before)
  const b = splitLines(after)
  const n = a.length
  const m = b.length

  const table: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  )
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i][j] =
        a[i] === b[j]
          ? table[i + 1][j + 1] + 1
          : Math.max(table[i + 1][j], table[i][j + 1])
    }
  }

  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: 'equal', text: a[i] })
      i += 1
      j += 1
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      out.push({ type: 'remove', text: a[i] })
      i += 1
    } else {
      out.push({ type: 'add', text: b[j] })
      j += 1
    }
  }
  while (i < n) out.push({ type: 'remove', text: a[i++] })
  while (j < m) out.push({ type: 'add', text: b[j++] })
  return out
}

export function summarizeDiff(diff: DiffLine[]): DiffSummary {
  let added = 0
  let removed = 0
  let unchanged = 0
  for (const line of diff) {
    if (line.type === 'add') added += 1
    else if (line.type === 'remove') removed += 1
    else unchanged += 1
  }
  return { added, removed, unchanged, changed: added > 0 || removed > 0 }
}

/**
 * Condense a diff by collapsing runs of unchanged lines longer than
 * `2 * context + 1` into a single marker paired with the number of hidden lines.
 */
export interface UnifiedLine extends DiffLine {
  /** Number of equal lines omitted before this line (0 when none). */
  skipped?: number
}

export function unifiedDiff(
  before: string,
  after: string,
  context = 2,
): UnifiedLine[] {
  const diff = diffLines(before, after)
  const out: UnifiedLine[] = []
  let run: number[] = []

  const flush = () => {
    if (run.length === 0) return
    if (run.length > context * 2 + 1) {
      const head = run.slice(0, context)
      const tail = run.slice(-context)
      for (const index of head) out.push(diff[index])
      out.push({
        type: 'equal',
        text: '',
        skipped: run.length - head.length - tail.length,
      })
      for (const index of tail) out.push(diff[index])
    } else {
      for (const index of run) out.push(diff[index])
    }
    run = []
  }

  diff.forEach((line, index) => {
    if (line.type === 'equal') {
      run.push(index)
    } else {
      flush()
      out.push(line)
    }
  })
  flush()
  return out
}
