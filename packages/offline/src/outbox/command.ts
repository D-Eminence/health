/**
 * The sealed command record (§2.8 "Command record (sealed with QK)").
 * Only the non-identifying scheduling fields are copied into the outbox
 * record's plaintext (see store.ts OutboxRecord).
 */

import type { ClockState, ConflictClass, Json, OpName, Receipt, Ref } from '../contracts'
import type { Frozen } from './freeze'

export type CommandState = 'queued' | 'sending' | 'applied' | 'held_access' | 'held_session' | 'held_membership' | 'review' | 'discarded'

export interface LastProblem {
  status: number | null
  code?: string | null
  problem: boolean
  at: string
  /** The very first attempt was definitively refused, so nothing was applied (§2.8 save path, step 3). */
  firstRefusal?: boolean
  /** Problem details for the form (field codes only, never values). */
  body?: unknown
}

export interface Command {
  v: 1
  id: string
  key: `off1.${string}`
  op: OpName
  opVersion: 1
  scope: { accountId: string; membershipId: string; facilityId: string; patientId: string; purpose: 'direct-care' }
  input: Json
  refs: Record<string, Ref>
  frozen?: Frozen
  /** PATCH: the fields that define "already applied". */
  intent?: Record<string, Json>
  dependsOn: string[]
  lane: string
  priority: 0 | 1 | 2
  capturedAt: string
  clock: ClockState
  /** Saved while the device was not reachable (drives the CC4 check). */
  savedOffline: boolean
  safety?: { allergiesSha256: string; encounterRxSha256: string; seenAt: string }
  grantAtCapture?: { expiresAt: string; grantId?: string }
  state: CommandState
  everSent: boolean
  attempts: number
  nextAttemptAt: number
  firstAttemptAt?: number
  lastProblem?: LastProblem
  receipt?: Receipt
  /** The 2xx response body, kept sealed until the command is applied and pruned. */
  value?: unknown
  review?: { class: ConflictClass; openedAt: string }
  /** CC5: the author asked for access again; resume when consent allows writing. */
  awaitingAccess?: boolean
  /** CC4: the author chose "Send as is (I have checked)". */
  safetyCleared?: boolean
  supersedes?: string
  discarded?: { reason: string; at: string }
}

export const UNFINISHED: ReadonlySet<CommandState> = new Set(['queued', 'sending', 'held_access', 'held_session', 'held_membership', 'review'])

export function isUnfinished(state: CommandState): boolean {
  return UNFINISHED.has(state)
}
