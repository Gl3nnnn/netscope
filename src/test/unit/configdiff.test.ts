import { describe, expect, it } from 'vitest'
import { diffLines, summarizeDiff, unifiedDiff } from '@/lib/configdiff'

describe('diffLines', () => {
  it('marks identical input as all equal', () => {
    const diff = diffLines('a\nb\nc', 'a\nb\nc')
    expect(diff.every((line) => line.type === 'equal')).toBe(true)
    expect(summarizeDiff(diff).changed).toBe(false)
  })

  it('detects additions and removals', () => {
    const diff = diffLines('a\nb\nc', 'a\nc\nd')
    const summary = summarizeDiff(diff)
    expect(summary.removed).toBe(1)
    expect(summary.added).toBe(1)
    expect(summary.changed).toBe(true)
    expect(diff.map((line) => `${line.type[0]}:${line.text}`)).toEqual([
      'e:a',
      'r:b',
      'e:c',
      'a:d',
    ])
  })

  it('handles empty inputs', () => {
    expect(diffLines('', '')).toEqual([])
    const added = diffLines('', 'x\ny')
    expect(added.every((line) => line.type === 'add')).toBe(true)
  })

  it('normalises CRLF line endings', () => {
    expect(summarizeDiff(diffLines('a\r\nb', 'a\nb')).changed).toBe(false)
  })
})

describe('summarizeDiff', () => {
  it('counts each line type', () => {
    const summary = summarizeDiff(diffLines('a\nb', 'a\nc'))
    expect(summary).toEqual({
      added: 1,
      removed: 1,
      unchanged: 1,
      changed: true,
    })
  })
})

describe('unifiedDiff', () => {
  it('collapses long runs of unchanged lines', () => {
    const before = Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n')
    const after = before.replace('line 10', 'line 10 changed')
    const unified = unifiedDiff(before, after, 2)
    expect(unified.some((line) => (line.skipped ?? 0) > 0)).toBe(true)
    expect(
      unified.filter((line) => line.type === 'add' || line.type === 'remove'),
    ).toHaveLength(2)
  })

  it('keeps short runs intact', () => {
    const unified = unifiedDiff('a\nb\nc', 'a\nb\nc', 2)
    expect(unified.every((line) => !line.skipped)).toBe(true)
  })
})
