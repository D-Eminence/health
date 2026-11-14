export {
  ALLOWED_PRINCIPAL_FIELDS,
  hasSatisfiedMfa,
  isPatient,
  isPlatformAdmin,
  isStaff,
} from './principal'
export type {
  AuthPrincipal,
  PatientPrincipal,
  PlatformPrincipal,
  PrincipalKind,
  StaffPrincipal,
} from './principal'
export {
  INITIAL_SESSION_STATE,
  PERSISTED_STORAGE_KEYS,
  clearPortalHint,
  createSessionStore,
  readPortalHint,
  writePortalHint,
} from './session'
export type { KeyValueStorage, SessionListener, SessionState, SessionStatus, SessionStore } from './session'
export {
  PATIENT_ROUTE,
  PLATFORM_ADMIN_ROUTE,
  STAFF_ROUTE,
  evaluateAccess,
  isAllowed,
} from './guards'
export type { AccessDecision, AccessRequirement } from './guards'
