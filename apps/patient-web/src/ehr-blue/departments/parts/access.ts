import { useStaff } from '../../../staff/App'

/**
 * The working facility as the staff session reports it: its id, the membership the
 * session works under, and the permissions that membership holds there. Identity
 * decides every request; these only choose what a page offers.
 */
export function useDeptAccess() {
  const { state } = useStaff()
  const facility = state.status === 'ready' ? state.session.actor.facility : undefined
  return {
    facility,
    facilityId: facility?.id,
    membershipId: facility?.membershipId,
    permissions: facility?.permissions ?? [],
    actorId: state.status === 'ready' ? state.session.actor.id : undefined,
  }
}
