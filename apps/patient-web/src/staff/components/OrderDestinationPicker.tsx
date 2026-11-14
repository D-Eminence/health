import { useState, type KeyboardEvent } from 'react'
import { Badge, Button, Field, Input } from '@hid/ui'
import { orderRoutesApi, type OrderDestination } from '../api'
import { searchRefusal } from '../orderRoutes'
import { UNAVAILABLE } from '../focus'

/** A query as Identity takes it: spaces collapsed and trimmed, 3 to 80 characters (SPEC-FINAL §3.4). */
function searchQuery(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

/** "Yaba Diagnostics · Yaba Diagnostics Ltd · Registered office: 12 Herbert Macaulay Way, Yaba, Lagos". */
export function destinationLine(destination: OrderDestination): string {
  return [destination.facilityName,
    destination.organizationName && destination.organizationName !== destination.facilityName ? destination.organizationName : null,
    destination.registeredAddress ? `Registered office: ${destination.registeredAddress}` : 'Registered office not on record',
  ].filter(Boolean).join(' · ')
}

/**
 * Picks the laboratory or pharmacy at another facility an order is sent to (Novu, P4c, SPEC-FINAL §13.2): a search of
 * Identity's directory (reviewed or governed facilities listed for orders, at most 10, never this one) with each one's
 * CAC registered office, so two similar names can be told apart. A search is made only when asked: each counts
 * towards the member's 60 an hour.
 */
export function OrderDestinationPicker({ id, facilityId, kind, value, onChange, error }: {
  id: string; facilityId: string; kind: 'laboratory' | 'pharmacy'
  value: OrderDestination | null; onChange: (destination: OrderDestination | null) => void; error?: string
}) {
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [results, setResults] = useState<OrderDestination[] | null>(null)
  const [refused, setRefused] = useState('')
  // Each answer is announced once, even when the count is the same.
  const [answered, setAnswered] = useState(0)
  const typed = searchQuery(query)
  const canSearch = typed.length >= 3 && typed.length <= 80
  const word = kind === 'laboratory' ? 'laboratory' : 'pharmacy'

  async function search() {
    if (searching) return
    if (!canSearch) { setRefused('Type 3 to 80 letters of the facility’s name.'); return }
    setSearching(true); setRefused('')
    try {
      const answer = await orderRoutesApi.destinations(facilityId, kind, typed)
      setResults(Array.isArray(answer?.items) ? answer.items : [])
      setAnswered(count => count + 1)
    } catch (caught) {
      setRefused(searchRefusal(caught))
    } finally { setSearching(false) }
  }

  function enter(event: KeyboardEvent<HTMLInputElement>) {
    // Enter searches here; it does not send the form around it.
    if (event.key !== 'Enter') return
    event.preventDefault()
    void search()
  }

  const count = results?.length ?? 0
  return <div className="staff-order-picker" role="group" aria-labelledby={`${id}-legend`}>
    <p id={`${id}-legend`} className="staff-order-picker-title">{kind === 'laboratory' ? 'Laboratory' : 'Pharmacy'}</p>
    <p className="staff-muted">Ask the patient which {word} they will use.</p>
    <Field label={`Search for the ${word}`} htmlFor={`${id}-query`} error={error}
      hint="Type at least 3 letters of its name, then search.">
      <Input id={`${id}-query`} type="search" autoComplete="off" maxLength={80} value={query}
        onChange={event => setQuery(event.target.value)} onKeyDown={enter} />
    </Field>
    <div className="staff-row"><Button id={`${id}-search`} type="button" tone="secondary" size="sm" aria-disabled={searching || undefined}
      className={UNAVAILABLE} onClick={() => void search()}>{searching ? 'Searching…' : 'Search'}</Button></div>
    <p role="status" className="staff-muted">{searching ? 'Searching…' : results === null ? null
      : <span key={answered}>{count === 0 ? `No ${word} on Health ID matches that name.` : count === 1 ? `1 ${word} found.` : `${count} ${word === 'laboratory' ? 'laboratories' : 'pharmacies'} found.`}</span>}</p>
    {refused && <p role="alert" className="staff-error">{refused}</p>}
    {results && count > 0 && <fieldset className="staff-order-choices">
      <legend>Choose the {word}</legend>
      {results.map(destination => <label key={destination.facilityId} className="staff-choice">
        <input type="radio" name={`${id}-destination`} value={destination.facilityId}
          checked={value?.facilityId === destination.facilityId} onChange={() => onChange(destination)} />
        <span>{destinationLine(destination)}{destination.newOnHealthId && <> <Badge tone="information">New on Health ID</Badge></>}</span>
      </label>)}
    </fieldset>}
    {value && <p className="staff-muted">Chosen: <strong>{destinationLine(value)}</strong>{value.newOnHealthId ? ' (new on Health ID)' : ''}</p>}
    <p className="staff-muted">Not listed? It may not be on Health ID yet, or not checked by Health ID support. Give the patient a paper {kind === 'laboratory' ? 'request' : 'prescription'}.</p>
  </div>
}
