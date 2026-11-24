import type { OutreachGroupDetails } from './staff/api'

/** A person's or group's name, as Identity takes it: letters, digits, spaces and . , ' & ( ) - / only. */
export const NAME = /^[\p{L}\p{M}0-9][\p{L}\p{M}0-9 .,'&()/-]*$/u
const REGISTRATION = /^(RC|BN|IT)?[0-9]{4,20}$/
export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * The group details the sign-up and "Start an outreach group" both collect, checked as Identity checks them
 * (OutreachGroupDetailsDto): a group name of 2 to 120 letters, numbers and simple punctuation, individual or group, an
 * optional CAC or IT number (stored, not checked), and a phone number of 7 to 32 characters.
 */
export function groupDetailsProblems(details: OutreachGroupDetails): Partial<Record<'groupName' | 'phone' | 'registrationNumber', string>> {
  const problems: Partial<Record<'groupName' | 'phone' | 'registrationNumber', string>> = {}
  const group = details.groupName.trim()
  if (group.length < 2) problems.groupName = 'Enter your group’s name: at least 2 characters.'
  else if (group.length > 120 || !NAME.test(group)) problems.groupName = 'Use letters, numbers and simple punctuation, up to 120 characters.'
  const phone = details.phone.trim()
  if (phone.length < 7 || phone.length > 32) problems.phone = 'Enter a phone number we can call, like 08012345678.'
  const registration = details.registrationNumber?.replace(/\s+/g, '').toUpperCase()
  if (registration && !REGISTRATION.test(registration)) {
    problems.registrationNumber = 'Enter a CAC number like RC1234567 or BN1234567, or an IT number, or leave it empty.'
  }
  return problems
}

