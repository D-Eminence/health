import { afterEach, beforeEach, expect, vi, type MockInstance } from 'vitest'
import { screen, within } from '@testing-library/react'
import { Route, Routes, useLocation } from 'react-router-dom'
import { samplePages } from '../../../../ehr-blue/departments/sample/pages'
import { renderDept } from '../harness'

/**
 * Shared helpers for the sample workspaces' tests. The pages run as the frame mounts them: each sample page at
 * /ehr/<path> ('/ehr/insurance/*'), beside one another, so connected records can move between them. The frame draws
 * the tabs (sampleInFrame.test.tsx); here the pages run without it.
 */

/** Shows where the router is, so a test can check nothing about a record reaches the address. */
function Where() {
  const location = useLocation()
  return <div data-testid="where">{`${location.pathname}${location.search}${location.hash}`}</div>
}

export function renderSample(path: string) {
  return renderDept(
    <>
      <Routes>
        {samplePages.map(page => <Route key={page.path} path={`/ehr/${page.path}`} element={page.element} />)}
      </Routes>
      <Where />
    </>,
    { route: `/ehr/${path}` },
  )
}

export function where() {
  return screen.getByTestId('where').textContent
}

export function heading() {
  return screen.getByRole('heading', { level: 1 })
}

export const SAMPLE_TEXT = 'Sample only: not connected to Health ID yet. Nothing you do here is saved.'

/** The page's sample notice, checked to be the first thing right under its heading, in its exact words. */
export function noticeUnderHeading() {
  const notice = screen.getByRole('note')
  expect(notice.textContent).toBe(SAMPLE_TEXT)
  expect(heading().closest('.hid-ehr-page-heading')?.nextElementSibling).toBe(notice)
  return notice
}

/** The record view's "Saved record" values, label to value. */
export function savedFacts() {
  const card = screen.getByRole('heading', { name: 'Saved record' }).closest('section')!
  const facts: Record<string, string> = {}
  for (const term of within(card).getAllByRole('term')) facts[term.textContent ?? ''] = term.nextElementSibling?.textContent ?? ''
  return facts
}

/** The record's status, as the badge under its title shows it. */
export function statusBadge() {
  return document.querySelector('.hid-ehr-dept-context .hid-ehr-badge')?.textContent
}

/** The buttons in "Available actions". */
export function actionButtons() {
  const card = screen.getByRole('heading', { name: 'Available actions' }).closest('section')!
  return within(card).queryAllByRole('button').filter(button => button.hasAttribute('aria-expanded'))
}

/**
 * Watches for anything a sample page must never do: touch browser storage, or make a request. Each test file mocks
 * the staff API and session itself and checks no member is touched.
 */
export function guardBrowser() {
  const storage: MockInstance[] = []
  const fetchSpy = vi.fn()
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    for (const method of ['getItem', 'setItem', 'removeItem', 'clear', 'key'] as const) storage.push(vi.spyOn(Storage.prototype, method))
    vi.stubGlobal('fetch', fetchSpy)
  })
  afterEach(() => {
    for (const spy of storage) expect(spy).not.toHaveBeenCalled()
    storage.length = 0
    expect(localStorage.length).toBe(0)
    expect(sessionStorage.length).toBe(0)
    expect(fetchSpy).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
}
