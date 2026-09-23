import { describe, expect, it } from 'vitest'
import { PRODUCTS, findProduct } from '../content/products'
import { AUDIENCES, ROUTES, SOLUTION_AUDIENCES, TRUST } from '../content/site'
import { PRICING } from '../content/provider'
import { PATIENT_FAQ, PATIENT_JOURNEY } from '../content/patient'
import { SOLUTIONS_PAGE } from '../content/pages'
import { annualSaving, annualTotal, monthlyRate } from '../lib/pricing'
import {
  buildDemoMailto,
  composeDemoEnquiry,
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
  it('leaves the monthly rate alone when billed monthly', () => {
    expect(monthlyRate(50_000, 'monthly')).toBe(50_000)
  })

  it('applies the stated 20% discount to the yearly rate', () => {
    expect(PRICING.yearlyDiscount).toBe(0.2)
    expect(monthlyRate(50_000, 'yearly')).toBe(40_000)
    expect(monthlyRate(75_000, 'yearly')).toBe(60_000)
  })

  it('matches the saving quoted on the page to the actual difference', () => {
    for (const plan of PRICING.plans) {
      const difference =
        annualTotal(plan.monthlyNaira, 'monthly') - annualTotal(plan.monthlyNaira, 'yearly')
      expect(annualSaving(plan.monthlyNaira)).toBe(difference)
    }
  })

  it('quotes the savings the design states', () => {
    expect(annualSaving(50_000)).toBe(120_000)
    expect(annualSaving(75_000)).toBe(180_000)
  })

  it('marks exactly one plan as most popular', () => {
    expect(PRICING.plans.filter(plan => plan.badge).length).toBe(1)
  })

  it('rounds to whole naira rather than showing kobo', () => {
    expect(Number.isInteger(monthlyRate(33_333, 'yearly'))).toBe(true)
  })
})

describe('demo request', () => {
  const valid: DemoRequest = {
    service: 'Health ID EHR',
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

  it('composes an enquiry naming the facility in the subject', () => {
    const { subject, body } = composeDemoEnquiry(valid)
    expect(subject).toBe('Demo request — Prime Hospital')
    expect(body).toContain('Full name: Amaka Eze')
    expect(body).toContain('Work email: amaka@example.com')
  })

  it('omits empty optional fields rather than sending blank lines', () => {
    const { body } = composeDemoEnquiry(valid)
    expect(body).not.toContain('Phone number:')
    expect(body).not.toContain('Additional note:')
  })

  it('percent-encodes the mailto so punctuation survives', () => {
    const mailto = buildDemoMailto({ ...valid, notes: 'We run two branches & a lab' })
    expect(mailto.startsWith('mailto:')).toBe(true)
    expect(mailto).toContain('%26')
    expect(mailto).not.toContain('\n')
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
