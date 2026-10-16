/**
 * A contact email as hid-system accepts it.
 *
 * hid-system checks every public contact email (CreateDemoRequestDto
 * `contactEmail`, and `administratorEmail` on the organization application and
 * completion DTOs) with class-validator's `@IsEmail()` and `@MaxLength(254)`,
 * after trimming. This follows validator 13.15.35's `isEmail` with its default
 * options (and `isFQDN` for the domain), so the site refuses on the field
 * what hid-system would refuse with a bare 400 VALIDATION_FAILED. It is no
 * stricter, except that a quoted local part may not hold control characters.
 */

const MAX_EMAIL = 254
const MAX_LOCAL_PART_BYTES = 64
const MAX_DOMAIN_BYTES = 254
const MAX_LABEL = 63

/** validator's `emailUserUtf8Part`: one dot-separated piece of an unquoted local part. */
const LOCAL_PART = /^[a-z\d!#$%&'*+\-/=?^_`{|}~\u00A1-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF]+$/i
/** validator's `quotedEmailUserUtf8`, without the control characters nobody types. */
const QUOTED_LOCAL_PART = /^(?:[\s\x21\x23-\x5b\x5d-\x7e\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF]|\\[\x20-\x7e\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF])*$/i
/** isFQDN with `require_tld`: letters (two or more) or a punycode label, never digits. */
const TOP_LEVEL = /^(?:[a-z\u00A1-\u00A8\u00AA-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF]{2,}|xn[a-z0-9-]{2,})$/i
/** isFQDN without `allow_underscores`. */
const LABEL = /^[a-z\u00A1-\uFFFF0-9-]+$/i
const FULL_WIDTH = /[\uFF01-\uFF5E]/

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).length
}

function isDomain(domain: string): boolean {
  const labels = domain.split('.')
  const topLevel = labels.at(-1) ?? ''
  if (labels.length < 2 || !TOP_LEVEL.test(topLevel)) return false
  return labels.every(label => label.length <= MAX_LABEL && LABEL.test(label) && !FULL_WIDTH.test(label)
    && !label.startsWith('-') && !label.endsWith('-'))
}

export function isContactEmail(value: string): boolean {
  const email = value.trim()
  if (email.length > MAX_EMAIL) return false
  const at = email.lastIndexOf('@')
  if (at < 0) return false
  const localPart = email.slice(0, at)
  const domain = email.slice(at + 1)
  if (utf8Length(localPart) > MAX_LOCAL_PART_BYTES || utf8Length(domain) > MAX_DOMAIN_BYTES) return false
  if (!isDomain(domain)) return false
  if (localPart.startsWith('"') && localPart.endsWith('"')) return QUOTED_LOCAL_PART.test(localPart.slice(1, -1))
  return localPart.split('.').every(piece => LOCAL_PART.test(piece))
}
