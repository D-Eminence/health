/** Selected at build time and bound into the release configuration hash. */
export function backendContract(): 'main-v1' | 'novu-v1' {
  const value = import.meta.env.VITE_HID_BACKEND_CONTRACT
  if (value === undefined || value === '' || value === 'main-v1') return 'main-v1'
  if (value === 'novu-v1') return value
  throw new Error('Unsupported backend contract in this build.')
}

export function usesNovuBackend(): boolean { return backendContract() === 'novu-v1' }

/** Novu has no clinician self sign-up, so nobody can have applied there and no application can be checked. */
export function servesClinicianApplications(): boolean { return !usesNovuBackend() }
