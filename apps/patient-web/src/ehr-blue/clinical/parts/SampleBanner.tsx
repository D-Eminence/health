/**
 * The notice on every sample-only workspace and sample part. A local copy of the frame's EhrSampleBanner (on its way to
 * main in the frame's pull request), with the same words, markup and look: a note, not a live region, there from the
 * start. Once @hid/ui/ehr exports EhrSampleBanner on main, this file can re-export it.
 */
export const SAMPLE_NOTICE = 'Sample only: not connected to Health ID yet. Nothing you do here is saved.'

export function SampleBanner() {
  return (
    <p className="hid-ehr-clinical-sample-banner" data-ehr-sample="">
      <span className="hid-ehr-clinical-sample-banner-mark" aria-hidden="true" />
      {SAMPLE_NOTICE}
    </p>
  )
}
