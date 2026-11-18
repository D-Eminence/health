import { act, render, screen } from '@testing-library/react'
import { MemoryRouter, useNavigate } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { opensInDrawer, useRouteDrawer } from '../../../ehr-blue/frame/routeDrawer'
import { MENU_STATE } from '../../../kasuwa/AppShell'

describe('opensInDrawer', () => {
  it('takes short forms and single records, and leaves long work as pages', () => {
    for (const path of ['/provider/patients', '/provider/clinical/new', '/provider/clinical/enc-1/orders/new/pharmacy', '/provider/clinical/enc-1/orders/laboratory/lab-1',
      '/provider/triage/new', '/provider/triage/enc-1~v-1', '/provider/nursing/new', '/provider/requests/new', '/provider/requests/pin',
      '/provider/patients/pin', '/provider/pharmacy/prescriptions/paper', '/provider/pharmacy/stock/receive']) expect(opensInDrawer(path)).toBe(true)
    for (const path of ['/provider', '/provider/clinical', '/provider/clinical/enc-1', '/provider/patients/open', '/provider/registration',
      '/provider/laboratory/work/lw-1', '/provider/pharmacy/prescriptions/rx-1', '/provider/ocr', '/provider/requests']) expect(opensInDrawer(path)).toBe(false)
  })
})

let go: ReturnType<typeof useNavigate>
function Probe() {
  go = useNavigate()
  const { drawer, location } = useRouteDrawer()
  return <p>{drawer ? `drawer ${drawer.drawn.pathname} over ${drawer.background.pathname}` : `page ${location.pathname}`}</p>
}

describe('useRouteDrawer', () => {
  it('opens a form reached from a page over that page, keeps it under the record the form saved, and Back closes it', () => {
    render(<MemoryRouter initialEntries={['/provider/clinical/enc-1']}><Probe /></MemoryRouter>)
    expect(screen.getByText('page /provider/clinical/enc-1')).toBeTruthy()
    act(() => { void go('/provider/triage/new') })
    expect(screen.getByText('drawer /provider/triage/new over /provider/clinical/enc-1')).toBeTruthy()
    act(() => { void go('/provider/triage/enc-1~v-1', { replace: true }) })
    expect(screen.getByText('drawer /provider/triage/enc-1~v-1 over /provider/clinical/enc-1')).toBeTruthy()
    act(() => { void go(-1) })
    expect(screen.getByText('page /provider/clinical/enc-1')).toBeTruthy()
  })

  it('opens a form as a page when its address is the first one opened (a link or a refresh)', () => {
    render(<MemoryRouter initialEntries={['/provider/clinical/new']}><Probe /></MemoryRouter>)
    expect(screen.getByText('page /provider/clinical/new')).toBeTruthy()
  })

  it('opens Find a patient in a drawer from a button, and as a page from the menu', () => {
    render(<MemoryRouter initialEntries={['/provider']}><Probe /></MemoryRouter>)
    act(() => { void go('/provider/patients') })
    expect(screen.getByText('drawer /provider/patients over /provider')).toBeTruthy()
    act(() => { void go('/provider/clinical', { state: MENU_STATE }) })
    act(() => { void go('/provider/patients', { state: MENU_STATE }) })
    expect(screen.getByText('page /provider/patients')).toBeTruthy()
  })

  it('opens a page reached from a drawer as a page', () => {
    render(<MemoryRouter initialEntries={['/provider/clinical']}><Probe /></MemoryRouter>)
    act(() => { void go('/provider/clinical/new') })
    act(() => { void go('/provider/clinical/enc-2') })
    expect(screen.getByText('page /provider/clinical/enc-2')).toBeTruthy()
  })
})
