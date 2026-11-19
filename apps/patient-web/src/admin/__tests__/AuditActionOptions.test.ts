import { describe, expect, it } from 'vitest'
import { ACTION_GROUPS, hasActionOption } from '../auditWords'
import { BACKEND_AUDIT_ACTIONS } from './backendAuditActions'

/**
 * Support can filter the platform audit log by every action the backend writes (coordinator's review of #265): each
 * one has its own option in the What happened filter, worded, never a code. Request-log rows (api.*) are not
 * filterable by action and are not in the list.
 */
const choices = ACTION_GROUPS.flatMap(group => group.choices)
const CODE_IN_TEXT = /[a-z0-9]+\.[a-z0-9]+|[A-Za-z]+_[A-Za-z]+|\bapi\b|[{}<>`]/
const FALLBACK_WORDING = /\((?:second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|another) kind\)|\(kind \d+\)/

describe('the What happened filter and the actions the backend writes', () => {
  it('lists the backend actions once each, request-log names left out', () => {
    expect(BACKEND_AUDIT_ACTIONS.length).toBeGreaterThan(0)
    expect(new Set(BACKEND_AUDIT_ACTIONS).size).toBe(BACKEND_AUDIT_ACTIONS.length)
    expect(BACKEND_AUDIT_ACTIONS.filter(code => code.startsWith('api.'))).toEqual([])
  })

  it('gives every action the backend writes exactly one option, worded with no code', () => {
    const missing = BACKEND_AUDIT_ACTIONS.filter(code => choices.filter(choice => choice.code === code).length !== 1)
    expect(missing).toEqual([])
    for (const code of BACKEND_AUDIT_ACTIONS) {
      const text = choices.find(choice => choice.code === code)?.text ?? ''
      expect(text, code).not.toBe('')
      expect(text, code).not.toMatch(CODE_IN_TEXT)
      expect(text, code).not.toContain(code)
      // Its own words, not "(second kind)": two actions never share an option's text.
      expect(text, code).not.toMatch(FALLBACK_WORDING)
      expect(hasActionOption(code), code).toBe(true)
    }
  })

  it('has an option for each action the coordinator named on #265', () => {
    const named = ['auth.login.refused', 'auth.sso.logout', 'auth.sso.backchannel-logout', 'ehr.allergy.create',
      'ehr.allergy.list', 'ehr.allergy.check', 'ehr.allergy.entered-in-error', 'ehr.prescription.duplicate-check',
      'ehr.encounter.open-today', 'ehr.vital.latest', 'identity.registration-case.list', 'lab.import.list',
      'lab.work-item.progress.read', 'ocr.job.list', 'ocr.quality.summary.read', 'ehr.patient.chat.source.read']
    for (const code of named) {
      expect(BACKEND_AUDIT_ACTIONS, code).toContain(code)
      expect(hasActionOption(code), code).toBe(true)
    }
    const text = (code: string) => choices.find(choice => choice.code === code)?.text
    expect(text('auth.login.refused')).toBe('Sign-in refused')
    expect(text('ehr.allergy.create')).toBe('Recorded an allergy')
    expect(text('auth.sso.logout')).not.toBe(text('auth.logout'))
  })
})
