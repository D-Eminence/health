import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { PatientNotFound } from '../App'

/**
 * An address the portal has no page for (an old or mistyped link, or /chat while chat is off): the designed state, in
 * plain words, with one way on, to Home, named as the tab bar names it.
 */
describe('the patient portal\'s page not found', () => {
  it('says what happened and offers Home', () => {
    const { container } = render(<MemoryRouter><PatientNotFound /></MemoryRouter>)
    expect(screen.getByRole('heading', { level: 1, name: 'Page not found' })).toBeTruthy()
    expect(screen.getByText('We couldn’t find that page. The link may be old or mistyped.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Go to Home' }).getAttribute('href')).toBe('/')
    // The empty state's drawing, decorative; and none of the old block's words.
    expect(container.querySelector('svg[aria-hidden="true"]')).not.toBeNull()
    expect(screen.queryByText('This patient page is unavailable.')).toBeNull()
    expect(screen.queryByText('Go to overview')).toBeNull()
    expect(document.title).toBe('Page not found · Health ID')
  })
})
