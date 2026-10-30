/**
 * The notice on every sample-only workspace. A local copy: the frame's EhrSampleBanner is not on main yet, and the
 * words are the owner's, exactly. A status region, so it is announced once when the page opens.
 */
export const SAMPLE_NOTICE = 'Sample only: not connected to Health ID yet. Nothing you do here is saved.'

export function SampleBanner() {
  return <div className="hid-ehr-clinical-sample-banner" role="status">
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.75" />
      <path d="M12 8v5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      <circle cx="12" cy="16.5" r="1" fill="currentColor" />
    </svg>
    <p>{SAMPLE_NOTICE}</p>
  </div>
}
