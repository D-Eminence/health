import '@hid/ui/ehr.css'
import './signup.css'
import { Link } from 'react-router-dom'
import { useDocumentTitle } from '../../authSteps'
import { outreachSignUpHref } from '../../productHostname'
import { ORGANISER_TERMS, ORGANISER_TERMS_VERSION, registrationNotice } from '../../outreachTerms'
import { ScreenHeading } from './parts'
import { SignupShell } from './SignupShell'

/**
 * The organiser terms (version 2026-11-01), public, so an organiser can read them before and after signing up, with the
 * notice every person is given before they are registered.
 */
export function OutreachTerms() {
  useDocumentTitle('Organiser terms · Health ID Outreach')
  const signUp = outreachSignUpHref(window.location.hostname)
  return (
    <SignupShell footer={<p>Version {ORGANISER_TERMS_VERSION}.</p>} story={{ eyebrow: 'Health ID — Outreach',
      title: <>Register people in the field.<br />Safely, from day one.</>, text: 'Your group’s own private space for outreach events.' }}>
      <ScreenHeading id="outreach-terms-title">Organiser terms for Health ID Outreach</ScreenHeading>
      <p className="hid-ehr-signup-muted">Version {ORGANISER_TERMS_VERSION}. These terms apply to everyone who runs an outreach
        group on Health ID, and to the helpers they invite.</p>
      {ORGANISER_TERMS.map(section => <section key={section.heading} aria-labelledby={`terms-${slug(section.heading)}`}>
        <h2 id={`terms-${slug(section.heading)}`} className="hid-ehr-signup-step-title">{section.heading}</h2>
        {section.paragraphs.map(paragraph => <p key={paragraph} className="hid-ehr-signup-muted">{paragraph}</p>)}
        {section.points ? <ul className="hid-ehr-signup-muted">{section.points.map(point => <li key={point}>{point}</li>)}</ul> : null}
      </section>)}
      <section aria-labelledby="terms-notice">
        <h2 id="terms-notice" className="hid-ehr-signup-step-title">The notice each person is given</h2>
        <p className="hid-ehr-signup-muted">Your team reads this to each person, or lets them read it, before registering them.
          It can be read aloud in Yoruba, Hausa, Igbo or Nigerian Pidgin.</p>
        <blockquote className="hid-ehr-signup-muted">{registrationNotice('[Your group’s name]').map(line => <p key={line}>{line}</p>)}</blockquote>
      </section>
      <p className="hid-ehr-signup-muted">{signUp.startsWith('/')
        ? <Link className="hid-ehr-signup-link" to={signUp}>Start running outreach</Link>
        : <a className="hid-ehr-signup-link" href={signUp}>Start running outreach</a>}</p>
    </SignupShell>
  )
}

function slug(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}
