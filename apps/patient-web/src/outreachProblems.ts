import { isHidApiError, plainErrorText } from '@hid/http'

/*
 * The refusals of open sign-up on outreach. (identity-api outreach organisers and invitations, outreach-api's outreach
 * group rules), each in words that say what to do next. Never a code or the service's own text.
 */

/** Sign-up is switched off, or not served by this Health ID yet. */
export const SIGNUP_CLOSED = 'Signing up to run outreach isn’t open at the moment. Please try again later.'
/** Identity accepts organiser terms newer than the ones this page shows: nothing is sent until the page is reloaded. */
export const TERMS_CHANGED = 'The organiser terms have changed. Reload the page to read the new terms.'
/** The email already has a Health ID login: that login starts an outreach group itself (owner decision 5). */
export const EMAIL_HAS_LOGIN = 'This email already has a Health ID login. Sign in with it, then choose “Start an outreach group”.'
/** The email is a patient's Health ID login: it can't run or help an outreach group, and trying again never changes that. */
export const PATIENT_LOGIN = 'This email is a patient’s Health ID login. It can’t run or help an outreach group yet. Use a different email.'
/** As PATIENT_LOGIN, for someone invited: the organiser has to invite another email. */
export const INVITED_PATIENT_LOGIN = 'This email is a patient’s Health ID login. It can’t help an outreach group yet. Ask the organiser to invite a different email.'

