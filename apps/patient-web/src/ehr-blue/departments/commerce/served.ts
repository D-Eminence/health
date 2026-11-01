import type { StaffSession } from '../../../staff/api'
import { isDemoFacility } from '../../blueFacilities'

/*
 * Where the point-of-care pages show (parity report 3.1 #20). Their routes are proposed, not served (api.ts): at a real
 * facility each page would send requests Health ID answers with 404, and staff would learn it isn't set up only after
 * they act. So until Health ID serves them they show at the four demo facilities only, where they were built and are
 * reviewed. Anywhere else they are left out of the menu, search and Home, and their address says they are part of the
 * demo, sending nothing. The live pages' ways into point of care (Paper prescription, Receive stock, sending a released
 * result, a lab request's sample guess from the price list) ask pointOfCareOpen too.
 *
 * Not 'sample': a sample page is never listed and needs no permission (frame/pageAccess.ts), so the demo facilities would
 * lose these pages from their menus and anyone could open them. These keep their live permission check where they show.
 * When Health ID serves the routes, open them here.
 */

/** Whether the point-of-care pages show at this facility. */
export function pointOfCareOpen(facilityId: string | null | undefined): boolean {
  return isDemoFacility(facilityId)
}

/** A point-of-care page's `visible`: shown only where its routes may answer. */
export const pointOfCareShown = (session: StaffSession): boolean => pointOfCareOpen(session.actor.facility?.id)
