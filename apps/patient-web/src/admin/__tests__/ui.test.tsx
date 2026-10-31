import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import type { CursorPage } from '../api'
import { ResourceView, useCursorPages, useResource } from '../ui'

vi.mock('../api', () => ({ newIdempotencyKey: () => 'key-1' }))

/** A list whose rows hold local state (as row action forms do), reloadable and re-queryable. */
function Harness({ load }: { load: (query: string) => Promise<string[]> }) {
  const [query, setQuery] = useState('first')
  const loader = useCallback(() => load(query), [load, query])
  const resource = useResource(loader, 'The list could not be loaded.')
  return <>
    <button type="button" onClick={resource.reload}>Reload</button>
    <button type="button" onClick={() => setQuery('second')}>New query</button>
    <ResourceView resource={resource}>{rows => <ul>{rows.map(row => <Row key={row} name={row} />)}</ul>}</ResourceView>
  </>
}

function Row({ name }: { name: string }) {
  const [saved, setSaved] = useState(false)
  return <li>{name}<button type="button" onClick={() => setSaved(true)}>Save {name}</button>{saved && <span>Saved {name}</span>}</li>
}

describe('resource view', () => {
  it('keeps rows and their confirmations on screen while the same query reloads', async () => {
    let resolve: (rows: string[]) => void = () => undefined
    const load = vi.fn().mockResolvedValueOnce(['alpha']).mockImplementationOnce(() => new Promise<string[]>(done => { resolve = done }))
    render(<Harness load={load} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Save alpha' }))
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }))
    expect(screen.getByRole('status').textContent).toBe('Refreshing…')
    expect(screen.getByText('Refreshing…')).toBeTruthy()
    expect(screen.getByText('Saved alpha')).toBeTruthy()
    await act(async () => resolve(['alpha']))
    expect(screen.queryByText('Refreshing…')).toBeNull()
    expect(screen.getByText('Saved alpha')).toBeTruthy()
  })

  it('starts empty for a new query instead of showing the previous results as current', async () => {
    const load = vi.fn().mockResolvedValueOnce(['alpha']).mockImplementationOnce(() => new Promise<string[]>(() => undefined))
    render(<Harness load={load} />)
    await screen.findByText('alpha')
    fireEvent.click(screen.getByRole('button', { name: 'New query' }))
    expect(await screen.findByRole('status', { name: 'Loading' })).toBeTruthy()
    expect(screen.queryByText('alpha')).toBeNull()
    expect(load).toHaveBeenLastCalledWith('second')
  })
})

/**
 * Asks for the next page as soon as the first page is on screen, before the
 * page's passive effects have run: what a click does when the browser handles it
 * between React's commit and those effects (under load, or on a slow device).
 */
function EagerPages({ load, loadPage }: {
  load: () => Promise<CursorPage<string>>
  loadPage: (cursor: string, signal: AbortSignal) => Promise<CursorPage<string>>
}) {
  const resource = useResource(load, 'The list could not be loaded.')
  const pages = useCursorPages(resource, loadPage, 'More could not be loaded.')
  const asked = useRef(false)
  useLayoutEffect(() => {
    if (resource.data && !asked.current) { asked.current = true; void pages.loadMore() }
  })
  return <ul>{pages.items.map(item => <li key={item}>{item}</li>)}</ul>
}

describe('cursor pages', () => {
  it('keeps a page asked for as soon as the first page appeared', async () => {
    const load = vi.fn(async () => ({ items: ['first row'], nextCursor: 'cursor-2' }))
    const loadPage = vi.fn(async () => ({ items: ['second row'], nextCursor: null }))
    render(<EagerPages load={load} loadPage={loadPage} />)
    expect(await screen.findByText('second row')).toBeTruthy()
    expect(loadPage).toHaveBeenCalledTimes(1)
    expect((loadPage.mock.calls[0] as unknown as [string, AbortSignal])[1].aborted).toBe(false)
  })
})
