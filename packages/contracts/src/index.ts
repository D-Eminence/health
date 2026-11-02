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
  ORDER_ROUTE_CANNOT_COMPLETE_REASONS,
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
export {
  HEALTH_ID_PATTERN,
  HEALTH_ID_PREFIX,
  emailOrHealthId,
  healthIdOrOtherInput,
  isBlankHealthIdInput,
  isCompleteHealthId,
  normalizeHealthIdInput,
  signInPrincipal,
  signInPrincipalInput,
} from './healthId'
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
  ParticipatingFacilities,
  PatientEnrollmentAvailability,
  PatientEnrollmentHolderCode,
  PatientEnrollmentProfile,
  PatientEnrollmentProgress,
  PatientRecordSummary,
  PublicPrice,
  PublicPricingResponse,
  RecoveryOtpStart,
  RecoveryOtpVerified,
} from './wire'
export {
  chatQuestion, parseSupportChat, parsePatientChat, parsePatientChatAvailability, parsePatientChatHistory,
  parsePatientChatCleared,
} from './chat'
export { stagingChatQuestion, parseStagingPatientChat, parseStagingChatHistory, STAGING_CHAT_SOURCE_ORIGINS } from './stagingChat'
export type {
  StagingPatientChatReply, StagingPatientChatSource, StagingPatientChatHistory, StagingChatSourceOrigin,
} from './stagingChat'
export type {
  SupportChatReply, PatientChatReply, PatientChatSource, PatientChatSourceKind, PatientChatStatus, PatientChatBlock,
  PatientChatBlockKind, PatientChatCoverage, PatientChatStoredReply, PatientChatExchange, PatientChatHistory,
  PatientChatAvailability,
} from './chat'
