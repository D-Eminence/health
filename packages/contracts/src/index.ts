export {
  APP_BOUNDARIES,
  BoundaryViolationError,
  assertEndpointAllowed,
  canUseService,
  servicesFor,
} from './boundaries'
export type { AppBoundary, HidApp, ServicesOf } from './boundaries'
export {
  HID_ENDPOINTS,
  SERVICES_WITHOUT_CONTRACTS,
  endpointsForService,
  findEndpoint,
  hasContracts,
} from './registry'
export type { ContractStatus, EndpointAuth, EndpointDescriptor, HidService } from './registry'
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
