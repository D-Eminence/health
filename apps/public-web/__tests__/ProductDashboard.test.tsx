import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { ProductDashboard } from '@/components/shared/ProductDashboard'
import { PRODUCT_DETAILS, findProductDetail } from '@/content/product-details'
import { PRODUCTS } from '@/content/products'

function detail(slug: string) {
  const product = findProductDetail(slug)
  if (!product) throw new Error(`No product detail for "${slug}"`)
  return product
}

describe('product detail content', () => {
  it('covers every product in the catalogue', () => {
    const catalogue = PRODUCTS.map(product => product.slug).sort()
    const details = PRODUCT_DETAILS.map(product => product.slug).sort()
    expect(details).toEqual(catalogue)
  })

  it('gives every product a dashboard and four metrics', () => {
    for (const product of PRODUCT_DETAILS) {
      expect(product.metrics).toHaveLength(4)
      expect(product.dash.length).toBeGreaterThan(3)
    }
  })

  it('gives every product workflows and integrations', () => {
    for (const product of PRODUCT_DETAILS) {
      expect(product.workflows.length).toBeGreaterThanOrEqual(4)
      expect(product.integrations.length).toBeGreaterThanOrEqual(3)
      expect(product.narrativeBody.length).toBeGreaterThanOrEqual(1)
    }
  })

  it('gives every product at least one panel beyond the metrics', () => {
    for (const product of PRODUCT_DETAILS) {
      const panels = [
        product.table,
        product.alerts,
        product.lists,
        product.stages,
        product.profile,
        product.timeline,
        product.progress,
      ].filter(Boolean)
      expect(panels.length).toBeGreaterThanOrEqual(1)
    }
  })
})

describe('ProductDashboard', () => {
  it('renders as a single labelled image rather than a wall of decorative cells', () => {
    render(<ProductDashboard product={detail('ehr')} />)

    const figure = screen.getByRole('img')
    expect(figure.getAttribute('aria-label')).toContain('Health ID EHR')
    // The interior is hidden, so assistive technology hears the label only.
    expect(within(figure).queryByRole('table')).toBeNull()
  })

  it('shows the metrics for the module it is given', () => {
    const { container } = render(<ProductDashboard product={detail('ehr')} />)

    expect(container.textContent).toContain('Encounters')
    expect(container.textContent).toContain('Recent encounters')
  })

  it('renders a pipeline for the laboratory, which has stages', () => {
    const product = detail('laboratory')
    expect(product.stages).toBeDefined()

    const { container } = render(<ProductDashboard product={product} />)
    expect(container.textContent).toContain('Investigation pipeline')
    expect(container.textContent).toContain('Sample collected')
  })

  it('renders dispensing lists for the pharmacy, which has no alerts panel', () => {
    const product = detail('pharmacy')
    expect(product.lists).toBeDefined()
    expect(product.alerts).toBeUndefined()

    const { container } = render(<ProductDashboard product={product} />)
    expect(container.textContent).toContain('Dispensing details')
    expect(container.textContent).toContain('Work item states')
  })

  it('renders a profile and activity for identity, which has no table', () => {
    const product = detail('identity')
    expect(product.table).toBeUndefined()

    const { container } = render(<ProductDashboard product={product} />)
    expect(container.textContent).toContain('Patient identity')
    expect(container.textContent).toContain('Identity activity')
  })

  it('sizes migration progress segments by share of the total', () => {
    const product = detail('migrate')
    const progress = product.progress
    expect(progress).toBeDefined()

    const { container } = render(<ProductDashboard product={product} />)
    const bar = container.querySelector('.h-2\\.5.overflow-hidden')
    expect(bar).not.toBeNull()

    const widths = [...(bar?.children ?? [])].map(child =>
      Number.parseFloat((child as HTMLElement).style.width),
    )
    expect(widths).toHaveLength(progress?.segments.length ?? 0)
    expect(widths.reduce((sum, width) => sum + width, 0)).toBeCloseTo(100, 5)
  })

  it('renders every product without throwing', () => {
    for (const product of PRODUCT_DETAILS) {
      expect(() => render(<ProductDashboard product={product} />)).not.toThrow()
    }
  })
})
