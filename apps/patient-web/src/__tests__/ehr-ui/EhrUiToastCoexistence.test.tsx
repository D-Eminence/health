import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ToastProvider, toast } from '@hid/ui'
import { EhrDrawer } from '@hid/ui/ehr'
import { Opener, ShellHarness, workspace } from './ehrHarness'

/**
 * The EHR adds no toasts of its own. The live ToastProvider wraps the app as
 * main.tsx mounts it, so its one region renders after the EHR shell, outside
 * `.hid-ehr` and outside anything the shell makes inert. The shell isolates
 * its stacking context, so that region (z-index var(--z-toast)) paints above
 * every EHR layer.
 */

beforeEach(() => {
  act(() => toast.dismiss())
})

afterEach(() => {
  act(() => toast.dismiss())
})

describe('EHR shell beside the live toasts', () => {
  it('leaves one toast region, outside .hid-ehr and never inert, while a drawer is open', () => {
    render(
      <ToastProvider>
        <ShellHarness>
          <Opener label="Show admission notes" render={(open, setOpen) => (
            <EhrDrawer open={open} title="Admission notes" onClose={() => setOpen(false)}>
              <p>Fictional notes.</p>
            </EhrDrawer>
          )} />
        </ShellHarness>
      </ToastProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Show admission notes' }))
    expect(workspace().getAttribute('inert')).toBe('')

    act(() => {
      toast.success('Notes saved')
    })

    const regions = document.querySelectorAll('.waya-toast-region')
    expect(regions).toHaveLength(1)
    const region = regions[0]!
    expect(region.textContent).toContain('Notes saved')
    expect(region.closest('.hid-ehr')).toBeNull()
    expect(region.closest('[inert]')).toBeNull()
  })
})
