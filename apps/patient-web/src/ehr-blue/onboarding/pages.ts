import type { EhrBluePage } from '../frame/types'
import { onboardingPage } from './page'

// Facility setup, the design's onboarding wizard (screens 1-register-and-launch 14-22), for the frame's sidebar and
// router (it finds this module by globbing each ehr-blue folder for pages.ts).
export const pages: EhrBluePage[] = [onboardingPage]
