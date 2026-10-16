import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { App } from '../App'

/**
 * OCR-A11Y-09. While a workspace's code loads, the portal shows that it is
 * opening it. That screen was `<main role="status">`, and the explicit role
 * replaced the main landmark, so the page had none. It is now a main landmark
 * holding the status. The workspaces never finish loading here.
 */
vi.mock('../staff/App', () => new Promise(() => {}))
vi.mock('../staff/routes/ProviderEnrollment', () => new Promise(() => {}))
vi.mock('../admin/App', () => new Promise(() => {}))

describe('OCR-A11Y-09: opening a workspace', () => {
  it.each([
    ['/provider/ocr', 'Opening provider workspace…'],
    ['/provider/enroll', 'Opening provider enrollment…'],
    ['/admin', 'Opening platform workspace…'],
  ])('%s is a main landmark holding its status while it loads', (path, text) => {
    render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>)
    const status = within(screen.getByRole('main')).getByRole('status')
    expect(status.textContent).toBe(text)
  })
})
