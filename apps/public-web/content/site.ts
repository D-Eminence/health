/**
 * Site-wide content: routes, navigation and the copy shared between pages.
 *
 * Routes are named here rather than typed as string literals throughout the
 * components, so a change to a public address is one edit.
 */

export const ROUTES = {
  chooser: '/',
  providers: '/providers',
  patients: '/patients',
  products: '/products',
  providerApplication: '/provider/apply',
  providerCompletion: '/provider/complete',
  /**
   * Identity belongs to the patient journey, not a duplicate provider product page. A product with a site of its own
   * opens that site, whose front page is its product page (productSiteHref).
   */
  product: (slug: string) => (slug === 'identity' ? '/patients' : productSiteHref(slug) ?? `/products/${slug}`),
  pricing: '/pricing',
  solutions: '/solutions',
  /** One audience on the solutions page, as an anchor. */
  solution: (id: string) => `/solutions#${id}`,
  about: '/about',
  contact: '/contact',
  resources: '/resources',
  blog: '/blog',
  earn: '/earn',
  blogPost: (slug: string) => `/blog/${slug}`,
  documentation: '/resources/documentation',
  security: '/resources/security',
  privacy: '/resources/privacy',
  /** The platform's Terms of Service and Privacy Policy, which patient sign-up links to. */
  terms: '/terms',
  privacyPolicy: '/privacy',
  howItWorksProvider: '/providers#products',
  howItWorksPatient: '/patients#steps',
} as const

/**
 * Each product with a site of its own, and that site's subdomain, in production and under `.staging.` (owner,
 * 2026-11-01: every product is its own site, with its own front page). The site's front page is the product's page
 * from this site, which the edge serves there (infra/cloudflare/src/frontend-worker.mjs, PRODUCT_LANDING_PAGES); the
 * edge also sends this site's /products/<slug> there.
 */
export const PRODUCT_SITE_SUBDOMAINS: Readonly<Record<string, string>> = {
  ehr: 'ehr',
  laboratory: 'lab',
  pharmacy: 'pharmacy',
  migrate: 'migrate',
  outreach: 'outreach',
}

/**
 * The front page of a product's own site in this build's deployment, or null: for a product without a site, and in
 * local development, where this site still serves /products/<slug> itself.
 */
export function productSiteHref(slug: string): string | null {
  const subdomain = Object.hasOwn(PRODUCT_SITE_SUBDOMAINS, slug) ? PRODUCT_SITE_SUBDOMAINS[slug] : undefined
  if (!subdomain) return null
  const environment = process.env.NEXT_PUBLIC_HID_ENVIRONMENT
  if (environment === 'production') return `https://${subdomain}.healthidentitydirectory.com/`
  if (environment === 'staging') return `https://${subdomain}.staging.healthidentitydirectory.com/`
  return null
}

/** The audiences the solutions page speaks to, in the order it presents them. */
export const SOLUTION_AUDIENCES = [
  { id: 'hospitals', label: 'Hospitals' },
  { id: 'clinics', label: 'Clinics' },
  { id: 'diagnostic-centres', label: 'Diagnostic centres' },
  { id: 'pharmacies', label: 'Pharmacies' },
  { id: 'public-health-programmes', label: 'Public health programmes' },
] as const

export type SolutionAudienceId = (typeof SOLUTION_AUDIENCES)[number]['id']

/** Shared audience photography for the navigation and solutions page. */
export const SOLUTION_IMAGES: Record<SolutionAudienceId, { src: string; alt: string; position: string }> = {
  hospitals: { src: '/brand/solutions/hospital.jpg', alt: 'Hospital building with its main entrance and emergency department', position: '50% 50%' },
  clinics: { src: '/brand/solutions/clinic.jpg', alt: 'Clinic treatment room with a patient bed and monitoring equipment', position: '56% 60%' },
  'diagnostic-centres': { src: '/brand/solutions/laboratory.jpg', alt: 'Laboratory scientist examining a sample through a microscope', position: '50% 45%' },
  pharmacies: { src: '/brand/solutions/pharmacy.jpg', alt: 'Pharmacy dispensing counter and organised medication shelves', position: '50% 60%' },
  'public-health-programmes': { src: '/brand/solutions/outreach.jpg', alt: 'Healthcare worker checking a patient during community outreach', position: '50% 50%' },
}


/** The authenticated portal serves patient, provider and admin journeys. */
function portalOrigin(configured: string | undefined, localOrigin: string): string {
  if (!configured) {
    if (process.env.NEXT_PUBLIC_HID_ENVIRONMENT === 'staging'
      || process.env.NEXT_PUBLIC_HID_ENVIRONMENT === 'production') {
      throw new Error('The authenticated portal origin must be configured outside local development.')
    }
    return localOrigin
  }
  const url = new URL(configured)
  if (!['http:', 'https:'].includes(url.protocol) || url.pathname !== '/' || url.search || url.hash
    || (process.env.NEXT_PUBLIC_HID_ENVIRONMENT !== 'local' && url.protocol !== 'https:')) {
    throw new Error('Authenticated app origin must be an HTTPS origin outside local development.')
  }
  return url.origin
}

