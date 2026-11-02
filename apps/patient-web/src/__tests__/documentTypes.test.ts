import { act, renderHook } from '@testing-library/react'
import { HidApiError } from '@hid/http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_DOCUMENT_TYPE, DOCUMENT_TYPE_LABELS, DOCUMENT_TYPES, documentTypeLabel, documentTypeOf, documentTypeRefusalText,
  documentTypesHere, documentTypesOn, documentTypesServed, forgetDocumentTypesServed, isDocumentType, learnDocumentTypesFrom,
  learnDocumentTypesServed, saysDocumentTypes, suggestedOcrTarget, useDocumentTypesServed,
} from '../documentTypes'

const ALL = ['clinical_document', 'lab_result', 'prescription_sheet']
const PHARMACY = ['clinical_document', 'prescription_sheet']

describe('the document types', () => {
  it('are the three the contract names, a clinical document first and by default, each with its words', () => {
    expect(DOCUMENT_TYPES).toEqual(ALL)
    expect(DEFAULT_DOCUMENT_TYPE).toBe('clinical_document')
    expect(DOCUMENT_TYPE_LABELS).toEqual({ clinical_document: 'Clinical document', lab_result: 'Lab result',
      prescription_sheet: 'Prescription sheet' })
    expect(DOCUMENT_TYPES.map(documentTypeLabel)).toEqual(['Clinical document', 'Lab result', 'Prescription sheet'])
  })

  it('each suggests the OCR validation’s target domain', () => {
    expect(suggestedOcrTarget('clinical_document')).toBe('EHR')
    expect(suggestedOcrTarget('lab_result')).toBe('LAB')
    expect(suggestedOcrTarget('prescription_sheet')).toBe('PHARMACY')
  })

  it('are recognised only as named', () => {
    for (const type of ALL) expect(isDocumentType(type)).toBe(true)
    for (const value of ['Lab result', 'LAB_RESULT', 'x_ray', '', null, undefined, 1, {}]) expect(isDocumentType(value)).toBe(false)
  })

  it('read from a listed document: none is a clinical document (today’s), an unknown one is nothing', () => {
    expect(documentTypeOf({})).toBe('clinical_document')
    expect(documentTypeOf({ documentType: null })).toBe('clinical_document')
    expect(documentTypeOf({ documentType: 'lab_result' })).toBe('lab_result')
    expect(documentTypeOf({ documentType: 'prescription_sheet' })).toBe('prescription_sheet')
    expect(documentTypeOf({ documentType: 'discharge_letter' })).toBeNull()
    expect(documentTypeOf({ documentType: 7 })).toBeNull()
  })
})

describe('the types a facility may upload on each host', () => {
  it.each([
    ['ehr.healthidentitydirectory.com', ALL],
    ['lab.healthidentitydirectory.com', ALL],
    ['migrate.healthidentitydirectory.com', ALL],
    ['pharmacy.healthidentitydirectory.com', PHARMACY],
    ['outreach.healthidentitydirectory.com', []],
    ['ehr.staging.healthidentitydirectory.com', ALL],
    ['lab.staging.healthidentitydirectory.com', ALL],
    ['migrate.staging.healthidentitydirectory.com', ALL],
    ['pharmacy.staging.healthidentitydirectory.com', PHARMACY],
    ['outreach.staging.healthidentitydirectory.com', []],
  ])('on the product host %s', (hostname, types) => {
    expect(documentTypesOn(hostname)).toEqual(types)
  })

  it.each(['admin.healthidentitydirectory.com', 'admin.staging.healthidentitydirectory.com'])('none on the admin site %s', hostname => {
    expect(documentTypesOn(hostname)).toEqual([])
  })

  it.each([
    'localhost', '127.0.0.1', 'staging.healthidentitydirectory.com', 'app.healthidentitydirectory.com',
    'preview-123.health-upload.pages.dev', 'unknown.example.test', 'lab.healthidentitydirectory.com.evil.example',
  ])('as the EHR on any other host: %s', hostname => {
    expect(documentTypesOn(hostname)).toEqual(ALL)
  })

  it('reads a host as the product list does: any case, a trailing dot', () => {
    expect(documentTypesOn('PHARMACY.HealthIdentityDirectory.com.')).toEqual(PHARMACY)
    expect(documentTypesOn('Outreach.staging.healthidentitydirectory.com')).toEqual([])
    expect(documentTypesOn('ADMIN.healthidentitydirectory.com.')).toEqual([])
  })

  it('offers "Lab result" only on ehr, lab and migrate, and "Prescription sheet" on every facility host', () => {
    const facilityHosts = ['ehr', 'lab', 'pharmacy', 'migrate'].flatMap(product =>
      [`${product}.healthidentitydirectory.com`, `${product}.staging.healthidentitydirectory.com`])
    for (const hostname of facilityHosts) {
      expect(documentTypesOn(hostname)).toContain('prescription_sheet')
      expect(documentTypesOn(hostname)[0]).toBe('clinical_document')
      expect(documentTypesOn(hostname).includes('lab_result')).toBe(!hostname.startsWith('pharmacy.'))
    }
  })

  describe('here', () => {
    afterEach(() => { vi.unstubAllGlobals() })

    it.each([
      ['pharmacy.healthidentitydirectory.com', PHARMACY],
      ['lab.staging.healthidentitydirectory.com', ALL],
      ['outreach.healthidentitydirectory.com', []],
      ['admin.healthidentitydirectory.com', []],
      ['localhost', ALL],
    ])('reads this page’s host: %s', (hostname, types) => {
      vi.stubGlobal('location', { ...window.location, hostname })
      expect(documentTypesHere()).toEqual(types)
    })
  })
})

