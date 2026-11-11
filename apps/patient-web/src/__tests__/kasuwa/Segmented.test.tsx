import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Segmented } from '../../kasuwa/interactive'

/**
 * The shared one-of choice (role radiogroup), as on the sign-up contact step (Phone or Email): one Tab stop, the chosen
 * option, and the arrow keys, Home and End move the choice and focus with it, as the ARIA radio group pattern says.
 */
function Choice({ initial = 'phone' as 'phone' | 'email' | 'post' }) {
  const [value, setValue] = useState(initial)
  return <Segmented ariaLabel="How should we reach you?" value={value} onChange={setValue}
    options={[{ value: 'phone', label: 'Phone' }, { value: 'email', label: 'Email' }, { value: 'post', label: 'Post' }]} />
}

const option = (name: string) => screen.getByRole('radio', { name })

describe('the shared one-of choice', () => {
  it('is one Tab stop: the chosen option', () => {
    render(<Choice initial="email" />)
    expect(option('Email').tabIndex).toBe(0)
    expect(option('Phone').tabIndex).toBe(-1)
    expect(option('Post').tabIndex).toBe(-1)
  })

  it('moves the choice and focus with the arrow keys, wrapping at the ends', () => {
    render(<Choice />)
    option('Phone').focus()
    fireEvent.keyDown(option('Phone'), { key: 'ArrowRight' })
    expect(option('Email').getAttribute('aria-checked')).toBe('true')
    expect(document.activeElement).toBe(option('Email'))
    fireEvent.keyDown(option('Email'), { key: 'ArrowDown' })
    expect(document.activeElement).toBe(option('Post'))
    fireEvent.keyDown(option('Post'), { key: 'ArrowRight' })
    expect(document.activeElement).toBe(option('Phone'))
    expect(option('Phone').getAttribute('aria-checked')).toBe('true')
    fireEvent.keyDown(option('Phone'), { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(option('Post'))
    fireEvent.keyDown(option('Post'), { key: 'ArrowUp' })
    expect(document.activeElement).toBe(option('Email'))
    expect(option('Email').tabIndex).toBe(0)
  })

  it('goes to the first and last options with Home and End', () => {
    render(<Choice />)
    fireEvent.keyDown(option('Phone'), { key: 'End' })
    expect(document.activeElement).toBe(option('Post'))
    fireEvent.keyDown(option('Post'), { key: 'Home' })
    expect(document.activeElement).toBe(option('Phone'))
    expect(option('Phone').getAttribute('aria-checked')).toBe('true')
  })
})
