import { describe, expect, it } from 'vitest'
import { dayLabel, dayOf, dayWords, groupByDay, matchesQuery, textOf, UNDATED } from './recordSearch'

describe('searching the records on the page', () => {
  it('matches every word, in any case and without accents, anywhere in the record', () => {
    const record = ['Clinical note', 'Follow-up', 'Seen at Lagos Island General Hospital by Dr Okafor', '12 Mar 2026']
    expect(matchesQuery(record, 'okafor')).toBe(true)
    expect(matchesQuery(record, '  LAGOS   general ')).toBe(true)
    expect(matchesQuery(record, 'mar 2026 follow')).toBe(true)
    expect(matchesQuery(record, 'okafor surgery')).toBe(false)
    expect(matchesQuery(['Café visit'], 'cafe')).toBe(true)
  })

  it('matches everything with an empty search, and skips texts that are absent', () => {
    expect(matchesQuery([], '')).toBe(true)
    expect(matchesQuery([null, undefined, 'Encounter'], '   ')).toBe(true)
    expect(matchesQuery([null, 'Encounter'], 'null')).toBe(false)
  })

  it('reads the text in structured details at any depth', () => {
    expect(textOf({ medication_name: 'Amlodipine', doses: [{ amount: 5, unit: 'mg' }], active: true, missing: null }))
      .toEqual(['Amlodipine', '5', 'mg', 'true'])
    expect(textOf('   ')).toEqual([])
  })
})

describe('records under their day', () => {
  it('takes the day in this browser\'s time zone, and a date without a time as its own day', () => {
    const at = new Date(2026, 2, 12, 23, 30)
    expect(dayOf(at.toISOString())).toBe('2026-03-12')
    expect(dayOf('2026-03-12')).toBe('2026-03-12')
    expect(dayOf('not a date')).toBeNull()
    expect(dayOf(null)).toBeNull()
  })

  it('names the day in full', () => {
    expect(dayLabel('2026-03-12')).toBe(new Intl.DateTimeFormat('en-NG', { dateStyle: 'full' }).format(new Date(2026, 2, 12)))
  })

  it('gives a record\'s day heading for the search, so its month and weekday words find it', () => {
    expect(dayWords(new Date(2026, 2, 3, 9).toISOString())).toBe(dayLabel('2026-03-03'))
    expect(matchesQuery([dayWords('2026-03-03')], 'tuesday march')).toBe(true)
    expect(dayWords('garbled')).toBeNull()
    expect(dayWords(null)).toBeNull()
  })

  it('lists the newest day first and the newest record first within a day, then the undated ones', () => {
    const local = (day: number, hour: number) => new Date(2026, 2, day, hour).toISOString()
    const records = [
      { id: 'a', at: local(10, 9) }, { id: 'b', at: local(12, 8) }, { id: 'c', at: null },
      { id: 'd', at: local(12, 17) }, { id: 'e', at: '2026-03-11' }, { id: 'f', at: 'garbled' },
    ]
    const groups = groupByDay(records, record => record.at)
    expect(groups.map(group => group.day)).toEqual(['2026-03-12', '2026-03-11', '2026-03-10', null])
    expect(groups.map(group => group.items.map(item => item.id))).toEqual([['d', 'b'], ['e'], ['a'], ['c', 'f']])
    expect(groups.at(-1)?.label).toBe(UNDATED)
  })

  it('has no groups for no records', () => {
    expect(groupByDay([], () => null)).toEqual([])
  })
})
