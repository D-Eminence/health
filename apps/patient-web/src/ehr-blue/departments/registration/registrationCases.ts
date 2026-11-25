import { useCallback, useEffect, useRef, useState } from 'react'
import { HidApiError } from '@hid/http'
import {
  staffApi, type RegistrationCase, type RegistrationCaseListItem, type RegistrationCaseListQuery, type RegistrationCaseView,
} from '../../../staff/api'
import { LIST_DENIED, LIST_FAILED, LIST_RESTARTED, listErrorText, MORE_FAILED } from './registrationText'

/*
 * The registration list (SX-10, GET identity/registration-cases): "My registrations" for the desk (view mine) and "All
 * registrations" for approvers (view facility), each with its filters, a page at a time while Identity sends a next
 * cursor ("Load more"). Kept in memory only, as the rest of the page: never in the address, the history or storage.
 * Each page read is audited by Identity, so the list is read when the page opens, when the choice or a filter changes,
 * when asked to try again, and after a registration is started here; never on a timer.
 */

export interface CaseFilter {
  readonly view: RegistrationCaseView
  readonly status: RegistrationCase['status'] | ''
  readonly evidence: '' | 'none' | 'nin'
}

export type CaseList =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly text: string }
  | {
    readonly kind: 'ready'
    readonly items: readonly RegistrationCaseListItem[]
    readonly nextCursor: string | null
    readonly moreLoading: boolean
    /** Why the last "Load more" failed; the rows read stay. */
    readonly moreError: string
    /** "Load more" reached the last page: the list says every registration in it is shown. */
    readonly ended: boolean
  }

/** What a "Load more" came to: more left, the last page, failed, restarted from the top, or overtaken by another read. */
export type MoreAnswer = 'more' | 'end' | 'failed' | 'restarted' | 'stale'

const FIRST: CaseFilter = { view: 'mine', status: '', evidence: '' }

function queryOf(filter: CaseFilter, cursor?: string): RegistrationCaseListQuery {
  return {
    view: filter.view,
    ...(filter.status ? { status: filter.status } : {}),
    ...(filter.evidence ? { evidence: filter.evidence } : {}),
    ...(cursor ? { cursor } : {}),
  }
}

const codeOf = (caught: unknown) => (caught instanceof HidApiError ? caught.code : '')

