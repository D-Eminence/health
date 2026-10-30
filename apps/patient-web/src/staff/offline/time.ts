/** A time of day as the offline screens say it: "10:42". */
export function clockTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const at = new Date(iso)
  return Number.isNaN(at.getTime()) ? '' : at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/** A date and time: "29 Oct, 18:00". */
export function dayTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const at = new Date(iso)
  return Number.isNaN(at.getTime()) ? '' : at.toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}
