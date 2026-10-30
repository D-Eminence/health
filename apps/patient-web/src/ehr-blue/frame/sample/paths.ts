/** Where each design workspace opens in the blue EHR, when that is not its own id. */
const MODULE_PATHS: Record<string, string> = {
  consult: 'clinical', lab: 'laboratory', consent: 'requests', billing: 'patient-billing', inventory: 'supply',
  procurement: 'supply/procurement', policies: 'insurance/policies',
}

export function modulePath(id: string): string {
  return `/provider/${MODULE_PATHS[id] ?? id}`
}
