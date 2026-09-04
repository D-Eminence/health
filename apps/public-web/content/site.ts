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
  product: (slug: string) => `/products/${slug}`,
  pricing: '/providers#pricing',
  howItWorksProvider: '/providers#platform',
  howItWorksPatient: '/patients#steps',
} as const

/**
 * Destinations owned by the authenticated applications, not by this site.
 *
 * These are absolute paths on the application origin today. When patient-web
 * and staff-web move to their own hosts, these become configured URLs — which
 * is why they are gathered here rather than inlined in a nav component.
 */
export const APP_ENTRY = {
  patientSignIn: '/patient',
  patientSignUp: '/patient',
  staffSignIn: '/hospital',
} as const

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
    body: 'Get a Health ID that carries all your health records.',
    href: ROUTES.patients,
    image: '/brand/chooser-patient.webp',
    imageAlt: 'A person holding a phone showing their Health ID record',
  },
  {
    id: 'provider',
    title: 'Healthcare provider',
    body: 'Identify patients, access their medical history with consent, and create a unified electronic health record (EHR) for patients at your facility.',
    href: ROUTES.providers,
    image: '/brand/chooser-provider.webp',
    imageAlt: 'A hospital building',
  },
]

export const CHOOSER = {
  title: 'How would you like to access Health ID?',
  lede: 'Your experience with Health ID depends on your role. Please select the option that best describes you.',
  footnote: 'You can change this later from the footer.',
} as const

export const PARTNERS: readonly string[] = [
  'Ilorin Innovation Hub',
  'iDICE Startup Bridge',
  'Kolekto',
]
