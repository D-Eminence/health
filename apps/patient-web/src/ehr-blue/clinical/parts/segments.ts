/**
 * The address segment of each clinical workspace under the blue EHR's base (/provider). Two workspaces keep today's
 * address, so links into today's provider portal (and the frame's stand-ins for them) still land on them:
 * Consultation is /provider/clinical and External record access is /provider/requests.
 */
const SEGMENTS: Readonly<Record<string, string>> = { consult: 'clinical', consent: 'requests' }

export function segmentOf(workspace: string): string {
  return SEGMENTS[workspace] ?? workspace
}
