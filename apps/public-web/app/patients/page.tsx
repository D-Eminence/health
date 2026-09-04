import type { Metadata } from 'next'
import { PatientNav } from '@/components/layout/SiteNav'
import { SiteFooter } from '@/components/layout/SiteFooter'
import { PatientFaq } from '@/components/patient/Faq'
import {
  PatientClosing,
  PatientControl,
  PatientHero,
  PatientJourney,
  PatientSteps,
  PatientUpload,
} from '@/components/patient/Sections'

export const metadata: Metadata = {
  title: 'For patients',
  description:
    'One Health ID carries your medical history between hospitals, laboratories and pharmacies — and only opens when you allow it.',
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
        <PatientSteps />
        <PatientJourney />
        <PatientControl />
        <PatientUpload />
        <PatientFaq />
        <PatientClosing />
      </main>
      <SiteFooter />
    </>
  )
}