const OUTREACH_PROBLEMS: Readonly<Record<string, string>> = {
  OUTREACH_ORGANISER_SIGNUP_UNAVAILABLE: SIGNUP_CLOSED,
  OUTREACH_ORGANISER_EMAIL_REGISTERED: EMAIL_HAS_LOGIN,
  OUTREACH_ORGANISER_REQUIRES_SIGN_OUT: 'You are signed in to Health ID. Use “Start an outreach group” from your account, or sign out to sign up with a different email.',
  OUTREACH_ORGANISER_NAME_NOT_ALLOWED: 'That group name sounds like a hospital, a ministry or another official body. Choose another name. If it is right, contact Health ID support.',
  OUTREACH_PHONE_INVALID: 'Enter a phone number we can call, like 08012345678 or +234 801 234 5678.',
  OUTREACH_ORGANISER_SIGNUP_RATE_LIMITED: 'Too many sign-ups have come from this network. Please wait an hour and try again.',
  OUTREACH_ORGANISER_SIGNUP_SESSION_INVALID: 'This sign-up has expired. Start again from the beginning.',
  OUTREACH_ORGANISER_SIGNUP_EXPIRED: 'This sign-up has expired. Start again from the beginning.',
  OUTREACH_ORGANISER_SIGNUP_NOT_READY: 'Confirm your email with the code first, then try again.',
  // Identity's answer when the terms accepted are not the ones it holds now (the page sends acceptance only once ticked).
  OUTREACH_ORGANISER_TERMS_REQUIRED: TERMS_CHANGED,
  OUTREACH_ORGANISER_NOT_VERIFIED: 'Confirm your email with the code first.',
  OUTREACH_ORGANISER_PATIENT_LOGIN: PATIENT_LOGIN,
  OUTREACH_PATIENT_LOGIN: PATIENT_LOGIN,
  OUTREACH_ORGANISER_ALREADY_RUNNING: 'Your login already runs an outreach group. Switch to it from Switch facility.',
  OUTREACH_ORGANISER_STAFF_ACCOUNT_REQUIRED: 'Sign in with a staff login to start an outreach group.',
  OUTREACH_ORGANISER_SIGNUP_DENIED: 'You can’t start an outreach group with this login. Contact Health ID support.',
  OTP_INVALID: 'That code is not right. Check the email and try again.',
  OTP_EXPIRED: 'That code has expired. Go back and ask for a new one.',
  OTP_ATTEMPTS_EXHAUSTED: 'Too many wrong codes. Go back and ask for a new code.',
  OTP_RESEND_COOLDOWN: 'A code was sent a moment ago. Check your email, or wait a minute and try again.',
  OTP_DELIVERY_UNAVAILABLE: 'We couldn’t send the code to that email just now. Check the address and try again in a few minutes.',
  TURNSTILE_INVALID: 'The security check didn’t work. Complete it again, then try again.',
  TURNSTILE_REQUIRED: 'Complete the security check, then try again.',
  TURNSTILE_CONTEXT_MISMATCH: 'The security check was made for another Health ID site. Open this page from Health ID Outreach and try again.',
  TURNSTILE_HOSTNAME_MISMATCH: 'The security check was made for another Health ID site. Open this page from Health ID Outreach and try again.',
  ORIGIN_DENIED: 'This site isn’t allowed to send outreach sign-ups. Open this page from Health ID Outreach and try again.',
  // The team: invitations.
  OUTREACH_ORGANISER_REQUIRED: 'Only the organiser of this outreach group can invite helpers.',
  OUTREACH_INVITATION_PENDING_LIMIT: 'You have many invitations waiting to be accepted. Wait for some to be accepted before inviting more.',
  OUTREACH_INVITATION_DAILY_LIMIT: 'You have sent as many invitations as you can today. Try again tomorrow.',
  OUTREACH_INVITEE_ALREADY_MEMBER: 'This person is already in your team.',
  OUTREACH_ORGANISER_SUSPENDED: 'This outreach group has been paused by Health ID. Contact Health ID support.',
  OUTREACH_INVITATION_ALREADY_SENT: 'This person already has an invitation waiting.',
  // Accepting an invitation.
  OUTREACH_INVITATION_INVALID: 'This invitation link is not right. Open the link from the email again, or copy all of it into your browser.',
  OUTREACH_INVITATION_EXPIRED: 'This invitation has expired. Ask the organiser to invite you again.',
  OUTREACH_INVITATION_SUPERSEDED: 'A newer invitation was sent to you. Use the link in the newest email.',
  OUTREACH_INVITATION_REVOKED: 'This invitation was withdrawn. Ask the organiser if you should still join.',
  OUTREACH_INVITATION_ALREADY_ACCEPTED: 'This invitation has already been accepted. Sign in to start helping.',
  OUTREACH_INVITATION_SIGN_IN_REQUIRED: 'This email already has a Health ID login. Sign in with it, then open the invitation link again.',
  OUTREACH_INVITATION_REQUIRES_SIGN_OUT: 'You are signed in to Health ID. Accept with your login below, or sign out first.',
  OUTREACH_INVITATION_WRONG_ACCOUNT: 'This invitation was sent to another email. Sign in with the login for that email.',
  OUTREACH_INVITATION_LOCKED: 'Too many wrong tries. Wait a while, then open the link from the email again.',
  OUTREACH_INVITATION_RATE_LIMITED: 'Too many tries from this network. Please wait an hour and try again.',
  OUTREACH_INVITATION_PATIENT_LOGIN: INVITED_PATIENT_LOGIN,
  OUTREACH_INVITATION_UNAVAILABLE: 'Invitations aren’t working right now. Please try again in a few minutes.',
  // Registering at an outreach group (outreach-api).
  OUTREACH_TENANT_NO_HEALTH_ID_LINK: 'Outreach groups can’t link people to a Health ID. The person can link their own Health ID later, from their own account.',
  OUTREACH_CONSENT_GUARDIAN_REQUIRED: 'This person is under 18. Enter the name of the parent or guardian who agreed.',
  OUTREACH_CONSENT_REQUIRED: 'Read the notice to the person and record how they agreed before registering them.',
  OUTREACH_CAMPAIGN_REQUIRED: 'Choose the campaign this person is being registered in.',
  OUTREACH_NOTES_TOO_LONG: 'Keep notes to 280 characters, and do not write diagnoses.',
}

/** Whether a refusal says open sign-up is closed: switched off (423), or not served by this Health ID (404). */
export function signupClosed(error: unknown): boolean {
  return isHidApiError(error) && (error.code === 'OUTREACH_ORGANISER_SIGNUP_UNAVAILABLE' && error.status === 423
    || error.status === 404 && (error.code === 'NOT_FOUND' || error.code === 'API_ROUTE_NOT_FOUND'))
}

/** An outreach refusal in plain words; anything else as the shared helper says it. */
export function outreachProblemText(error: unknown, fallback: string): string {
  if (isHidApiError(error) && Object.hasOwn(OUTREACH_PROBLEMS, error.code)) return OUTREACH_PROBLEMS[error.code]!
  return plainErrorText(error, fallback)
}

/** Whether an outreach refusal is one this module words (so a page can tell it from a fault). */
export function isOutreachProblem(error: unknown, code: string): boolean {
  return isHidApiError(error) && error.code === code
}
