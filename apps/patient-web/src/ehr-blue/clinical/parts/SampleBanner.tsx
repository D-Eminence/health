import { EHR_SAMPLE_NOTICE, EhrSampleBanner } from '@hid/ui/ehr'

/**
 * The notice on every sample-only workspace and sample part: the frame's EhrSampleBanner, so every sample surface in
 * the EHR says the same words in the same way.
 */
export const SAMPLE_NOTICE = EHR_SAMPLE_NOTICE

export function SampleBanner() {
  return <EhrSampleBanner />
}
