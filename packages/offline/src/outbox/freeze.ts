/**
 * Freezing a command into the exact request it will send for its whole life
 * (§2.8, fixes F6). Method, path, body and headers are computed once, stored in
 * the outbox record in one IndexedDB transaction, and replayed byte for byte.
 */

import { KEY_PREFIX, LIMITS, OFFLINE_HEADERS, type ClockState, type Json, type OpDefinition, type Ref } from '../contracts'

const encoder = new TextEncoder()

/** UTF-8 bytes of the body exactly as the transport serialises it (`JSON.stringify`). */
export function bodyBytes(body: Json | undefined): number {
  return body === undefined ? 0 : encoder.encode(JSON.stringify(body)).length
}

/** JSON with sorted keys, for digests and logical cache keys. Not used for the wire body. */
export function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null)
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  const entries = Object.keys(value as Record<string, unknown>).sort()
    .filter(k => (value as Record<string, unknown>)[k] !== undefined)
    .map(k => `${JSON.stringify(k)}:${stableJson((value as Record<string, unknown>)[k])}`)
  return `{${entries.join(',')}}`
}

export function newCommandKey(uuid: string): `off1.${string}` {
  return `${KEY_PREFIX}${uuid}` as `off1.${string}`
}

export const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/

/** What the engine knows about a dependency once it is applied. */
export interface ResolvedRef { id: string; rowVersion?: number }

/** Placeholders that stand in for server ids at save time: the same length as a UUID, so the size check is exact. */
const PLACEHOLDER_ID = '00000000-0000-4000-8000-000000000000'
const PLACEHOLDER_VERSION = 2_147_483_647

/**
 * Resolve the op's refs. A `{server}` ref is used as is; a `{local: cmdId}` ref
 * needs that command's receipt. Returns null when a local ref has none yet.
 */
export function resolveRefs(
  refs: Record<string, Ref>,
  lookup: (commandId: string) => ResolvedRef | null,
): { ids: Record<string, string>; values: Record<string, string | number> } | null {
  const ids: Record<string, string> = {}
  const values: Record<string, string | number> = {}
  for (const [name, ref] of Object.entries(refs)) {
    if ('server' in ref) {
      ids[name] = ref.server
      values[name] = ref.server
      continue
    }
    const hit = lookup(ref.local)
    if (!hit) return null
    ids[name] = hit.id
    values[name] = hit.id
    if (hit.rowVersion !== undefined) values[`${name}.rowVersion`] = hit.rowVersion
  }
  return { ids, values }
}

/** Placeholder resolution, for the size check at save time. */
export function placeholderRefs(refs: Record<string, Ref>): { ids: Record<string, string>; values: Record<string, string | number> } {
  const ids: Record<string, string> = {}
  const values: Record<string, string | number> = {}
  for (const [name, ref] of Object.entries(refs)) {
    const id = 'server' in ref ? ref.server : PLACEHOLDER_ID
    ids[name] = id
    values[name] = id
    if (!('server' in ref)) values[`${name}.rowVersion`] = PLACEHOLDER_VERSION
  }
  return { ids, values }
}

/**
 * Replace `{"$ref":"<cmdId>.id"}` and `{"$ref":"<cmdId>.rowVersion"}`
 * placeholders anywhere in a body. Returns null when one cannot be resolved yet.
 */
export function resolvePlaceholders(body: Json, lookup: (commandId: string) => ResolvedRef | null): Json | null {
  let missing = false
  const walk = (value: Json): Json => {
    if (Array.isArray(value)) return value.map(walk)
    if (value !== null && typeof value === 'object') {
      const keys = Object.keys(value)
      const ref = value.$ref
      if (keys.length === 1 && typeof ref === 'string') {
        const match = /^(.+)\.(id|rowVersion)$/.exec(ref)
        const hit = match ? lookup(match[1]!) : null
        const out = match && hit ? (match[2] === 'id' ? hit.id : hit.rowVersion) : undefined
        if (out === undefined) { missing = true; return null }
        return out
      }
      const copy: { [k: string]: Json } = {}
      for (const k of keys) copy[k] = walk(value[k] as Json)
      return copy
    }
    return value
  }
  const out = walk(body)
  return missing ? null : out
}

export interface Frozen {
  method: 'POST' | 'PATCH' | 'PUT'
  path: string
  body: Json
  bytes: number
  headers: Record<string, string>
  frozenAt: string
}

export interface FreezeInput {
  def: OpDefinition<Json>
  input: Json
  key: `off1.${string}`
  facilityId: string
  capturedAt: string
  clock: ClockState
  resolved: { ids: Record<string, string>; values: Record<string, string | number> }
  lookup: (commandId: string) => ResolvedRef | null
  frozenAt: string
}

export class TooLongError extends Error {
  readonly bytes: number
  constructor(bytes: number) {
    super('Too long to save; split it')
    this.name = 'TooLongError'
    this.bytes = bytes
  }
}

/** Build the frozen request. Returns null while a placeholder is unresolved. Throws TooLongError past 8000 bytes. */
export function freeze(f: FreezeInput): Frozen | null {
  const raw = f.def.body(f.input, f.resolved.values)
  const body = resolvePlaceholders(raw, f.lookup)
  if (body === null) return null
  const bytes = bodyBytes(body)
  if (bytes > LIMITS.maxBodyBytes) throw new TooLongError(bytes)
  return {
    method: f.def.method,
    path: f.def.path(f.input, f.resolved.ids),
    body,
    bytes,
    headers: {
      'Idempotency-Key': f.key,
      'X-Facility-ID': f.facilityId,
      'X-Purpose-Of-Use': 'direct-care',
      [OFFLINE_HEADERS.command]: f.key,
      [OFFLINE_HEADERS.capturedAt]: f.capturedAt,
      [OFFLINE_HEADERS.clock]: f.clock,
    },
    frozenAt: f.frozenAt,
  }
}

/** The save-time size check (§2.8 save path step 1), with placeholders for ids not known yet. */
export function sizeAtSave(def: OpDefinition<Json>, input: Json): number {
  const ph = placeholderRefs(def.refs(input))
  const raw = def.body(input, ph.values)
  const body = resolvePlaceholders(raw, () => ({ id: PLACEHOLDER_ID, rowVersion: PLACEHOLDER_VERSION })) ?? raw
  return bodyBytes(body)
}
