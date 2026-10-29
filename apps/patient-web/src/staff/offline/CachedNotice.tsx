import { CACHED } from './copy'
import { clockTime } from './time'

/** Says the chart shows the copy saved on this device, and from when (§2.7 "Network first"). */
export function CachedNotice({ savedAt }: { savedAt: string | null }) {
  if (!savedAt) return null
  return <div className="staff-notice offline-cached">
    <strong>{CACHED.savedCopy(clockTime(savedAt))}</strong>
    <p className="staff-muted">{CACHED.refreshing}</p>
  </div>
}
