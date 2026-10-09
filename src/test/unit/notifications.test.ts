import { beforeEach, describe, expect, it } from 'vitest'
import { useNotificationsStore } from '@/store/useNotificationsStore'

describe('useNotificationsStore', () => {
  beforeEach(() => {
    useNotificationsStore.getState().clearRead()
  })

  it('marks incidents read without duplicating', () => {
    const { markRead } = useNotificationsStore.getState()
    markRead('a')
    markRead('b')
    markRead('a')
    expect(useNotificationsStore.getState().readIds).toEqual(['b', 'a'])
  })

  it('merges many read ids', () => {
    const { markRead, markManyRead } = useNotificationsStore.getState()
    markRead('a')
    markManyRead(['b', 'c', 'a'])
    expect(new Set(useNotificationsStore.getState().readIds)).toEqual(
      new Set(['a', 'b', 'c']),
    )
  })

  it('clears read ids', () => {
    const { markRead, clearRead } = useNotificationsStore.getState()
    markRead('a')
    clearRead()
    expect(useNotificationsStore.getState().readIds).toEqual([])
  })

  it('caps the number of stored read ids', () => {
    useNotificationsStore
      .getState()
      .markManyRead(Array.from({ length: 600 }, (_, index) => `id-${index}`))
    expect(useNotificationsStore.getState().readIds).toHaveLength(500)
  })
})
