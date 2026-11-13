/** The one line Outreach shows while Health ID can't be reached: the same words wherever the volunteer is. */
export const NO_SIGNAL_TEXT = 'No signal. You can keep registering. Your work stays on this phone.'

/**
 * Outreach with no signal: a calm line at the top of the page (styled by staff/style.css, `.staff-no-signal`). The staff
 * app shows it over the open workspace while its session check gets no answer (staff/App.tsx), and "No signal" mode
 * shows it over its own page (OfflineOutreach.tsx), so the volunteer sees one banner with one wording. `children`
 * replaces the words only for what follows from them (signal back while a registration is half typed).
 */
export function NoSignalBanner({ children }: { readonly children?: string }) {
  return <p role="status" className="staff-no-signal">{children ?? NO_SIGNAL_TEXT}</p>
}
