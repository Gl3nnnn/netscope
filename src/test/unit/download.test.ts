import { afterEach, describe, expect, it, vi } from 'vitest'
import { downloadText, fileDateStamp } from '@/lib/download'

describe('fileDateStamp', () => {
  it('formats a timestamp as YYYY-MM-DD', () => {
    expect(fileDateStamp(Date.UTC(2026, 0, 5))).toBe('2026-01-05')
  })
})

describe('downloadText', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('creates an object URL, clicks a link and revokes the URL', () => {
    const createObjectURL = vi.fn(() => 'blob:mock')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal(
      'URL',
      Object.assign(URL, { createObjectURL, revokeObjectURL }),
    )
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {})

    downloadText('export.json', '{}', 'application/json')

    expect(createObjectURL).toHaveBeenCalledOnce()
    expect(click).toHaveBeenCalledOnce()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock')
  })
})
