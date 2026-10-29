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

/** A command's place in its lane: its original's place for a review successor, else its own seq. */
export function orderKey(c: { seq: number; cmd: Command }): number {
  return c.cmd.orderSeq ?? c.seq
}

/** Lane order: by place, then by seq (a successor sorts just after its original). */
export function byLaneOrder(a: { seq: number; cmd: Command }, b: { seq: number; cmd: Command }): number {
  return orderKey(a) - orderKey(b) || a.seq - b.seq
}

/** The head (first unfinished in lane order) of every lane. */
export function laneHeads<T extends { seq: number; cmd: Command }>(commands: readonly T[]): Map<string, T> {
  const heads = new Map<string, T>()
  for (const item of [...commands].sort(byLaneOrder)) {
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
export function blockedBehind(commands: readonly { seq: number; cmd: Command }[], item: { seq: number; cmd: Command }): number {
  return commands.filter(c => c.cmd.lane === item.cmd.lane && c.seq !== item.seq && byLaneOrder(c, item) > 0 && isUnfinished(c.cmd.state)).length
}

/**
 * The names a visit lane goes by. A visit saved offline is `p:<patient>:v:local:<cmdId>` until it is applied and
 * `p:<patient>:v:<serverId>` after; both name one visit, so its entries must stay in one lane (I4).
 */
export function laneAliases(lane: string, receipts: ReadonlyMap<string, { resourceId: string }>): string[] {
  const m = /^p:(.+):v:(local:)?([^:]+)$/.exec(lane)
  if (!m) return [lane]
  const [, patientId, local, id] = m
  const names = new Set([lane])
  if (local) {
    const serverId = receipts.get(id!)?.resourceId
    if (serverId) names.add(`p:${patientId}:v:${serverId}`)
  } else {
    for (const [commandId, r] of receipts) if (r.resourceId === id) names.add(`p:${patientId}:v:local:${commandId}`)
  }
  return [...names]
}
