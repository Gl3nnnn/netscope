/** Small, dependency-free id generator that is safe in all browsers. */
export function createId(prefix = 'id'): string {
  const rand = Math.random().toString(36).slice(2, 10)
  const time = Date.now().toString(36)
  return `${prefix}_${time}${rand}`
}

/** Deterministic id generator for seeded/demo data. */
export function seededId(prefix: string, n: number): string {
  return `${prefix}_${n.toString(36).padStart(3, '0')}`
}
