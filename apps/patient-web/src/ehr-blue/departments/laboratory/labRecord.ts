import { useCallback, useEffect, useRef, useState } from 'react'
import { staffApi, type LabAccession, type LabExecution } from '../../../staff/api'
import { errorText } from '../parts/errors'
import { labResultsReadDoubt, type LabResultsHiddenReason } from './labText'

/*
 * One lab request's record as the lab works it: its accession (samples) and, for each received sample, its tests and
 * results. The rules are the Laboratory page's: reads are made afresh (never merged with one in flight), an answer for
 * an earlier read is dropped, and only a successful read confirms access, so a failed read of the results hides them
 * (LAB_RESULTS_HIDDEN) until a read succeeds again. A write that fails in a way that leaves access in doubt reads again.
 */

export interface LabRecordState {
  readonly accession: LabAccession | null
  readonly executions: readonly LabExecution[]
  readonly loading: boolean
  readonly error: string
  /** Why the results are hidden, when a read of them failed. */
  readonly hidden: LabResultsHiddenReason | null
  /** Whether the tests were read at all (the member holds lab.execution.read and a sample was received). */
  readonly executionsRead: boolean
  /** How many reads have settled: focus waits for the read a step started. */
  readonly reads: number
}

const EMPTY: LabRecordState = { accession: null, executions: [], loading: true, error: '', hidden: null, executionsRead: false, reads: 0 }

/** Reads the record; `reload` reads it again; `recheck` reads again after a refusal that leaves access in doubt. */
export function useLabRecord(facilityId: string, accessionId: string | null | undefined, canReadAccession: boolean, canReadExecutions: boolean) {
  const key = `${facilityId}:${accessionId ?? ''}`
  const [state, setState] = useState<{ key: string; value: LabRecordState }>({ key: '', value: EMPTY })
  const [round, setRound] = useState(0)
  const request = useRef(0)
  useEffect(() => {
    if (!accessionId || !canReadAccession) return
    const mine = ++request.current
    setState(previous => ({ key, value: { ...(previous.key === key ? previous.value : EMPTY), loading: true } }))
    void (async () => {
      let next: Omit<LabRecordState, 'reads'>
      try {
        const accession = await staffApi.labAccession(facilityId, accessionId)
        const received = canReadExecutions ? accession.specimens.filter(specimen => specimen.status === 'received') : []
        let executions: LabExecution[] = []
        let hidden: LabResultsHiddenReason | null = null
        try {
          const lists = await Promise.all(received.map(specimen => staffApi.labExecutions(facilityId, specimen.id)))
          executions = lists.flatMap(list => list.items)
        } catch (caught) { hidden = labResultsReadDoubt(caught) ?? 'unverified' }
        next = { accession, executions: hidden ? [] : executions, loading: false, error: '', hidden, executionsRead: received.length > 0 && !hidden }
      } catch (caught) {
        next = { ...EMPTY, loading: false, error: errorText(caught, 'This request could not be loaded. Refresh to try again.'),
          hidden: labResultsReadDoubt(caught) === 'denied' ? 'denied' : null }
      }
      if (request.current === mine) setState(previous => ({ key, value: { ...next, reads: (previous.key === key ? previous.value.reads : 0) + 1 } }))
    })()
    return () => { request.current += 1 }
  }, [key, facilityId, accessionId, canReadAccession, canReadExecutions, round])
  const reload = useCallback(() => setRound(value => value + 1), [])
  const recheck = useCallback((caught: unknown) => { if (labResultsReadDoubt(caught)) setRound(value => value + 1) }, [])
  const value = !accessionId || !canReadAccession ? { ...EMPTY, loading: false } : state.key === key ? state.value : EMPTY
  return { ...value, reload, recheck }
}
