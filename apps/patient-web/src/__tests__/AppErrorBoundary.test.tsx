import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fireEvent, render, screen } from '@testing-library/react'
import { AppErrorBoundary } from '../AppErrorBoundary'

/**
 * hid-1.0 wrapped its whole app in an error boundary (src/App.tsx 61-93): a page that crashed showed "Something
 * went wrong" and a Reload button. The portal showed a blank page instead.
 */
afterEach(() => { vi.restoreAllMocks(); window.history.replaceState(null, '', '/') })

function Broken(): never { throw new Error('Cannot read properties of undefined (reading "patient-secret")') }

describe('a page that fails to render', () => {
  it('shows what happened and a way to reload, never the failure itself', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const reload = vi.fn()
    render(<AppErrorBoundary reload={reload}><Broken /></AppErrorBoundary>)
    const alert = screen.getByRole('alert')
    expect(screen.getByRole('heading', { name: 'Something went wrong', level: 1 })).toBeTruthy()
    expect(alert.textContent).toContain('This page could not be shown. Reload it to try again.')
    expect(document.body.textContent).not.toContain('patient-secret')
    // The control that had focus went with the page: focus goes to the heading.
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Something went wrong' }))
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }))
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('offers the overview, a full load, from a page that may fail each time it loads', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    window.history.replaceState(null, '', '/records')
    render(<AppErrorBoundary reload={() => {}}><Broken /></AppErrorBoundary>)
    const overview = screen.getByRole('link', { name: 'Go to your overview' })
    // A plain link: the router went with the page.
    expect(overview.getAttribute('href')).toBe('/')
    expect(screen.getByRole('alert').contains(overview)).toBe(true)
  })

  it('offers only Reload on the overview, which the link would load again', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<AppErrorBoundary reload={() => {}}><Broken /></AppErrorBoundary>)
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Go to your overview' })).toBeNull()
  })

  it('shows the page itself while it renders', () => {
    render(<AppErrorBoundary><main><h1>Overview</h1></main></AppErrorBoundary>)
    expect(screen.getByRole('heading', { name: 'Overview' })).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('wraps the whole portal, its router included', () => {
    const here = dirname(fileURLToPath(import.meta.url))
    const main = readFileSync(resolve(here, '../main.tsx'), 'utf8')
    expect(main).toMatch(/<AppErrorBoundary>\s*<BrowserRouter>[\s\S]*<App \/>[\s\S]*<\/BrowserRouter>\s*<\/AppErrorBoundary>/)
  })
})
