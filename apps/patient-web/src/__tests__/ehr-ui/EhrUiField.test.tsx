import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { EhrField, EhrInput, EhrSelect, EhrTextarea } from '@hid/ui/ehr'

/**
 * EhrField: a visible label tied to its control, a hint and an error tied by
 * aria-describedby, aria-invalid in error, and the error written as text.
 */

const described = (element: HTMLElement) => (element.getAttribute('aria-describedby') ?? '').split(' ')
  .map(id => document.getElementById(id)?.textContent ?? `(no #${id})`).join(' | ')

describe('EhrField', () => {
  it('ties a visible label to its input, which carries the control border class', () => {
    render(<EhrField label="Ward name"><EhrInput /></EhrField>)
    const input = screen.getByRole('textbox', { name: 'Ward name' })
    expect(input.tagName).toBe('INPUT')
    expect(input.classList.contains('hid-ehr-control')).toBe(true)
    expect(screen.getByText('Ward name').tagName).toBe('LABEL')
    expect(input.getAttribute('aria-describedby')).toBeNull()
    expect(input.getAttribute('aria-invalid')).toBeNull()
  })

  it('names its control by the label when the field chooses the id, and when the control brings its own', () => {
    render(
      <>
        <EhrField label="Ward code" controlId="ward-code"><EhrInput /></EhrField>
        <EhrField label="Ward phone"><EhrInput id="ward-phone-own" /></EhrField>
        <EhrInput id="ward-search" aria-label="Search wards" />
      </>,
    )
    expect(screen.getByLabelText('Ward code').id).toBe('ward-code')
    // The field's id wins over the control's own, so the label never points at nothing.
    const phone = screen.getByLabelText('Ward phone')
    expect(phone.tagName).toBe('INPUT')
    expect(screen.getByText('Ward phone').getAttribute('for')).toBe(phone.id)
    // A control outside a field keeps its own id.
    expect(screen.getByRole('textbox', { name: 'Search wards' }).id).toBe('ward-search')
  })

  it('describes its control by the hint', () => {
    render(<EhrField label="Bed count" hint="Count only beds in use."><EhrInput inputMode="numeric" /></EhrField>)
    const input = screen.getByRole('textbox', { name: 'Bed count' })
    expect(described(input)).toBe('Count only beds in use.')
    expect(input.getAttribute('aria-invalid')).toBeNull()
  })

  it('marks the control invalid and describes it by the error, in words, then the hint', () => {
    render(<EhrField label="Bed count" hint="Count only beds in use." error="Enter a number from 1 to 400."><EhrInput /></EhrField>)
    const input = screen.getByRole('textbox', { name: 'Bed count' })
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(described(input)).toBe('Enter a number from 1 to 400. | Count only beds in use.')
    const error = screen.getByText('Enter a number from 1 to 400.')
    // The design's plain line under the control: the words say it, not colour alone, and no icon.
    expect(error.classList.contains('hid-ehr-error')).toBe(true)
    expect(error.querySelector('svg')).toBeNull()
  })

  it('works the same for a select and a textarea', () => {
    render(
      <>
        <EhrField label="Department" error="Choose a department."><EhrSelect><option>Surgery</option></EhrSelect></EhrField>
        <EhrField label="Handover note" hint="Visible to the next shift."><EhrTextarea /></EhrField>
      </>,
    )
    const select = screen.getByRole('combobox', { name: 'Department' })
    expect(select.getAttribute('aria-invalid')).toBe('true')
    expect(described(select)).toBe('Choose a department.')
    const textarea = screen.getByRole('textbox', { name: 'Handover note' })
    expect(textarea.tagName).toBe('TEXTAREA')
    expect(described(textarea)).toBe('Visible to the next shift.')
  })

  it('keeps a description and an id the caller gives the control', () => {
    render(
      <>
        <p id="ward-policy">Wards follow the facility naming policy.</p>
        <EhrField label="Ward name" hint="Up to 40 characters."><EhrInput aria-describedby="ward-policy" /></EhrField>
      </>,
    )
    const input = screen.getByRole('textbox', { name: 'Ward name' })
    expect(described(input)).toBe('Up to 40 characters. | Wards follow the facility naming policy.')
  })

  it('keeps the value typed and supports the disabled state', () => {
    render(<><EhrField label="Surname"><EhrInput defaultValue="" /></EhrField><EhrField label="Record number"><EhrInput disabled /></EhrField></>)
    const input = screen.getByRole('textbox', { name: 'Surname' }) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Okafor-Test' } })
    expect(input.value).toBe('Okafor-Test')
    expect((screen.getByRole('textbox', { name: 'Record number' }) as HTMLInputElement).disabled).toBe(true)
  })

  it('leaves a control outside a field as the caller made it', () => {
    render(<EhrInput aria-label="Search patients" />)
    const input = screen.getByRole('textbox', { name: 'Search patients' })
    expect(input.getAttribute('aria-describedby')).toBeNull()
    expect(input.getAttribute('aria-invalid')).toBeNull()
  })
})
