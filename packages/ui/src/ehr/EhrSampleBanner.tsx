/**
 * The one notice for anything in the EHR not yet connected to Health ID: a page, a panel or a part of one that shows
 * fictional sample data kept in memory, which a reload resets. Its words are fixed, so every sample surface says the
 * same thing. It is a note, not a live region: it is there from the start.
 */

import { cx } from '../primitives'

export const EHR_SAMPLE_NOTICE = 'Sample only: not connected to Health ID yet. Nothing you do here is saved.'

export interface EhrSampleBannerProps {
  readonly className?: string
}

export function EhrSampleBanner({ className }: EhrSampleBannerProps) {
  return (
    <p className={cx('hid-ehr-sample-banner', className)} data-ehr-sample="">
      {EHR_SAMPLE_NOTICE}
    </p>
  )
}
