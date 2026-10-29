/**
 * Lanes (§2.8 Engine): commands for one visit (or one patient, or media) are
 * sent in order (I4, FIFO per lane). Only the lowest unfinished command of a
 * lane may be sent, so a command in review blocks its lane ("This visit and 4
 * entries could not be sent").
 */

import type { Json, OpDefinition, Ref } from '../contracts'
import { isUnfinished, type Command } from './command'

export const MEDIA_LANE = 'media'

/** The lane a new command joins. `commandId` is its own id (an encounter.create opens its own visit lane). */
export function laneFor(def: OpDefinition<Json>, input: Json, commandId: string): { patientId: string; lane: string; priority: 0 | 2 } {
  const l = def.lane(input)
  if (l.visit === 'media' || def.media !== undefined || def.op === 'ehr.document.upload') {
    return { patientId: l.patientId, lane: MEDIA_LANE, priority: 2 }
  }
  if (def.op === 'ehr.encounter.create') return { patientId: l.patientId, lane: visitLane(l.patientId, { local: commandId }), priority: 0 }
  if (l.visit === 'patient') return { patientId: l.patientId, lane: `p:${l.patientId}`, priority: 0 }
  return { patientId: l.patientId, lane: visitLane(l.patientId, l.visit), priority: 0 }
}

export function visitLane(patientId: string, visit: Ref): string {
  return 'local' in visit ? `p:${patientId}:v:local:${visit.local}` : `p:${patientId}:v:${visit.server}`
}

export interface EligibilityContext {
  now: number
  /** Ids of commands known applied (a receipt exists). */
  applied: ReadonlySet<string>
  /** Lanes already being sent right now. */
  busy: ReadonlySet<string>
}

/** The head (lowest unfinished seq) of every lane. */
export function laneHeads<T extends { seq: number; cmd: Command }>(commands: readonly T[]): Map<string, T> {
  const heads = new Map<string, T>()
  for (const item of [...commands].sort((a, b) => a.seq - b.seq)) {
    if (!isUnfinished(item.cmd.state)) continue
    if (!heads.has(item.cmd.lane)) heads.set(item.cmd.lane, item)
  }
  return heads
}

/**
 * Eligible: queued, or sending with an unknown outcome; every dependsOn
 * applied; the head of its lane; nextAttemptAt ≤ now; lane not busy. Clinical
 * first (priority 0), media last.
 */
export function eligible<T extends { seq: number; cmd: Command }>(commands: readonly T[], ctx: EligibilityContext): T[] {
  const out: T[] = []
  for (const [lane, head] of laneHeads(commands)) {
    const c = head.cmd
    if (ctx.busy.has(lane)) continue
    if (c.state !== 'queued' && c.state !== 'sending') continue
    if (c.nextAttemptAt > ctx.now) continue
    if (!c.dependsOn.every(id => ctx.applied.has(id))) continue
    out.push(head)
  }
  return out.sort((a, b) => a.cmd.priority - b.cmd.priority || a.seq - b.seq)
}

/** How many unfinished commands wait behind this one in its lane. */
export function blockedBehind(commands: readonly { seq: number; cmd: Command }[], seq: number, lane: string): number {
  return commands.filter(c => c.cmd.lane === lane && c.seq > seq && isUnfinished(c.cmd.state)).length
}
