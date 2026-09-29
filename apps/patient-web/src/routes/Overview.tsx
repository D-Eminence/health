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
  const [requestVersion, setRequestVersion] = useState(0)

  useEffect(() => {
    const controller = new AbortController()

    setError(null)
    setLoaded(false)

    api.identity
      .getMyPatientProfile({ signal: controller.signal })
      .then(() => setLoaded(true))
      .catch(reason => {
        // Aborting on unmount is expected, not a patient-facing failure.
        if (!controller.signal.aborted) setError(reason)
      })

    // Cancel on unmount so a slow response cannot resolve into a screen the
    // patient has already navigated away from.
    return () => controller.abort()
  }, [api, requestVersion])

  const retry = () => {
    // Move immediately to the loading state so a retry cannot be submitted twice.
    setError(null)
    setLoaded(false)
    setRequestVersion(version => version + 1)
  }

  return (
    <main className="patient-page">
      <div className="patient-content">
        <header className="patient-page-header">
          <p className="patient-eyebrow">Health ID</p>
          <h1 className="patient-page-title">Your health information</h1>
        </header>

        {error ? (
          <section className="patient-feedback" aria-label="Unable to load your health information">
            <ErrorState error={error} onRetry={retry} />
          </section>
        ) : (
          <section
            className="patient-feedback patient-status-panel"
            aria-busy={!loaded}
            aria-live="polite"
            role="status"
          >
            {loaded ? (
              <>
                <p className="patient-status-label">Profile</p>
                <p className="patient-status-value">Profile loaded.</p>
              </>
            ) : (
              <>
                <span className="sr-only">Loading your health information…</span>
                <span className="patient-skeleton patient-skeleton-label" aria-hidden="true" />
                <span className="patient-skeleton patient-skeleton-value" aria-hidden="true" />
              </>
            )}
          </section>
        )}
      </div>
    </main>
  )
}
