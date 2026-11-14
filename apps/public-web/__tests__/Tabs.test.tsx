import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { fireEvent } from '@testing-library/dom'
import { ProductsSection } from '@/components/provider/Products'
import { MODULES } from '@/content/modules'
import { findProduct } from '@/content/products'
import { ROUTES } from '@/content/site'

function tab(name: string | RegExp) {
  return screen.getByRole('tab', { name })
}

function moduleFor(slug: string) {
  const found = MODULES.find(entry => entry.slug === slug)
  if (!found) throw new Error(`No module in the design with the slug "${slug}"`)
  return found
}

const FIRST = MODULES[0]
const LAST = MODULES[MODULES.length - 1]

if (!FIRST || !LAST) throw new Error('The module list needs at least one entry')

/**
 * The module switcher.
 *
 * Tested against the design's content rather than a hard-coded list, so adding a
 * module does not mean editing the test, and removing one cannot leave a tab
 * behind. The section is transcribed from the approved design, so what is
 * asserted here is the design's structure: a segmented strip, the claim, the
 * product-specific miniature workflow, and the caption.
 */
describe('ProductsSection', () => {
  it('offers a segment for every module, in the design’s order', () => {
    render(<ProductsSection />)

    const labels = screen.getAllByRole('tab').map(element => element.textContent)
    expect(labels).toEqual(MODULES.map(entry => entry.tab))
  })

  it('opens on identity', () => {
    render(<ProductsSection />)

    expect(tab(FIRST.tab).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByText(FIRST.statement)).toBeDefined()
  })

  it('shows the claim, the panel and the caption for the chosen module', () => {
    render(<ProductsSection />)

    expect(screen.getByText(FIRST.statement)).toBeDefined()
    expect(screen.getByText(FIRST.caption)).toBeDefined()
    expect(screen.getByText(FIRST.panelTitle)).toBeDefined()
    expect(screen.getByText(FIRST.panelBadge)).toBeDefined()
  })

  it('gives the panel the active module’s status rows', () => {
    render(<ProductsSection />)

    for (const row of FIRST.rows) {
      expect(screen.getByText(row.label)).toBeDefined()
      expect(screen.getByText(row.value)).toBeDefined()
    }
  })

  it('swaps the claim, the panel and the caption when another module is chosen', () => {
    render(<ProductsSection />)

    const laboratory = moduleFor('laboratory')
    fireEvent.click(tab(laboratory.tab))

    expect(screen.getByText(laboratory.statement)).toBeDefined()
    expect(screen.getByText(laboratory.panelTitle)).toBeDefined()
    expect(screen.queryByText(FIRST.statement)).toBeNull()
    expect(screen.queryByText(FIRST.panelTitle)).toBeNull()
  })

  it('replays the body for every choice rather than only on first paint', () => {
    const { container } = render(<ProductsSection />)

    const body = () => container.querySelector('.tab-fade')
    expect(body()).not.toBeNull()

    const before = body()
    fireEvent.click(tab(moduleFor('migrate').tab))

    // A remount is what replays the design's fade-and-rise, so the node is a
    // different one after the switch.
    expect(body()).not.toBe(before)
  })

  it('points every module at the product page for its slug', () => {
    render(<ProductsSection />)

    for (const entry of MODULES) {
      fireEvent.click(tab(entry.tab))

      const product = findProduct(entry.slug)
      expect(product).toBeDefined()

      const link = within(screen.getByRole('tabpanel')).getByRole('link')
      expect(link.getAttribute('href')).toBe(ROUTES.product(entry.slug))
    }
  })

  it('moves between modules with the arrow keys', () => {
    render(<ProductsSection />)

    const list = screen.getByRole('tablist', { name: /health id modules/i })
    fireEvent.keyDown(list, { key: 'ArrowRight' })

    const second = MODULES[1]
    if (!second) throw new Error('The module list needs at least two entries for this test')

    expect(tab(second.tab).getAttribute('aria-selected')).toBe('true')
    expect(tab(FIRST.tab).getAttribute('aria-selected')).toBe('false')
  })

  it('wraps from the first module back to the last', () => {
    render(<ProductsSection />)

    const list = screen.getByRole('tablist', { name: /health id modules/i })
    fireEvent.keyDown(list, { key: 'ArrowLeft' })

    expect(tab(LAST.tab).getAttribute('aria-selected')).toBe('true')
  })

  it('jumps to the ends with Home and End', () => {
    render(<ProductsSection />)
    const list = screen.getByRole('tablist', { name: /health id modules/i })

    fireEvent.keyDown(list, { key: 'End' })
    expect(tab(LAST.tab).getAttribute('aria-selected')).toBe('true')

    fireEvent.keyDown(list, { key: 'Home' })
    expect(tab(FIRST.tab).getAttribute('aria-selected')).toBe('true')
  })

  it('keeps exactly one module in the tab order', () => {
    render(<ProductsSection />)

    const reachable = screen
      .getAllByRole('tab')
      .filter(element => element.getAttribute('tabindex') === '0')
    expect(reachable).toHaveLength(1)
  })

  it('pairs the panel with the tab that controls it', () => {
    render(<ProductsSection />)

    const panel = screen.getByRole('tabpanel')
    const selected = tab(FIRST.tab)
    expect(panel.getAttribute('aria-labelledby')).toBe(selected.id)
    expect(selected.getAttribute('aria-controls')).toBe(panel.id)
  })
})
