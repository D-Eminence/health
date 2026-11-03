import { describe, expect, it } from 'vitest'
import { OTHER_ACCESS, permissionWords } from '../../../../ehr-blue/departments/facility/permissionWords'

describe('permissionWords', () => {
  it('says what checking access really means: access to a patient’s record', () => {
    expect(permissionWords(['identity.authorization.check'])).toEqual(['Check access to a patient’s record'])
  })

  it('lists each label once and counts codes with no words once as "Other access", never printing a code', () => {
    const words = permissionWords(['ehr.encounter.read', 'ehr.encounter.list', 'made.up', 'constructor'])
    expect(words).toEqual(['See visits', OTHER_ACCESS])
    for (const word of words) expect(word).not.toMatch(/\./)
  })
})
