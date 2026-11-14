/** The words every sample workspace shows, exactly. */
export const SAMPLE_NOTICE = 'Sample only: not connected to Health ID yet. Nothing you do here is saved.'

/**
 * The notice on a sample workspace or a sample section of a partial page: what it
 * shows is fictional, and nothing done there leaves the page. A local copy until
 * the frame's EhrSampleBanner is available.
 */
export function SampleBanner({ className }: { readonly className?: string }) {
  return (
    <p className={['hid-ehr-dept-sample-banner', className].filter(Boolean).join(' ')} role="note">{SAMPLE_NOTICE}</p>
  )
}
