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
  /** Identity belongs to the patient journey, not a duplicate provider product page. */
  product: (slug: string) => (slug === 'identity' ? '/patients' : `/products/${slug}`),
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

export const APP_ENTRY = {
  patientSignIn: `${PORTAL_ORIGIN}/sign-in`,
  patientSignUp: `${PORTAL_ORIGIN}/enroll`,
  staffSignIn: `${PORTAL_ORIGIN}/provider/sign-in`,
  providerSignUp: `${PORTAL_ORIGIN}/provider/enroll`,
} as const

/** Each product page's own site (the portal's product hosts): ehr., lab., pharmacy., migrate. and outreach. */
const PRODUCT_SITE_PREFIX: Readonly<Record<string, string>> = {
  ehr: 'ehr', laboratory: 'lab', pharmacy: 'pharmacy', migrate: 'migrate', outreach: 'outreach',
}

/**
 * Where a product page's Sign in goes: that product's own site, where its staff sign in (each product its own sign-in,
 * owner 2026-11-01), beside the portal's main site in production and on staging. Locally, and for a page with no product
 * site, the portal's own staff sign-in.
 */
export function productSignInHref(slug: string): string {
  const prefix = Object.hasOwn(PRODUCT_SITE_PREFIX, slug) ? PRODUCT_SITE_PREFIX[slug] : undefined
  const portal = new URL(PORTAL_ORIGIN).hostname
  const host = !prefix ? null
    : portal === 'app.healthidentitydirectory.com' ? `${prefix}.healthidentitydirectory.com`
      : portal === 'staging.healthidentitydirectory.com' ? `${prefix}.staging.healthidentitydirectory.com` : null
  return host ? `https://${host}/provider/sign-in` : APP_ENTRY.staffSignIn
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
