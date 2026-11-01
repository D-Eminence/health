import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { CLINICIAN_SIGNUP_PATH, CLINICIAN_STATUS_PATH, clinicianPageHref, type ClinicianPagePath } from '../../productHostname'
import { servesClinicianApplications } from '../../backendContract'
import { clinicianApplicationApi } from '../clinicianApplicationApi'

/**
 * The way into clinician self sign-up (hid-system ADR-066) from the provider
 * sign-in and provider enrollment pages. "Sign up as a clinician" is offered
 * only while Identity says intake is open (`{ open: true }`); anything else,
 * an outage included, offers nothing (no "not open yet"). The status page is linked
 * whether intake is open or not, unless the backend has no clinician
 * applications (Novu), when nobody can have applied. On a staff product host or
 * the admin site both go to the main site, where their security checks are
 * accepted.
 */
export function ClinicianSignUpEntry({ className }: { className: string }) {
  const [open, setOpen] = useState<boolean | null>(null)

  useEffect(() => {
    let active = true
    clinicianApplicationApi.availability().then(
      answer => { if (active) setOpen(answer.open) },
      () => { if (active) setOpen(false) })
    return () => { active = false }
  }, [])

  // Nothing until Identity has answered: a link offered and then taken back would mislead.
  if (open === null) return null
  const status = servesClinicianApplications()
  if (!open && !status) return null
  return <p className={className}>
    {open ? <>Doctor or nurse? <PageLink path={CLINICIAN_SIGNUP_PATH}>Sign up as a clinician</PageLink></>
      : <>Applied as a clinician? <PageLink path={CLINICIAN_STATUS_PATH}>Check your application</PageLink></>}
    {open && status ? <> · <PageLink path={CLINICIAN_STATUS_PATH}>Check your application</PageLink></> : null}
  </p>
}

/** A clinician page: this site's own route, or the main site's address on a product or admin host. */
export function PageLink({ path, children }: { path: ClinicianPagePath; children: ReactNode }) {
  const href = clinicianPageHref(window.location.hostname, path)
  return href === path ? <Link to={href}>{children}</Link> : <a href={href}>{children}</a>
}
