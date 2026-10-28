import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type Ref } from 'react'

/** A health facility in Nigeria: its name, state and kind. */
export interface Facility { readonly name: string; readonly state: string; readonly type: string }

/**
 * hid-1.0's hospital directory (public/nigeria_health_facilities_deduped.xlsx, sheet
 * "Cleaned Facilities"), as [name, state, type] rows. About 1.6 MB, so it is loaded
 * only once someone starts on the field, in its own chunk.
 */
let directory: Promise<readonly Facility[]> | null = null
export function loadFacilities(): Promise<readonly Facility[]> {
  directory ??= import('./nigeriaHealthFacilities.json')
    .then(module => (module.default as string[][]).map(([name = '', state = '', type = '']) => ({ name, state, type })))
    .catch(() => { directory = null; return [] })
  return directory
}

const MAX_SUGGESTIONS = 8

/** Names that start with the text first, then names that contain it. */
export function suggest(facilities: readonly Facility[], text: string): Facility[] {
  const query = text.trim().toLowerCase()
  if (query.length < 2) return []
  const starts: Facility[] = []
  const contains: Facility[] = []
  for (const facility of facilities) {
    const name = facility.name.toLowerCase()
    if (name.startsWith(query)) starts.push(facility)
    else if (name.includes(query)) contains.push(facility)
    if (starts.length >= MAX_SUGGESTIONS) break
  }
  return [...starts, ...contains].slice(0, MAX_SUGGESTIONS)
}

/**
 * "Hospital you currently use (optional)": free text, with suggestions from the
 * hospital directory as the person types, as hid-1.0's sign-up offered. A combobox:
 * arrow keys move through the suggestions, Enter picks one, Escape closes them.
 */
export function HospitalPicker({ id: inputId, inputRef, value, onChange, invalid, describedBy }: {
  id: string
  inputRef?: Ref<HTMLInputElement>
  value: string
  onChange: (value: string) => void
  invalid?: boolean
  describedBy?: string
}) {
  const id = useId()
  const listId = `${id}-suggestions`
  const [facilities, setFacilities] = useState<readonly Facility[]>([])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const area = useRef<HTMLDivElement>(null)
  const suggestions = useMemo(() => suggest(facilities, value), [facilities, value])
  const shown = open && suggestions.length > 0

  const start = () => { void loadFacilities().then(setFacilities) }
  useEffect(() => {
    const close = (event: PointerEvent) => { if (!area.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [])

  const pick = (facility: Facility) => { onChange(facility.name); setOpen(false); setActive(-1) }
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' && suggestions.length > 0) {
      event.preventDefault(); setOpen(true); setActive(index => (index + 1) % suggestions.length)
    } else if (event.key === 'ArrowUp' && suggestions.length > 0) {
      event.preventDefault(); setOpen(true); setActive(index => (index <= 0 ? suggestions.length - 1 : index - 1))
    } else if (event.key === 'Enter' && shown && active >= 0) {
      const facility = suggestions[active]
      if (facility) { event.preventDefault(); pick(facility) }
    } else if (event.key === 'Escape' && shown) {
      event.preventDefault(); setOpen(false); setActive(-1)
    }
  }

  return <div ref={area} className="patient-hospital-picker">
    <input id={inputId} ref={inputRef} role="combobox" aria-autocomplete="list" aria-expanded={shown} aria-controls={listId}
      aria-activedescendant={shown && active >= 0 ? `${listId}-${active}` : undefined}
      autoComplete="off" maxLength={200} value={value}
      onFocus={() => { start(); setOpen(true) }}
      onChange={event => { start(); onChange(event.target.value); setOpen(true); setActive(-1) }}
      onBlur={() => { setOpen(false); setActive(-1) }}
      onKeyDown={onKeyDown} aria-invalid={invalid || undefined} aria-describedby={describedBy} />
    <ul id={listId} role="listbox" aria-label="Hospitals" hidden={!shown} className="patient-hospital-options">
      {shown && suggestions.map((facility, index) => (
        <li key={`${facility.name}-${facility.state}-${index}`} id={`${listId}-${index}`} role="option" aria-selected={index === active}
          onPointerDown={event => event.preventDefault()} onClick={() => pick(facility)}>
          <span>{facility.name}</span><small>{[facility.state, facility.type].filter(Boolean).join(' · ')}</small>
        </li>
      ))}
    </ul>
  </div>
}
