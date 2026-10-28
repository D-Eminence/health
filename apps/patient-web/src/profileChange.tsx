import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

/**
 * Tells the portal's other views that the patient changed their profile here (a photo saved or removed, a new email or
 * phone), so the header's avatar and the pages already open read it again. In memory only, for the portal's own
 * window; outside the provider (a page tested on its own) nothing is told.
 */
const ProfileChangeContext = createContext<{ version: number; announce: () => void } | null>(null)

export function ProfileChangeProvider({ children }: { children: ReactNode }) {
  const [version, setVersion] = useState(0)
  const announce = useCallback(() => setVersion(value => value + 1), [])
  const value = useMemo(() => ({ version, announce }), [version, announce])
  return <ProfileChangeContext.Provider value={value}>{children}</ProfileChangeContext.Provider>
}

const nothing = () => undefined

/** The way to say the profile changed. */
export function useAnnounceProfileChange(): () => void {
  return useContext(ProfileChangeContext)?.announce ?? nothing
}

/** Calls `listener` each time the profile is said to have changed, after the view first showed. */
export function useOnProfileChange(listener: () => void): void {
  const version = useContext(ProfileChangeContext)?.version ?? 0
  const seen = useRef(version)
  const latest = useRef(listener)
  latest.current = listener
  useEffect(() => {
    if (version === seen.current) return
    seen.current = version
    latest.current()
  }, [version])
}
