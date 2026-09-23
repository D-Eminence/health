import type { Metadata } from 'next'
import { PatientNav } from '@/components/layout/SiteNav'
import { SiteFooter } from '@/components/layout/SiteFooter'
import { BackToTop } from '@/components/shared/BackToTop'
import { PatientFaq } from '@/components/patient/Faq'
import { PatientExperienceBento } from '@/components/patient/PatientExperienceBento'
import { HealthIDModuleShowcase } from '@/components/product/HealthIDModuleShowcase'
import { TrustStrip } from '@/components/provider/TrustStrip'
import {
  PatientClosing,
  PatientControl,
  PatientHero,
  PatientJourney,
  PatientSteps,
} from '@/components/patient/Sections'

export const metadata: Metadata = {
  title: 'For patients',
  description:
    'Health ID carries your medical history between hospitals, laboratories and pharmacies — and only opens when you allow it.',
}

/**
 * The patient landing page.
 *
 * Entirely server-rendered apart from the navigation menu: there is nothing
 * interactive here that needs JavaScript, including the FAQ.
 */
export default function PatientsPage() {
  return (
    <>
      <PatientNav />
      <main id="main">
        <PatientHero />
        <TrustStrip />
        <PatientSteps />
        <PatientExperienceBento />
        <PatientJourney />
        <PatientControl />
        <PatientFaq />
        <HealthIDModuleShowcase />
        <PatientClosing />
      </main>
      <SiteFooter />
      <BackToTop />
    </>
  )
}
