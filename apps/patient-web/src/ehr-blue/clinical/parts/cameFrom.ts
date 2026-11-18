/**
 * Where a page was opened from, carried in router state so Back can return there by name ("Back to Adaeze Okafor",
 * "Back to consultation"). Only an address inside the provider workspace is taken; nothing about the patient is put in
 * the address itself.
 */
export interface CameFrom { readonly to: string; readonly label: string }

/** Router state saying the page being opened was reached from `to`, with Back named `label`. */
export function fromHere(to: string, label: string, state: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...state, from: { to, label } }
}

/** The page this one was opened from, when the router state names a provider address. */
export function cameFrom(state: unknown): CameFrom | null {
  if (!state || typeof state !== 'object' || !('from' in state)) return null
  const from = (state as { from?: unknown }).from
  if (!from || typeof from !== 'object') return null
  const { to, label } = from as { to?: unknown; label?: unknown }
  return typeof to === 'string' && to.startsWith('/provider') && !to.startsWith('//') && typeof label === 'string' && label ? { to, label } : null
}
