/** Trigger a client-side file download for in-memory text content. */
export function downloadText(
  filename: string,
  text: string,
  mime = 'text/plain',
): void {
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

/** ISO date (YYYY-MM-DD) suitable for filenames. */
export function fileDateStamp(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10)
}
