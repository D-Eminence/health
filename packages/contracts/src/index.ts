export {
  APP_BOUNDARIES,
  APP_ROUTE_GRANTS,
  BoundaryViolationError,
  assertEndpointAllowed,
  canUseService,
  servicesFor,
} from './boundaries'
export type { AppBoundary, HidApp, ServicesOf } from './boundaries'
export {
  HID_ENDPOINTS,
  NON_FRONTEND_ENDPOINTS,
  SERVICES_WITHOUT_CONTRACTS,
  endpointsForService,
  findEndpoint,
  hasContracts,
} from './registry'
export type { ContractStatus, EndpointAuth, EndpointDescriptor, EndpointMethod, HidService } from './registry'
export { BrowserRouteError, assertRegisteredBrowserRequest } from './browser-routes'
export type { BrowserRouteErrorCode } from './browser-routes'
export {
  PRIVILEGED_ROLES,
  isPrivilegedRole,
  isRestricted,
} from './domain'
export type {
  DataClassification,
  HidAccessScope,
  HidAppRole,
  HidAssuranceLevel,
  HidGrantStatus,
  HidRequestStatus,
  HidShareDurationPreset,
  HidSharePermissionTier,
  HidShareTargetType,
  HidStaffRole,
  UnverifiedPayload,
} from './domain'
export type {
  ClinicalRequestHeaders,
  CreateDemoRequest,
  DemoProduct,
  DemoRequestAccepted,
  HidActor,
  HidAuthSession,
  HidFacilityAssignment,
  HidProblemDetails,
  HidStaffLoginChallenge,
  PatientEnrollmentProgress,
  PatientRecordSummary,
  PublicPrice,
  PublicPricingResponse,
  RecoveryOtpStart,
  RecoveryOtpVerified,
} from './wire'