const PORTAL_ORIGIN = portalOrigin(process.env.NEXT_PUBLIC_HID_PORTAL_ORIGIN, 'http://localhost:3200')

/**
 * The staff page at `path` (provider/sign-in, provider/enroll) on the EHR site of this build's deployment, the site
 * staff and facilities use when no product is named. The patient portal (app.) is for patients only (owner,
 * 2026-11-02): no link here opens a staff page there. In local development, where there is no product site, the local
 * portal's own staff page.
 */
function ehrSitePage(path: string): string {
  const site = productSiteHref('ehr')
  return site ? new URL(path, site).href : `${PORTAL_ORIGIN}/${path}`
}

/**
 * The ways in. Patients sign in and get a Health ID on the patient portal (app.). Staff sign in, and a facility signs
 * up, on the EHR site (each product site has its own: productSignInHref, productSignUpHref). The staff addresses are
 * read when asked for, so they follow NEXT_PUBLIC_HID_ENVIRONMENT as productSiteHref does.
 */
export const APP_ENTRY = {
  patientSignIn: `${PORTAL_ORIGIN}/sign-in`,
  patientSignUp: `${PORTAL_ORIGIN}/enroll`,
  get staffSignIn(): string { return ehrSitePage('provider/sign-in') },
  get providerSignUp(): string { return ehrSitePage('provider/enroll') },
} as const

/** The product site each sign-up product belongs to (lib/provider-application.ts APPLICATION_PRODUCTS). */
const SIGN_UP_PRODUCT_SITES: Readonly<Record<string, string>> = {
  ehr: 'ehr', laboratory: 'laboratory', pharmacy: 'pharmacy', migrate: 'migrate',
}

/**
 * Where a facility signs up for `product`: that product's own site's facility sign-up (each product site signs up its
 * own kind of facility, owner 2026-11-02), with the product named so the form starts with it. With no product, or one
 * the sign-up does not know, the EHR site's. In local development, the local portal's.
 */
export function productSignUpHref(product?: string | null): string {
  const slug = product && Object.hasOwn(SIGN_UP_PRODUCT_SITES, product) ? SIGN_UP_PRODUCT_SITES[product]! : null
  if (!slug || !product) return APP_ENTRY.providerSignUp
  const site = productSiteHref(slug)
  const base = site ? new URL('provider/enroll', site).href : `${PORTAL_ORIGIN}/provider/enroll`
  return `${base}?product=${product}`
}

/**
 * Where a product page's Sign in goes: the staff sign-in on that product's own site (each product its own sign-in,
 * owner 2026-11-01), the same site productSiteHref names, so the page's Sign in and its front page are always one host.
 * Where productSiteHref names no site (local development, or a page with no site of its own), APP_ENTRY.staffSignIn:
 * the EHR site's, or the local portal's in local development. Absolute even though the page is that site's own front page in production and on staging: the edge reads the
 * page's addresses as this site's (frontend-worker.mjs, landingHref), so a relative /provider/sign-in would open this
 * site's, which has none. The edge leaves an address on the product site's own host as it is.
 */
export function productSignInHref(slug: string): string {
  const site = productSiteHref(slug)
  return site ? new URL('provider/sign-in', site).href : APP_ENTRY.staffSignIn
}

export interface Audience {
  readonly id: 'patient' | 'provider'
  readonly title: string
  readonly body: string
  readonly href: string
  readonly image: string
  readonly imageAlt: string
}

export const AUDIENCES: readonly Audience[] = [
  {
    id: 'patient',
    title: 'Patient',
    body: 'Create your Health ID and view the care records available to your account.',
    href: ROUTES.patients,
    image: '/brand/chooser-patient.png',
    imageAlt: 'A person holding a phone showing their Health ID record',
  },
  {
    id: 'provider',
    title: 'Healthcare provider',
    body: 'Identify patients, access their medical history with consent, and create a unified electronic health record (EHR) for patients at your facility.',
    href: ROUTES.providers,
    image: '/brand/chooser-provider.png',
    imageAlt: 'A hospital building',
  },
]

export const CHOOSER = {
  title: 'How would you like to access Health ID?',
  lede: 'Your experience with Health ID depends on your role. Please select the option that best describes you.',
  footnote: 'You can change this later from the footer.',
} as const

/**
 * The organisations shown beneath the provider hero.
 *
 * The label is written exactly as the brand requests it; the list stays a static
 * one so it can be reviewed and corrected in one place.
 */
export const TRUST = {
  label: 'In partnership with',
  organisations: ['Kolekto', 'Ilorin Innovation Hub', 'iDICE Startup Bridge', 'Amazon Web Services'],
} as const
