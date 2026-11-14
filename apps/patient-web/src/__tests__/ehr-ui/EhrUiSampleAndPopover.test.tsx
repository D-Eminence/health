import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { EHR_SAMPLE_NOTICE, EhrPopover, EhrSampleBanner } from '@hid/ui/ehr'

describe('EhrSampleBanner', () => {
  it('says, in the one fixed sentence, that the surface is a sample that saves nothing', () => {
    render(<EhrSampleBanner />)
    const notice = screen.getByText(EHR_SAMPLE_NOTICE)
    expect(EHR_SAMPLE_NOTICE).toBe('Sample only: not connected to Health ID yet. Nothing you do here is saved.')
    expect(notice.classList.contains('hid-ehr-sample-banner')).toBe(true)
    // There from the start: a note, not a live region.
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

function Menu({ onSignOut = () => {} }: { readonly onSignOut?: () => void }) {
  return (
    <>
      <EhrPopover trigger="DD" triggerLabel="Account menu" label="Account">
        {close => (
          <>
            <p>Fictional Clinician</p>
            <button type="button" onClick={() => { close(); onSignOut() }}>Sign out</button>
          </>
        )}
      </EhrPopover>
      <button type="button">Elsewhere</button>
    </>
  )
}

describe('EhrPopover', () => {
  it('is a native button that says whether its panel is open and which one it controls', () => {
    render(<Menu />)
    const button = screen.getByRole('button', { name: 'Account menu' })
    expect(button.tagName).toBe('BUTTON')
    expect(button.getAttribute('type')).toBe('button')
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('region', { name: 'Account' })).toBeNull()

    fireEvent.click(button)
    const panel = screen.getByRole('region', { name: 'Account' })
    expect(button.getAttribute('aria-expanded')).toBe('true')
    expect(button.getAttribute('aria-controls')).toBe(panel.id)
    expect(document.activeElement).toBe(panel)
    expect(within(panel).getByText('Fictional Clinician')).toBeDefined()

    fireEvent.click(button)
    expect(button.getAttribute('aria-expanded')).toBe('false')
  })

  it('closes on Escape and returns focus to its button', () => {
    render(<Menu />)
    const button = screen.getByRole('button', { name: 'Account menu' })
    fireEvent.click(button)
    fireEvent.keyDown(within(screen.getByRole('region', { name: 'Account' })).getByRole('button', { name: 'Sign out' }), { key: 'Escape' })
    expect(screen.queryByRole('region', { name: 'Account' })).toBeNull()
    expect(document.activeElement).toBe(button)
  })

  it('closes on a press outside, leaving focus where the press put it', () => {
    render(<Menu />)
    fireEvent.click(screen.getByRole('button', { name: 'Account menu' }))
    const elsewhere = screen.getByRole('button', { name: 'Elsewhere' })
    fireEvent.pointerDown(elsewhere)
    expect(screen.queryByRole('region', { name: 'Account' })).toBeNull()
  })

  it('lets an item act and close the panel', () => {
    const onSignOut = vi.fn()
    render(<Menu onSignOut={onSignOut} />)
    const button = screen.getByRole('button', { name: 'Account menu' })
    fireEvent.click(button)
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(onSignOut).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('region', { name: 'Account' })).toBeNull()
    expect(document.activeElement).toBe(button)
  })
})
