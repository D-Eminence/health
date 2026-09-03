import { useEffect, useState } from 'react'
import { ErrorState } from '@hid/ui'
import { useSession } from '../session'

/**
 * A protected screen.
 *
 * Note what it does with the response: holds it in component state for as long
 * as the screen is mounted, and nothing else. No storage, no global cache, no
 * logging. The response shape is `unknown` because the contract has not been
 * confirmed against staging yet, so the screen renders only what it can prove.
 */
export function Overview() {
  const { api } = useSession()
  const [error, setError] = useState<unknown>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    const controller = new AbortController()

    api.identity
      .getMyPatientProfile({ signal: controller.signal })
      .then(() => setLoaded(true))
      .catch(setError)

    // Cancel on unmount so a slow response cannot resolve into a screen the
    // patient has already navigated away from.
    return () => controller.abort()
  }, [api])

  if (error) return <ErrorState error={error} />

  return (
    <main className="p-6">
      <h1 className="text-2xl font-semibold">Your health information</h1>
      <p className="mt-2 text-muted">{loaded ? 'Profile loaded.' : 'Loading…'}</p>
    </main>
  )
}