export function useRegistrationCases(facilityId: string, canApprove: boolean) {
  const [filter, setFilterState] = useState<CaseFilter>(FIRST)
  const [list, setList] = useState<CaseList>({ kind: 'loading' })
  // What the list said of its own accord (all registrations refused, a page link it did not issue), above the rows.
  const [notice, setNotice] = useState('')
  // Identity refused all registrations to this member (REGISTRATION_CASE_LIST_DENIED): the choice is not offered again.
  const [allRefused, setAllRefused] = useState(false)
  // Each first read, counted: an answer is taken only while it is the latest, so a choice changed meanwhile wins.
  const reads = useRef(0)
  const canSeeAll = canApprove && !allRefused

  /**
   * Identity refused all registrations to this member (REGISTRATION_CASE_LIST_DENIED, on a first page or a later one):
   * back to their own registrations, which the change of choice reads, and the choice is not offered again.
   */
  const refuseAll = useCallback(() => {
    reads.current += 1
    setAllRefused(true)
    setNotice(LIST_DENIED)
    setFilterState(previous => ({ ...previous, view: 'mine', evidence: '' }))
  }, [])

  const read = useCallback(async (asked: CaseFilter) => {
    reads.current += 1
    const seq = reads.current
    setList({ kind: 'loading' })
    try {
      const page = await staffApi.listRegistrationCases(facilityId, queryOf(asked))
      if (seq !== reads.current) return
      setList({ kind: 'ready', items: page.cases, nextCursor: page.nextCursor, moreLoading: false, moreError: '', ended: false })
    } catch (caught) {
      if (seq !== reads.current) return
      if (asked.view === 'facility' && codeOf(caught) === 'REGISTRATION_CASE_LIST_DENIED') { refuseAll(); return }
      setList({ kind: 'error', text: listErrorText(caught, LIST_FAILED) })
    }
  }, [facilityId, refuseAll])

  // The filter shown now, for a read asked for after an await (a registration started here), which may outlive a render.
  const shown = useRef(filter)
  useEffect(() => {
    shown.current = filter
    void read(filter)
  }, [read, filter])

  /** A choice of list or a filter: the first page of what is chosen is read, and what the list said before goes. */
  const choose = useCallback((next: Partial<CaseFilter>) => {
    if (next.view === 'facility' && !canSeeAll) return
    setNotice('')
    setFilterState(previous => ({ ...previous, ...next }))
  }, [canSeeAll])

  /** Reads the first page of the list shown again ("Try again", or after a registration is started here). */
  const reload = useCallback(() => { setNotice(''); void read(shown.current) }, [read])

  /** The next page, under the rows read. */
  async function loadMore(): Promise<MoreAnswer> {
    if (list.kind !== 'ready' || list.moreLoading || !list.nextCursor) return 'stale'
    const seq = reads.current
    const cursor = list.nextCursor
    setNotice('')
    setList({ ...list, moreLoading: true, moreError: '' })
    try {
      const page = await staffApi.listRegistrationCases(facilityId, queryOf(filter, cursor))
      if (seq !== reads.current) return 'stale'
      // A cursor that does not move on, or an empty page, would offer the same page for ever.
      const next = page.nextCursor && page.nextCursor !== cursor && page.cases.length > 0 ? page.nextCursor : null
      setList(previous => {
        if (previous.kind !== 'ready') return previous
        const known = new Set(previous.items.map(item => item.caseId))
        return {
          kind: 'ready', items: [...previous.items, ...page.cases.filter(item => !known.has(item.caseId))], nextCursor: next,
          moreLoading: false, moreError: '', ended: next === null,
        }
      })
      return next ? 'more' : 'end'
    } catch (caught) {
      if (seq !== reads.current) return 'stale'
      if (filter.view === 'facility' && codeOf(caught) === 'REGISTRATION_CASE_LIST_DENIED') { refuseAll(); return 'restarted' }
      if (codeOf(caught) === 'REGISTRATION_CASE_CURSOR_INVALID') {
        // Identity did not issue that page: the list starts again from its first page, and says so.
        void read(shown.current)
        setNotice(LIST_RESTARTED)
        return 'restarted'
      }
      setList(previous => (previous.kind === 'ready' ? { ...previous, moreLoading: false, moreError: listErrorText(caught, MORE_FAILED) } : previous))
      return 'failed'
    }
  }

  /**
   * A case as Identity last answered it (opened, decided, enrolled): its row, where the list shows it, says the same.
   * Its name, date of birth and start stay the list's. A case Identity has changed since the list was read (a later
   * version) was updated now, as far as this page knows; one whose status no longer matches the Status filter leaves
   * the list, which then shows only what the filter asks for (it stays under "Find registration case" for this visit).
   */
  const patch = useCallback((item: RegistrationCase) => {
    setList(previous => {
      if (previous.kind !== 'ready' || !previous.items.some(row => row.caseId === item.caseId)) return previous
      const status = shown.current.status
      if (status && item.status !== status) return { ...previous, items: previous.items.filter(row => row.caseId !== item.caseId) }
      return {
        ...previous,
        items: previous.items.map(row => (row.caseId === item.caseId ? {
          ...row, status: item.status, version: item.version, candidateCount: item.candidateCount,
          ...(item.version > row.version ? { updatedAt: new Date().toISOString() } : {}),
          ...(item.patient ? { patient: item.patient } : {}),
          ...(item.ninStatus ? { ninStatus: item.ninStatus } : {}),
          ...(item.identityEvidence ? { identityEvidence: item.identityEvidence } : {}),
        } : row)),
      }
    })
  }, [])

  return { filter, list, notice, canSeeAll, choose, reload, loadMore, patch }
}

export type RegistrationCases = ReturnType<typeof useRegistrationCases>
