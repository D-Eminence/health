import { describe, expect, it, vi } from 'vitest'
import { isSafeReturnPath } from '../../sso/handOff'

/**
 * The shared shape is checked before any site's own list (sso/handOff.ts isSafeReturnPath), so a list widened by
 * mistake one day still never sends anyone to an unsafe address. Here the provider workspace's list takes any path,
 * standing in for such a mistake: the shape alone refuses each of these. The host is only a name; nothing reaches it.
 */
vi.mock('../../staff/session', () => ({ staffReturnPath: (path: string | null) => path }))

const EHR = 'ehr.healthidentitydirectory.com'

describe('the shared shape, should a site’s list ever take too much', () => {
  it('lets the widened list take a page, so the cases below test the shape alone', () => {
    expect(isSafeReturnPath('/provider/anything', EHR)).toBe(true)
  })

  it.each([
    `/provider/${'a'.repeat(512)}`, '/provider//evil.example', '/provider/x\\y', '/provider/x\ny', '/provider/x%2fy',
    '/provider/x#y', '/provider/../admin', '/provider/./x',
  ])('refuses %j', path => {
    expect(isSafeReturnPath(path, EHR)).toBe(false)
  })
})
