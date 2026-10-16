/** Hands a file the backend returned to the browser's save flow. Nothing is kept. */
export function saveFile(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  try {
    const link = document.createElement('a')
    link.href = url
    link.download = fileName
    link.rel = 'noopener'
    document.body.append(link)
    link.click()
    link.remove()
  } finally {
    // Revoke after the click has been dispatched so the file stays out of memory.
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }
}
