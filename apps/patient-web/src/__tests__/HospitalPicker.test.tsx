import { describe, expect, it } from 'vitest'
import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { HospitalPicker, loadFacilities, suggest, type Facility } from '../routes/enrollment/HospitalPicker'

const facility = (name: string): Facility => ({ name, state: 'Lagos', type: 'General Hospital' })

function Field({ initial = '' }: { initial?: string }) {
  const [value, setValue] = useState(initial)
  return <>
    <label htmlFor="hospital">Hospital you currently use (optional)</label>
    <HospitalPicker id="hospital" value={value} onChange={setValue} />
  </>
}

describe('the hospital picker (hid-1.0 directory)', () => {
  it('loads every facility from the directory once', async () => {
    const facilities = await loadFacilities()
    expect(facilities.length).toBe(26357)
    expect(facilities).toContainEqual({ name: 'Aba General Hospital', state: 'Abia', type: 'General Hospital' })
    expect(await loadFacilities()).toBe(facilities)
  })

  it('suggests names that start with the text first, then names that contain it, at most eight', () => {
    const facilities = ['General Hospital, Ikeja', 'Ikeja Medical Centre', 'Lagos General', 'Ikeja Clinic'].map(facility)
    expect(suggest(facilities, 'ikeja').map(found => found.name)).toEqual(['Ikeja Medical Centre', 'Ikeja Clinic', 'General Hospital, Ikeja'])
    expect(suggest(facilities, ' i ')).toEqual([])
    expect(suggest(Array.from({ length: 20 }, (_, index) => facility(`Clinic ${index}`)), 'clinic')).toHaveLength(8)
  })

  it('offers directory names as the person types; arrow keys and Enter pick one', async () => {
    render(<Field />)
    const input = screen.getByRole('combobox', { name: 'Hospital you currently use (optional)' })
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'Aba Gen' } })

    const option = await screen.findByRole('option', { name: /Aba General Hospital/ })
    expect(option.textContent).toContain('Abia · General Hospital')
    expect(input.getAttribute('aria-expanded')).toBe('true')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(input.getAttribute('aria-activedescendant')).toBe(option.id)
    fireEvent.keyDown(input, { key: 'Enter' })

    expect((input as HTMLInputElement).value).toBe('Aba General Hospital')
    expect(input.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('option')).toBeNull()
  })

  it('keeps a name that is not in the directory, and Escape closes the suggestions', async () => {
    render(<Field />)
    const input = screen.getByRole('combobox', { name: 'Hospital you currently use (optional)' })
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'Teaching Hospital' } })
    await screen.findAllByRole('option')
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByRole('option')).toBeNull()

    fireEvent.change(input, { target: { value: 'My local clinic zzz' } })
    expect((input as HTMLInputElement).value).toBe('My local clinic zzz')
    expect(screen.queryByRole('option')).toBeNull()
  })

  it('picks a suggestion with the pointer and closes when the pointer goes elsewhere', async () => {
    render(<Field />)
    const input = screen.getByRole('combobox', { name: 'Hospital you currently use (optional)' })
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'Nnamdi Azikiwe' } })
    const option = await screen.findByRole('option', { name: /Nnamdi Azikiwe University Teaching Hospital/ })
    // A touch that only scrolls the list presses no option: nothing is picked until the click.
    fireEvent.pointerDown(option)
    expect((input as HTMLInputElement).value).toBe('Nnamdi Azikiwe')
    fireEvent.click(option)
    expect((input as HTMLInputElement).value).toBe('Nnamdi Azikiwe University Teaching Hospital')

    fireEvent.change(input, { target: { value: 'Nnamdi' } })
    await screen.findAllByRole('option')
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('option')).toBeNull()
  })

  it('closes the suggestions when focus leaves the field', async () => {
    render(<Field />)
    const input = screen.getByRole('combobox', { name: 'Hospital you currently use (optional)' })
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'Aba Gen' } })
    await screen.findAllByRole('option')
    fireEvent.blur(input)
    expect(screen.queryByRole('option')).toBeNull()
    expect(input.getAttribute('aria-expanded')).toBe('false')
  })
})
