import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ReactElement } from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Field, Input, Select, Textarea } from '@hid/ui'

/**
 * PEHR-14 (WCAG 1.3.1 and 3.3.1). Field rendered its hint and its error with
 * ids (`${htmlFor}-hint`, `${htmlFor}-error`) but never gave them to the
 * control, so a screen reader heard neither unless the caller wired
 * aria-describedby by hand, which only two callers did. The outreach campaign
 * hint and the public site's 'Provided by the registry' were never announced.
 */

const describedText = (element: HTMLElement) => (element.getAttribute('aria-describedby') ?? '').split(' ')
  .map(id => document.getElementById(id)?.textContent ?? `(no #${id})`).join(' ')

type ControlProps = { invalid?: boolean; 'aria-describedby'?: string }
const controls: [string, string, (props: ControlProps) => ReactElement][] = [
  ['Input', 'textbox', props => <Input id="campaign" {...props} />],
  ['Textarea', 'textbox', props => <Textarea id="campaign" {...props} />],
  ['Select', 'combobox', props => <Select id="campaign" {...props}><option>None</option></Select>],
]

const HINT = 'Only active campaigns appear here.'
const ERROR = 'Choose a campaign.'

describe('PEHR-14: a Field describes its control', () => {
  it.each(controls)('%s: by its hint', (_, role, control) => {
    render(<Field label="Campaign" htmlFor="campaign" hint={HINT}>{control({})}</Field>)
    const element = screen.getByRole(role, { name: 'Campaign' })
    expect(element.getAttribute('aria-describedby')).toBe('campaign-hint')
    expect(describedText(element)).toBe(HINT)
    expect(element.getAttribute('aria-invalid')).toBeNull()
  })

  it.each(controls)('%s: by its error, which replaces the hint and marks the control invalid', (_, role, control) => {
    render(<Field label="Campaign" htmlFor="campaign" hint={HINT} error={ERROR}>{control({})}</Field>)
    const element = screen.getByRole(role, { name: 'Campaign' })
    expect(element.getAttribute('aria-describedby')).toBe('campaign-error')
    expect(describedText(element)).toBe(ERROR)
    expect(element.getAttribute('aria-invalid')).toBe('true')
    expect(element.classList.contains('border-critical')).toBe(true)
  })

  it.each(controls)('%s: names an id once when the caller names it too', (_, role, control) => {
    // Patients and OCR wire their errors by hand; the result must not repeat the error.
    render(<Field label="Campaign" htmlFor="campaign" error={ERROR}>{control({ invalid: true, 'aria-describedby': 'campaign-error' })}</Field>)
    expect(screen.getByRole(role, { name: 'Campaign' }).getAttribute('aria-describedby')).toBe('campaign-error')
  })

  it('keeps a description the caller adds', () => {
    render(<><p id="campaign-note">Visible to the whole team.</p>
      <Field label="Campaign" htmlFor="campaign" hint={HINT}><Input id="campaign" aria-describedby="campaign-note" /></Field></>)
    const element = screen.getByRole('textbox', { name: 'Campaign' })
    expect(element.getAttribute('aria-describedby')).toBe('campaign-hint campaign-note')
    expect(describedText(element)).toBe(`${HINT} Visible to the whole team.`)
  })

  it('adds nothing to a Field with neither hint nor error, or to a control outside a Field', () => {
    render(<><Field label="Name" htmlFor="name"><Input id="name" /></Field><Input aria-label="Search" aria-describedby="search-help" /></>)
    const name = screen.getByRole('textbox', { name: 'Name' })
    expect(name.getAttribute('aria-describedby')).toBeNull()
    expect(name.getAttribute('aria-invalid')).toBeNull()
    expect(screen.getByRole('textbox', { name: 'Search' }).getAttribute('aria-describedby')).toBe('search-help')
  })
})

describe('React Server Components can still import @hid/ui', () => {
  // The public site renders @hid/ui from server components, whose React build has
  // no createContext and no state or effect hooks: a module that uses them must
  // declare 'use client', as Toast, Tabs and CommandPalette do.
  const here = dirname(fileURLToPath(import.meta.url))
  const ui = resolve(here, '../../../../packages/ui/src')
  const modules = readdirSync(ui).filter(file => file.endsWith('.tsx')).map(file => [file, readFileSync(join(ui, file), 'utf8')] as const)
  const CLIENT_ONLY = /\b(?:createContext|useContext|useState|useReducer|useEffect|useLayoutEffect|useRef|useSyncExternalStore|useImperativeHandle|useTransition|useOptimistic|useActionState)\b/

  it.each(modules)('%s', (_, source) => {
    if (CLIENT_ONLY.test(source)) expect(source.trimStart().startsWith("'use client'")).toBe(true)
  })
})
