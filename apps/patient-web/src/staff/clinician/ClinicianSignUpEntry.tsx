import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { CLINICIAN_SIGNUP_PATH, CLINICIAN_STATUS_PATH, clinicianPageHref, type ClinicianPagePath } from '../../productHostname'
import { servesClinicianApplications } from '../../backendContract'
import { clinicianApplicationApi } from '../clinicianApplicationApi'

/**
 * The way into clinician self sign-up (hid-system ADR-066) from the provider
 * sign-in and provider enrollment pages. "Sign up as a clinician" is offered
 * only while Identity says intake is open (`{ open: true }`); anything else,
 * an outage included, says sign-up is not open yet. The status page is linked
 * whether intake is open or not, unless the backend has no clinician
 * applications (Novu), when nobody can have applied. Each product site links its
 * own pages; the production portal and an admin site, which serve no staff
 * pages, link the EHR site's.
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
  return <p className={className}>
    {open ? <>New doctor or nurse? <PageLink path={CLINICIAN_SIGNUP_PATH}>Sign up as a clinician</PageLink>.</>
      : "Clinician sign-up isn't open yet."}
    {servesClinicianApplications() && <>
      {' '}Already applied as a clinician? <PageLink path={CLINICIAN_STATUS_PATH}>Check your application</PageLink>.</>}
  </p>
}

/** A clinician page: this site's own route, or the EHR site's address from a site that serves no staff pages. */
export function PageLink({ path, children }: { path: ClinicianPagePath; children: ReactNode }) {
  const href = clinicianPageHref(window.location.hostname, path)
  return href === path ? <Link to={href}>{children}</Link> : <a href={href}>{children}</a>
}
