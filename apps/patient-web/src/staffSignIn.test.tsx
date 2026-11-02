import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { AuthLayout } from './AuthLayout'
import { isStaffPath, OpenStaffPage, sameStaffPageOn, staffSignInAddress, StaffSignInLink } from './staffSignIn'

/**
 * The production patient portal (app.) serves patients only (owner, 2026-11-01), and the admin sites platform
 * administrators only: every way to a staff page there is the EHR site's page, a plain link or an immediate replace,
 * never a step of its own. Staging's portal and each product site keep all their own staff pages.
 */
const EHR_SIGN_IN = 'https://ehr.healthidentitydirectory.com/provider/sign-in'
const OTHER_HOSTS = ['ehr.healthidentitydirectory.com', 'lab.healthidentitydirectory.com', 'pharmacy.healthidentitydirectory.com',
  'migrate.healthidentitydirectory.com', 'outreach.healthidentitydirectory.com', 'staging.healthidentitydirectory.com',
  'ehr.staging.healthidentitydirectory.com', 'localhost']

afterEach(() => { vi.unstubAllGlobals() })

function serveFrom(hostname: string, replace = vi.fn()) {
  vi.stubGlobal('location', { ...window.location, hostname, replace })
  return replace
}

function Where() {
  return <output data-testid="where">{useLocation().pathname}</output>
}

/** Clicks `link` and says whether the router took the click (a link within the site) or left it to the browser. */
function routerTook(link: HTMLElement): boolean {
  let prevented = false
  // After React's own listener at the root: a router link has prevented the click by then; a plain link has not. The
  // browser's own following of the link (which jsdom cannot do) is stopped here.
  const after = (event: Event) => { prevented = event.defaultPrevented; event.preventDefault() }
  window.addEventListener('click', after)
  try { act(() => { link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })) }) }
  finally { window.removeEventListener('click', after) }
  return prevented
}

describe('isStaffPath', () => {
  it.each(['/provider', '/provider/', '/provider//', '/provider/sign-in', '/provider/sign-in/', '/Provider/Sign-In', '/PROVIDER',
    '/provider/recover', '/provider/enroll', '/provider/invitation', '/provider/join', '/provider/join/status',
    '/provider/staff/join', '/provider/clinical', '/provider/sign-in/extra'])('%s is a staff page', path => {
    expect(isStaffPath(path)).toBe(true)
  })

  it.each(['/', '/sign-in', '/enroll', '/providers', '/provider-sign-in', '/provider.html', '/records', '//provider', '/x/provider'])(
    '%s is not: it stays the portal’s own page', path => {
      expect(isStaffPath(path)).toBe(false)
    })
})

describe('sameStaffPageOn', () => {
  it('keeps the path, query and fragment, and only the origin given', () => {
    expect(sameStaffPageOn('https://ehr.healthidentitydirectory.com',
      { pathname: '/provider/invitation', search: '', hash: '#2f6c1a.tok-en_1' }))
      .toBe('https://ehr.healthidentitydirectory.com/provider/invitation#2f6c1a.tok-en_1')
    expect(sameStaffPageOn('https://ehr.healthidentitydirectory.com',
      { pathname: '/provider/enroll', search: '?product=laboratory&type=laboratory', hash: '' }))
      .toBe('https://ehr.healthidentitydirectory.com/provider/enroll?product=laboratory&type=laboratory')
  })

  it.each([
    { pathname: '//evil.example/provider', search: '', hash: '' },
    { pathname: '/provider//evil.example', search: '?next=https://evil.example', hash: '#@evil.example' },
    { pathname: '/provider/@evil.example', search: '', hash: '' },
  ])('never leaves the origin given, whatever the address holds (%o)', location => {
    expect(new URL(sameStaffPageOn('https://ehr.healthidentitydirectory.com', location)).origin)
      .toBe('https://ehr.healthidentitydirectory.com')
  })
})

