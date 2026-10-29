import { useState } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { EhrButton, EhrIconButton } from '@hid/ui/ehr'

/**
 * EhrButton and EhrIconButton: native buttons. The browser turns Enter and
 * Space into a click (jsdom does not), so these activate with fireEvent.click.
 */

describe('EhrButton', () => {
  it('is a native button, type="button" unless told otherwise', () => {
    render(<><EhrButton>Add patient</EhrButton><EhrButton type="submit">Save record</EhrButton></>)
    const add = screen.getByRole('button', { name: 'Add patient' })
    expect(add.tagName).toBe('BUTTON')
    expect(add.getAttribute('type')).toBe('button')
    expect(screen.getByRole('button', { name: 'Save record' }).getAttribute('type')).toBe('submit')
  })

  it('names its variant and size by class, primary and 40px by default', () => {
    render(
      <>
        <EhrButton>Primary</EhrButton>
        <EhrButton variant="secondary">Secondary</EhrButton>
        <EhrButton variant="quiet" size="sm">Quiet</EhrButton>
        <EhrButton variant="danger">Danger</EhrButton>
      </>,
    )
    expect(screen.getByRole('button', { name: 'Primary' }).className).toBe('hid-ehr-button')
    expect(screen.getByRole('button', { name: 'Secondary' }).classList.contains('hid-ehr-button-secondary')).toBe(true)
    const quiet = screen.getByRole('button', { name: 'Quiet' })
    expect(quiet.classList.contains('hid-ehr-button-quiet')).toBe(true)
    expect(quiet.classList.contains('hid-ehr-button-sm')).toBe(true)
    expect(screen.getByRole('button', { name: 'Danger' }).classList.contains('hid-ehr-button-danger')).toBe(true)
  })

  it('activates on click, and not at all when disabled', () => {
    const onClick = vi.fn()
    const { rerender } = render(<EhrButton onClick={onClick}>Admit patient</EhrButton>)
    fireEvent.click(screen.getByRole('button', { name: 'Admit patient' }))
    expect(onClick).toHaveBeenCalledTimes(1)

    rerender(<EhrButton onClick={onClick} disabled>Admit patient</EhrButton>)
    const button = screen.getByRole('button', { name: 'Admit patient' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    fireEvent.click(button)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('keeps its label while busy, says so with aria-busy, and fires once for two clicks', () => {
    const onSave = vi.fn()
    function Saving() {
      const [busy, setBusy] = useState(false)
      return <EhrButton busy={busy} onClick={() => { onSave(); setBusy(true) }}>Save vitals</EhrButton>
    }
    render(<Saving />)
    const button = screen.getByRole('button', { name: 'Save vitals' })
    expect(button.getAttribute('aria-busy')).toBeNull()

    fireEvent.click(button)
    fireEvent.click(button)
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(button.getAttribute('aria-busy')).toBe('true')
    expect(button.getAttribute('aria-disabled')).toBe('true')
    expect(button.textContent).toBe('Save vitals')
    // Still focusable and named while busy.
    expect((button as HTMLButtonElement).disabled).toBe(false)
  })

  it('holds itself busy while the promise its click returned is pending', async () => {
    let finish = () => {}
    const onClick = vi.fn(() => new Promise<void>(resolve => { finish = resolve }))
    render(<EhrButton onClick={onClick}>Send referral</EhrButton>)
    const button = screen.getByRole('button', { name: 'Send referral' })

    fireEvent.click(button)
    fireEvent.click(button)
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(button.getAttribute('aria-busy')).toBe('true')

    await act(async () => finish())
    expect(button.getAttribute('aria-busy')).toBeNull()
    fireEvent.click(button)
    expect(onClick).toHaveBeenCalledTimes(2)
  })

  it('shows a decorative icon beside the label without changing the name', () => {
    render(<EhrButton icon={<svg data-testid="plus" />}>New appointment</EhrButton>)
    const button = screen.getByRole('button', { name: 'New appointment' })
    expect(screen.getByTestId('plus').closest('[aria-hidden="true"]')).not.toBeNull()
    expect(button.contains(screen.getByTestId('plus'))).toBe(true)
  })
})

describe('EhrIconButton', () => {
  it('is a native button named only by its required aria-label', () => {
    const onClick = vi.fn()
    render(<EhrIconButton aria-label="Print summary" icon={<svg data-testid="printer" />} onClick={onClick} />)
    const button = screen.getByRole('button', { name: 'Print summary' })
    expect(button.tagName).toBe('BUTTON')
    expect(button.getAttribute('type')).toBe('button')
    expect(button.classList.contains('hid-ehr-icon-button')).toBe(true)
    expect(screen.getByTestId('printer').closest('[aria-hidden="true"]')).not.toBeNull()
    fireEvent.click(button)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('carries aria-expanded when it discloses something, and the disabled and busy states', () => {
    const { rerender } = render(<EhrIconButton aria-label="Filters" aria-expanded={false} icon={<svg />} />)
    expect(screen.getByRole('button', { name: 'Filters' }).getAttribute('aria-expanded')).toBe('false')
    rerender(<EhrIconButton aria-label="Filters" disabled icon={<svg />} />)
    expect((screen.getByRole('button', { name: 'Filters' }) as HTMLButtonElement).disabled).toBe(true)
    rerender(<EhrIconButton aria-label="Filters" busy icon={<svg />} />)
    expect(screen.getByRole('button', { name: 'Filters' }).getAttribute('aria-busy')).toBe('true')
  })
})
