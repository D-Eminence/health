import { describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { useListAtBase } from '../../../ehr-blue/departments/parts/baseAddress'

/** A page that takes '/*' shows its list at its base, and an address with more after it goes back to the base. */
function Page() {
  const leaving = useListAtBase('insurance')
  return <p>{leaving ? 'leaving' : 'list'}</p>
}

function Where() {
  return <output data-testid="where">{useLocation().pathname}</output>
}

function open(path: string) {
  return render(<MemoryRouter initialEntries={[path]}><Where /><Routes><Route path="/provider/insurance/*" element={<Page />} /></Routes></MemoryRouter>)
}

describe('an address with more after the page\'s base', () => {
  it('goes back to the base, replacing the address, and never reads the id', async () => {
    open('/provider/insurance/5a180001')
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/provider/insurance'))
    expect(screen.getByText('list')).toBeDefined()
  })

  it('takes several segments back to the base too', async () => {
    open('/provider/insurance/5a180001/edit')
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/provider/insurance'))
  })

  it('goes back to the base however the address is cased, as the router matches it', async () => {
    open('/provider/Insurance/5a180001')
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/provider/Insurance'))
  })

  it('leaves the base itself as it is', () => {
    open('/provider/insurance')
    expect(screen.getByTestId('where').textContent).toBe('/provider/insurance')
    expect(screen.getByText('list')).toBeDefined()
  })

  it('leaves the base with a trailing slash as it is', () => {
    open('/provider/insurance/')
    expect(screen.getByTestId('where').textContent).toBe('/provider/insurance/')
    expect(screen.getByText('list')).toBeDefined()
  })
})
