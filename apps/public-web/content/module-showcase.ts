import { APP_ENTRY, ROUTES } from '@/content/site'

export type HealthIDModuleSlug = 'identity' | 'ehr' | 'migrate' | 'laboratory' | 'pharmacy' | 'outreach' | 'api'

export interface HealthIDModule {
  readonly slug: HealthIDModuleSlug
  readonly name: string
  readonly shortName: string
  readonly statement: string
  readonly description: string
  readonly href: string
  readonly cta: string
  /** Assign the supplied visual once here; every showcase then reuses it. */
  readonly visual: { readonly src: string; readonly alt: string } | null
}

/** Shared module copy. Visuals reuse the illustrative dashboard from each product hero. */
export const HEALTH_ID_MODULES: readonly HealthIDModule[] = [
  {
    slug: 'identity', name: 'Health ID Identity', shortName: 'Identity',
    statement: 'Your Health ID, connected to your care history.',
    description: 'Carry one persistent identity between participating providers while you remain in control of access to your health information.',
    // Its call to action is sign-up, as it says, like every other "Get your Health ID" (owner, 1 Nov 2026). The patient
    // page shows this card too, there and at the patient portal's front page, so /patients would open that page again.
    href: APP_ENTRY.patientSignUp, cta: 'Get your Health ID',
    visual: { src: '/brand/patient-app.png', alt: 'Health ID patient app' },
  },
  {
    slug: 'ehr', name: 'Health ID EHR', shortName: 'EHR',
    statement: 'Digital clinical records built for modern healthcare delivery.',
    description: 'Capture consultations, diagnoses, medications, investigations and follow-up care from one connected workspace.',
    href: ROUTES.product('ehr'), cta: 'Explore EHR', visual: null,
  },
  {
    slug: 'migrate', name: 'Health ID Migrate', shortName: 'Migrate',
    statement: 'Review and publish extracted clinical documents.',
    description: 'Process supported document jobs with OCR extraction, validation and patient confirmation.',
    href: ROUTES.product('migrate'), cta: 'Explore Migrate', visual: null,
  },
  {
    slug: 'laboratory', name: 'Health ID Laboratory', shortName: 'Laboratory',
    statement: 'Investigations, samples, results and verification.',
    description: 'Receive requests, track every sample, and return verified results to the patient they belong to.',
    href: ROUTES.product('laboratory'), cta: 'Explore Laboratory', visual: null,
  },
  {
    slug: 'pharmacy', name: 'Health ID Pharmacy', shortName: 'Pharmacy',
    statement: 'Dispensing connected to the prescription that caused it.',
    description: 'Keep prescriptions, dispensing and relevant medication history connected to the same patient.',
    href: ROUTES.product('pharmacy'), cta: 'Explore Pharmacy', visual: null,
  },
  {
    slug: 'outreach', name: 'Health ID Outreach', shortName: 'Outreach',
    statement: 'Manage campaign registration cases in the field.',
    description: 'Create campaigns and registration cases, then reconcile cases to existing patient identities.',
    href: ROUTES.product('outreach'), cta: 'Explore Outreach', visual: null,
  },
  {
    slug: 'api', name: 'Health ID API', shortName: 'API',
    statement: 'Connect the systems you already use.',
    description: 'Keep existing healthcare software while connecting patient identity and authorised records through Health ID.',
    href: ROUTES.product('api'), cta: 'Explore API', visual: null,
  },
]

export function findHealthIDModule(slug: string): HealthIDModule | undefined {
  return HEALTH_ID_MODULES.find(module => module.slug === slug)
}
