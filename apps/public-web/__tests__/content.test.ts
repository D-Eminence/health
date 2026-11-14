import { describe, expect, it } from 'vitest'
import { PRODUCTS, findProduct } from '../content/products'
import { PRODUCT_DETAILS } from '../content/product-details'
import { AUDIENCES, ROUTES, SOLUTION_AUDIENCES, TRUST } from '../content/site'
import { PATIENT_FAQ, PATIENT_JOURNEY } from '../content/patient'
import { PRIVACY_PAGE, SOLUTIONS_PAGE } from '../content/pages'
import { formatPublicPrice, parsePublicPrices } from '../lib/commercial-api'
import {
  toDemoSubmission,
  validateDemoRequest,
  type DemoRequest,
} from '../lib/demo-request'

describe('product catalogue', () => {
  it('has a unique slug for every product', () => {
    const slugs = PRODUCTS.map(product => product.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
  })

  it('uses URL-safe slugs, since they are public addresses', () => {
    for (const product of PRODUCTS) {
      expect(product.slug).toMatch(/^[a-z0-9-]+$/)
    }
  })

  it('lists the products in the order every surface presents them', () => {
    expect(PRODUCTS.map(product => product.slug)).toEqual([
      'identity',
      'ehr',
      'migrate',
      'laboratory',
      'pharmacy',
      'outreach',
      'api',
    ])
  })

  it('gives every product the copy each surface needs', () => {
    for (const product of PRODUCTS) {
      expect(product.name.startsWith('Health ID')).toBe(true)
      expect(product.mark).toHaveLength(2)
      expect(product.summary.length).toBeGreaterThan(10)
      expect(product.body.length).toBeGreaterThan(30)
      expect(product.capabilities.length).toBeGreaterThanOrEqual(3)
    }
  })

  it('finds a product by slug and reports an unknown one', () => {
    expect(findProduct('ehr')?.name).toBe('Health ID EHR')
    expect(findProduct('cardiology')).toBeUndefined()
  })
})

describe('pharmacy product', () => {
  // A pharmacist cannot write prescriptions (P4c SPEC-FINAL §13.7): the pharmacy receives them from clinicians.
  it('says a pharmacy receives the prescriptions Health ID clinicians send, and never that it creates them', () => {
    const pharmacy = PRODUCT_DETAILS.find(product => product.slug === 'pharmacy')
    expect(pharmacy?.workflows.find(workflow => workflow.title === 'Prescription management')?.body)
      .toBe('Receive prescriptions that Health ID clinicians send you, and record what you dispense.')
    expect(JSON.stringify(pharmacy)).not.toMatch(/create new prescriptions|walk-in patients/i)
  })
})

describe('homepage content', () => {
  it('carries the approved partner label and real-logo roster', () => {
    expect(TRUST.label).toBe('In partnership with')
    expect(TRUST.organisations).toEqual([
      'Kolekto',
      'Ilorin Innovation Hub',
      'iDICE Startup Bridge',
      'Amazon Web Services',
    ])
  })
})

describe('solutions content', () => {
  it('gives every navigation entry a section that exists', () => {
    expect(SOLUTIONS_PAGE.audiences.map(audience => audience.id)).toEqual(
      SOLUTION_AUDIENCES.map(audience => audience.id),
    )
  })

  it('links only to products that exist', () => {
    const ids = SOLUTIONS_PAGE.audiences.map(audience => audience.id)

    expect(new Set(ids).size).toBe(ids.length)
    for (const audience of SOLUTIONS_PAGE.audiences) {
      expect(ROUTES.solution(audience.id)).toBe(`/solutions#${audience.id}`)
      expect(audience.points.length).toBeGreaterThanOrEqual(3)
      for (const slug of audience.products) {
        expect(findProduct(slug)).toBeDefined()
      }
    }
  })
})

describe('privacy notice', () => {
  // "Setup Your Facility" is facility self sign-up on production (Novu, P4): finishing it makes the administrator's staff
  // account at once, and support reviews the facility afterwards (P4b leftover 4).
  it('says what facility sign-up creates, never that it creates no staff account', () => {
    const point = PRIVACY_PAGE.points.find(item => item.title === 'Organization applications')
    expect(point?.body).not.toMatch(/does not create a staff account/)
    expect(point?.body).toContain('When the administrator confirms their email with the code and chooses a password, facility '
      + 'sign-up creates the facility and the administrator’s staff account straight away; Health ID support then reviews '
      + 'every new facility.')
  })
})

describe('audience routing', () => {
  it('sends each audience to its own landing page', () => {
    const byId = Object.fromEntries(AUDIENCES.map(audience => [audience.id, audience.href]))
    expect(byId.patient).toBe(ROUTES.patients)
    expect(byId.provider).toBe(ROUTES.providers)
  })

  it('offers exactly the two audiences the platform serves', () => {
    expect(AUDIENCES.map(audience => audience.id)).toEqual(['patient', 'provider'])
  })
})

describe('pricing', () => {
  it('keeps quote prices as quotes and uses minor units for fixed prices', () => {
    const prices = parsePublicPrices({ data: [
      { product_slug: 'ehr', context: 'core', visibility: 'contact_sales', amount_minor: null, currency: 'NGN', billing_period: null, unit: null },
      { product_slug: 'pharmacy', context: 'standalone', visibility: 'fixed', amount_minor: 1250000, currency: 'NGN', billing_period: 'monthly', unit: 'facility' },
    ] })
    expect(formatPublicPrice(prices[0]!)).toBe('Contact sales')
    expect(formatPublicPrice(prices[1]!)).toContain('12,500')
  })

  it('rejects contradictory backend pricing instead of inventing an amount', () => {
    expect(() => parsePublicPrices({ data: [
      { product_slug: 'ehr', context: 'core', visibility: 'fixed', amount_minor: null, currency: 'NGN', billing_period: null, unit: null },
    ] })).toThrow(/Pricing is temporarily unavailable/)
  })

  // hid-system allows any product slug matching ^[a-z][a-z0-9-]{1,63}$ and lists
  // every active product, so a product added by a later migration appears here.
  it('keeps the products it knows when the catalogue lists one it does not', () => {
    const prices = parsePublicPrices({ data: [
      { product_slug: 'ehr', context: 'core', visibility: 'contact_sales', amount_minor: null, currency: 'NGN', billing_period: null, unit: null },
      { product_slug: 'insurance', context: 'core', visibility: 'fixed', amount_minor: 990000, currency: 'NGN', billing_period: 'monthly', unit: 'facility' },
      // A slug that names an object property is no product the site knows either.
      { product_slug: 'constructor', context: 'core', visibility: 'contact_sales', amount_minor: null, currency: 'NGN', billing_period: null, unit: null },
    ] })
    expect(prices).toEqual([
      { product_slug: 'ehr', context: 'core', visibility: 'contact_sales', amount_minor: null, currency: 'NGN', billing_period: null, unit: null },
    ])
  })

  it('still refuses the whole catalogue when a row it cannot trust is malformed, whatever its product', () => {
    for (const malformed of [
      { product_slug: 'insurance', context: 'core', visibility: 'fixed', amount_minor: null, currency: 'NGN', billing_period: null, unit: null },
      { product_slug: 'insurance', context: 'core', visibility: 'fixed', amount_minor: 100, currency: 'naira', billing_period: null, unit: null },
      { product_slug: 42, context: 'core', visibility: 'contact_sales', amount_minor: null, currency: 'NGN', billing_period: null, unit: null },
      { product_slug: 'ehr', context: 'core', visibility: 'free', amount_minor: null, currency: 'NGN', billing_period: null, unit: null },
    ]) {
      expect(() => parsePublicPrices({ data: [
        { product_slug: 'pharmacy', context: 'standalone', visibility: 'custom_quote', amount_minor: null, currency: 'NGN', billing_period: null, unit: null },
        malformed,
      ] })).toThrow(/Pricing is temporarily unavailable/)
    }
  })
})

describe('demo request', () => {
  const valid: DemoRequest = {
    service: 'ehr',
    role: 'Doctor',
    otherRole: '',
    facility: 'Prime Hospital',
    contactName: 'Amaka Eze',
    email: 'amaka@example.com',
    phone: '',
    notes: '',
  }

  it('accepts an enquiry with the fields needed to reply', () => {
    expect(validateDemoRequest(valid)).toEqual({})
  })

  it('requires a facility, a name and an email', () => {
    const errors = validateDemoRequest({ ...valid, facility: '', contactName: '', email: '' })
    expect(Object.keys(errors).sort()).toEqual(['contactName', 'email', 'facility'])
  })

  it('rejects an email that cannot receive a reply', () => {
    expect(validateDemoRequest({ ...valid, email: 'amaka@' }).email).toBeDefined()
  })

  it('does not require a phone number, which would cost us real enquiries', () => {
    expect(validateDemoRequest({ ...valid, phone: '' }).phone).toBeUndefined()
  })

  it('treats whitespace as empty', () => {
    expect(validateDemoRequest({ ...valid, facility: '   ' }).facility).toBeDefined()
  })

  // hid-system CreateDemoRequestDto.contactRole: trimmed, 2 to 120 characters.
  it('accepts only a role the backend accepts', () => {
    expect(validateDemoRequest({ ...valid, role: 'X' }).role).toBeDefined()
    expect(validateDemoRequest({ ...valid, role: ' X ' }).role).toBeDefined()
    expect(validateDemoRequest({ ...valid, role: 'x'.repeat(121) }).role).toBeDefined()
    expect(validateDemoRequest({ ...valid, role: 'GP' }).role).toBeUndefined()
    expect(validateDemoRequest({ ...valid, role: ` ${'x'.repeat(120)} ` }).role).toBeUndefined()
  })

  it('holds a role given under Other to the same bounds, since that is the role sent', () => {
    expect(validateDemoRequest({ ...valid, role: 'Other', otherRole: 'X' }).otherRole).toBeDefined()
    expect(validateDemoRequest({ ...valid, role: 'Other', otherRole: 'x'.repeat(121) }).otherRole).toBeDefined()
    expect(validateDemoRequest({ ...valid, role: 'Other', otherRole: 'Matron' })).toEqual({})
  })

  it('maps the form to the backend contract without including URL queries', () => {
    const body = toDemoSubmission(valid, { sourcePage: '/contact', sourceSection: 'contact-card', ctaLabel: 'Book a demo' }, 'token')
    expect(body).toMatchObject({
      contactName: 'Amaka Eze', contactEmail: 'amaka@example.com', productCode: 'ehr',
      organizationName: 'Prime Hospital', turnstileAction: 'book-demo', turnstileToken: 'token',
      sourcePage: '/contact',
    })
    expect(JSON.stringify(body)).not.toContain('pageUrl')
  })
})

describe('patient content', () => {
  it('gives every FAQ entry an answer', () => {
    for (const item of PATIENT_FAQ.items) {
      expect(item.question.endsWith('?')).toBe(true)
      expect(item.answer.length).toBeGreaterThan(30)
    }
  })

  it('tells the journey in order, ending with the patient in control', () => {
    const moments = PATIENT_JOURNEY.moments.map(moment => moment.when)
    expect(moments).toEqual(['January', 'February', 'April', 'Today'])
  })
})
