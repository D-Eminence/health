import type { FacilityStaff } from '../../../staff/api'

/** What every part of the Staff & access page shares: the facility's staff as last read, and how an action ends. */
export interface StaffShared {
  readonly staff: FacilityStaff
  readonly facilityId: string
  readonly facilityName: string
  readonly actorEmail: string
  /**
   * An action succeeded: the page's problem is cleared and the list is read again. `focusAfter` takes focus once it
   * is, if focus was lost meanwhile (the control used is gone).
   */
  readonly done: (focusAfter?: readonly string[]) => void
  /** Reads the list again, keeping what the page says. */
  readonly reload: () => void
  /**
   * A refusal's words. A refusal that means the list was out of date (today's STAFF_REFRESHING) is also said at the
   * top of the page, and the list is read again, as on today's page.
   */
  readonly refused: (caught: unknown) => string
}