describe('whether the document types are served', () => {
  beforeEach(() => { forgetDocumentTypesServed() })

  it('is unknown until an answer says, and then stays served for the page’s life', () => {
    expect(documentTypesServed()).toBeNull()
    learnDocumentTypesServed(false)
    expect(documentTypesServed()).toBe(false)
    learnDocumentTypesServed(true)
    expect(documentTypesServed()).toBe(true)
    learnDocumentTypesServed(false)
    expect(documentTypesServed()).toBe(true)
    forgetDocumentTypesServed()
    expect(documentTypesServed()).toBeNull()
  })

  it('is said only by an answer whose documentTypes is exactly true', () => {
    expect(saysDocumentTypes({ items: [], nextCursor: null, documentTypes: true })).toBe(true)
    for (const answer of [{ items: [], nextCursor: null }, { documentTypes: 'true' }, { documentTypes: 1 }, { documentTypes: false },
      [], null, undefined, 'documentTypes', true]) {
      expect(saysDocumentTypes(answer)).toBe(false)
    }
  })

  it('is learned from a list or work list: served when it says so, otherwise not, only while nothing has said otherwise', () => {
    learnDocumentTypesFrom({ items: [], nextCursor: null })
    expect(documentTypesServed()).toBe(false)
    learnDocumentTypesFrom({ items: [], documentTypes: true })
    expect(documentTypesServed()).toBe(true)
    learnDocumentTypesFrom({ items: [] })
    expect(documentTypesServed()).toBe(true)
  })

  it('re-renders a screen when it is learned', () => {
    const { result } = renderHook(() => useDocumentTypesServed())
    expect(result.current).toBeNull()
    act(() => { learnDocumentTypesFrom({ items: [], nextCursor: null, documentTypes: true }) })
    expect(result.current).toBe(true)
    act(() => { forgetDocumentTypesServed() })
    expect(result.current).toBeNull()
  })
})

describe('the refusal of a type on this host', () => {
  it('says where lab results can be uploaded', () => {
    const refused = new HidApiError(403, 'Forbidden', { code: 'DOCUMENT_TYPE_NOT_ALLOWED_HERE' })
    expect(documentTypeRefusalText(refused)).toBe('Lab results can be uploaded only in the EHR, Lab or Migrate.')
  })

  it('leaves any other failure to the screen’s own words', () => {
    expect(documentTypeRefusalText(new HidApiError(403, 'Forbidden', { code: 'FORBIDDEN' }))).toBeNull()
    expect(documentTypeRefusalText(new Error('DOCUMENT_TYPE_NOT_ALLOWED_HERE'))).toBeNull()
    expect(documentTypeRefusalText(null)).toBeNull()
  })
})
