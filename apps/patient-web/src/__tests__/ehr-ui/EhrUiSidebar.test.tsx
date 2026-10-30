import { useState } from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { EhrSidebar } from '@hid/ui/ehr'
import { NAV_GROUPS } from './ehrHarness'

/**
 * EhrSidebar: a navigation landmark of grouped links. Group headings are
 * native buttons that disclose their list; the current page's link says so;
 * the collapsed rail keeps every link's name. State is props or memory only.
 */

describe('EhrSidebar', () => {
  it('is a labelled navigation landmark whose current link has aria-current="page"', () => {
    render(<EhrSidebar groups={NAV_GROUPS} currentId="appointments" />)
    const nav = screen.getByRole('navigation', { name: 'Main navigation' })
    const current = within(nav).getByRole('link', { name: 'Appointments' })
    expect(current.getAttribute('aria-current')).toBe('page')
    expect(current.getAttribute('href')).toBe('/ehr/appointments')
    for (const name of ['Patients', 'Staff', 'Facility settings']) {
      expect(within(nav).getByRole('link', { name }).getAttribute('aria-current')).toBeNull()
    }
    expect(nav.closest('aside')!.classList.contains('hid-ehr-sidebar')).toBe(true)
  })

  it('makes each group heading a native button that toggles aria-expanded and the list it controls', () => {
    render(<EhrSidebar groups={NAV_GROUPS} currentId="patients" />)
    const heading = screen.getByRole('button', { name: 'Care' })
    expect(heading.tagName).toBe('BUTTON')
    expect(heading.getAttribute('type')).toBe('button')
    expect(heading.getAttribute('aria-expanded')).toBe('true')
    const list = document.getElementById(heading.getAttribute('aria-controls')!)!
    expect(list.tagName).toBe('UL')
    expect(within(list).getByRole('link', { name: 'Patients' })).toBeDefined()

    fireEvent.click(heading)
    expect(heading.getAttribute('aria-expanded')).toBe('false')
    expect(list.hidden).toBe(true)
    expect(screen.queryByRole('link', { name: 'Patients' })).toBeNull()
    // The other group is untouched.
    expect(screen.getByRole('button', { name: 'Facility' }).getAttribute('aria-expanded')).toBe('true')

    fireEvent.click(heading)
    expect(heading.getAttribute('aria-expanded')).toBe('true')
    expect(list.hidden).toBe(false)
  })

  it('reports group changes to a controlling parent, which decides', () => {
    const onClosedGroupsChange = vi.fn()
    function Controlled() {
      const [closed, setClosed] = useState<readonly string[]>(['facility'])
      return <EhrSidebar groups={NAV_GROUPS} closedGroups={closed} onClosedGroupsChange={next => { onClosedGroupsChange(next); setClosed(next) }} />
    }
    render(<Controlled />)
    const facility = screen.getByRole('button', { name: 'Facility' })
    expect(facility.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(facility)
    expect(onClosedGroupsChange).toHaveBeenLastCalledWith([])
    expect(facility.getAttribute('aria-expanded')).toBe('true')
  })

  it('collapses to a rail that keeps every link and its name, without group headings', () => {
    const onCollapsedChange = vi.fn()
    render(<EhrSidebar groups={NAV_GROUPS} currentId="staff" onCollapsedChange={onCollapsedChange} />)
    const collapse = screen.getByRole('button', { name: 'Collapse sidebar' })
    expect(collapse.tagName).toBe('BUTTON')
    expect(collapse.getAttribute('type')).toBe('button')

    fireEvent.click(collapse)
    expect(onCollapsedChange).toHaveBeenLastCalledWith(true)
    expect(document.querySelector('.hid-ehr-sidebar')!.classList.contains('hid-ehr-sidebar-collapsed')).toBe(true)
    expect(screen.queryByRole('button', { name: 'Care' })).toBeNull()
    const nav = screen.getByRole('navigation', { name: 'Main navigation' })
    expect(within(nav).getAllByRole('link')).toHaveLength(4)
    for (const name of ['Patients', 'Appointments', 'Staff', 'Facility settings']) {
      expect(within(nav).getByRole('link', { name })).toBeDefined()
    }
    expect(within(nav).getByRole('link', { name: 'Staff' }).getAttribute('aria-current')).toBe('page')

    const expand = screen.getByRole('button', { name: 'Expand sidebar' })
    fireEvent.click(expand)
    expect(onCollapsedChange).toHaveBeenLastCalledWith(false)
    expect(screen.getByRole('button', { name: 'Care' })).toBeDefined()
  })

  it('follows a controlled collapsed prop', () => {
    render(<EhrSidebar groups={NAV_GROUPS} collapsed />)
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }))
    // No onCollapsedChange to act on it: the parent keeps it collapsed.
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeDefined()
  })

  it('hands a followed link to onNavigate, which may route in the app instead', () => {
    const onNavigate = vi.fn((_, event: { preventDefault: () => void }) => event.preventDefault())
    render(<EhrSidebar groups={NAV_GROUPS} onNavigate={onNavigate} />)
    fireEvent.click(screen.getByRole('link', { name: 'Staff' }))
    expect(onNavigate).toHaveBeenCalledTimes(1)
    expect(onNavigate.mock.calls[0]![0]).toMatchObject({ id: 'staff', href: '/ehr/staff' })
  })

  it('brings the current entry into view, nearest, each time the current page changes', () => {
    // jsdom has no scrollIntoView: the sidebar checks for it, and this stands one in.
    const scrolled: { name: string | null; options: unknown }[] = []
    const scrollIntoView = vi.fn(function (this: HTMLElement, options?: unknown) { scrolled.push({ name: this.textContent, options }) })
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView })
    try {
      const { rerender } = render(<EhrSidebar groups={NAV_GROUPS} currentId="appointments" />)
      expect(scrolled).toEqual([{ name: 'Appointments', options: { block: 'nearest' } }])
      rerender(<EhrSidebar groups={NAV_GROUPS} currentId="appointments" />)
      expect(scrolled).toHaveLength(1)
      rerender(<EhrSidebar groups={NAV_GROUPS} currentId="settings" />)
      expect(scrolled).toEqual([
        { name: 'Appointments', options: { block: 'nearest' } },
        { name: 'Facility settings', options: { block: 'nearest' } },
      ])
    } finally {
      delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView
    }
  })

  it('does without scrollIntoView where the browser has none', () => {
    expect('scrollIntoView' in HTMLElement.prototype).toBe(false)
    expect(() => render(<EhrSidebar groups={NAV_GROUPS} currentId="staff" />)).not.toThrow()
  })
})
