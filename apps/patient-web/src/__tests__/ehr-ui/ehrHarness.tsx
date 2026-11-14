import { useState, type ReactNode } from 'react'
import { vi } from 'vitest'
import { EhrAppShell, EhrSidebar, EhrTopBar, type EhrNavGroup } from '@hid/ui/ehr'

/** Fictional navigation for a fictional hospital. */
export const NAV_GROUPS: readonly EhrNavGroup[] = [
  {
    id: 'care',
    label: 'Care',
    items: [
      { id: 'patients', label: 'Patients', href: '/ehr/patients' },
      { id: 'appointments', label: 'Appointments', href: '/ehr/appointments' },
    ],
  },
  {
    id: 'facility',
    label: 'Facility',
    items: [
      { id: 'staff', label: 'Staff', href: '/ehr/staff' },
      { id: 'settings', label: 'Facility settings', href: '/ehr/settings' },
    ],
  },
]

/** An EhrAppShell with a sidebar and a top bar, as a screen would use it. */
export function ShellHarness({ children }: { readonly children?: ReactNode }) {
  return (
    <EhrAppShell
      sidebar={(
        <EhrSidebar
          groups={NAV_GROUPS}
          currentId="patients"
          brand={<span>Health ID</span>}
          product="Hospital EHR"
          // jsdom cannot navigate; an app would route here.
          onNavigate={(_, event) => event.preventDefault()}
        />
      )}
      topBar={<EhrTopBar start={<strong>Riverside Teaching Hospital (fictional)</strong>} />}
    >
      {children}
    </EhrAppShell>
  )
}

/** Opens and closes `render(open, setOpen)` from a plain button named `label`. */
export function Opener({ label, render }: { readonly label: string; readonly render: (open: boolean, setOpen: (open: boolean) => void) => ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>{label}</button>
      {render(open, setOpen)}
    </>
  )
}

/**
 * Spies on `element.focus()` and records, at the moment of each call, the
 * inert ancestor the element had. A browser ignores focus() inside an inert
 * subtree, which jsdom does not, so a passing "focus came back" proves nothing
 * unless that ancestor was already gone when focus() ran.
 */
export function spyOnFocus(element: HTMLElement) {
  const inertAtCall: (Element | null)[] = []
  const focus = HTMLElement.prototype.focus
  const spy = vi.spyOn(element, 'focus').mockImplementation((options?: FocusOptions) => {
    inertAtCall.push(element.closest('[inert]'))
    focus.call(element, options)
  })
  return { spy, inertAtCall }
}

export function workspace(): HTMLElement {
  const element = document.querySelector<HTMLElement>('.hid-ehr-workspace')
  if (!element) throw new Error('no EHR workspace rendered')
  return element
}