describe('OpenStaffPage', () => {
  it('replaces the page with the EHR site’s page at once, saying so in one line with a plain link, and no Continue step', () => {
    const replace = serveFrom('app.healthidentitydirectory.com')
    const href = 'https://ehr.healthidentitydirectory.com/provider/recover'
    render(<MemoryRouter initialEntries={['/provider/recover']}><OpenStaffPage href={href} /></MemoryRouter>)
    expect(replace).toHaveBeenCalledTimes(1)
    expect(replace).toHaveBeenCalledWith(href)
    expect(screen.getByRole('status').textContent).toBe('Opening Health ID EHR…')
    expect(screen.getByRole('link', { name: 'Go to Health ID EHR' }).getAttribute('href')).toBe(href)
    expect(screen.getAllByRole('link')).toHaveLength(1)
    expect(screen.queryByRole('heading')).toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByText(/continue/i)).toBeNull()
  })
})

describe('links to the staff sign-in', () => {
  it.each([['app.healthidentitydirectory.com', EHR_SIGN_IN], ['admin.healthidentitydirectory.com', EHR_SIGN_IN],
    ['admin.staging.healthidentitydirectory.com', 'https://ehr.staging.healthidentitydirectory.com/provider/sign-in']])(
    'on %s are plain links to the EHR site’s sign-in, which the router never takes', (hostname, ehrSignIn) => {
    serveFrom(hostname)
    render(<MemoryRouter initialEntries={['/provider/join']}><Where />
      <StaffSignInLink className="x">Sign in</StaffSignInLink>
      <StaffSignInLink to="/provider" aria-label="Provider portal">Go to the provider portal</StaffSignInLink>
    </MemoryRouter>)
    const signIn = screen.getByRole('link', { name: 'Sign in' })
    expect(signIn.getAttribute('href')).toBe(ehrSignIn)
    expect(signIn.className).toBe('x')
    const portal = screen.getByRole('link', { name: 'Provider portal' })
    expect(portal.getAttribute('href')).toBe(ehrSignIn)
    expect(routerTook(signIn)).toBe(false)
    expect(routerTook(portal)).toBe(false)
    expect(screen.getByTestId('where').textContent).toBe('/provider/join')
    expect(staffSignInAddress()).toBe(ehrSignIn)
    expect(staffSignInAddress(undefined, '/provider')).toBe(ehrSignIn)
  })

  it.each(OTHER_HOSTS)('on %s stay links within the site, to its own staff sign-in', hostname => {
    serveFrom(hostname)
    render(<MemoryRouter initialEntries={['/provider/join']}><Where /><Routes>
      <Route path="*" element={<><StaffSignInLink>Sign in</StaffSignInLink><StaffSignInLink to="/provider">Portal</StaffSignInLink></>} />
    </Routes></MemoryRouter>)
    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe('/provider/sign-in')
    expect(screen.getByRole('link', { name: 'Portal' }).getAttribute('href')).toBe('/provider')
    expect(routerTook(screen.getByRole('link', { name: 'Sign in' }))).toBe(true)
    expect(screen.getByTestId('where').textContent).toBe('/provider/sign-in')
    expect(staffSignInAddress()).toBe('/provider/sign-in')
    expect(staffSignInAddress(undefined, '/provider')).toBe('/provider')
  })

  it.each([
    ['app.healthidentitydirectory.com', EHR_SIGN_IN],
    ['staging.healthidentitydirectory.com', '/provider/sign-in'],
  ])('in the sign-in layout\'s top bar on %s, the logo and Sign in lead to %s', (hostname, href) => {
    serveFrom(hostname)
    render(<MemoryRouter><AuthLayout brandTo={staffSignInAddress()} brandLabel="Health ID provider sign in"
      headerLink={{ to: staffSignInAddress(), label: 'Sign in' }} title="Set up your facility." titleId="t">
      <p>Form</p></AuthLayout></MemoryRouter>)
    const logo = screen.getByRole('link', { name: 'Health ID provider sign in' })
    const signIn = screen.getByRole('link', { name: 'Sign in' })
    expect(logo.getAttribute('href')).toBe(href)
    expect(signIn.getAttribute('href')).toBe(href)
    expect(routerTook(signIn)).toBe(href.startsWith('/'))
  })
})
