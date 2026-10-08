import { useCallback, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { ResourceView, useResource } from '../ui'

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
    expect(screen.getByText('Refreshing current information…')).toBeTruthy()
    expect(screen.getByText('Saved alpha')).toBeTruthy()
    await act(async () => resolve(['alpha']))
    expect(screen.queryByText('Refreshing current information…')).toBeNull()
    expect(screen.getByText('Saved alpha')).toBeTruthy()
  })

  it('starts empty for a new query instead of showing the previous results as current', async () => {
    const load = vi.fn().mockResolvedValueOnce(['alpha']).mockImplementationOnce(() => new Promise<string[]>(() => undefined))
    render(<Harness load={load} />)
    await screen.findByText('alpha')
    fireEvent.click(screen.getByRole('button', { name: 'New query' }))
    expect(await screen.findByText('Loading current information…')).toBeTruthy()
    expect(screen.queryByText('alpha')).toBeNull()
    expect(load).toHaveBeenLastCalledWith('second')
  })
})
