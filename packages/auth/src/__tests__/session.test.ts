import { describe, expect, it, vi } from 'vitest'
import {
  ALLOWED_PRINCIPAL_FIELDS,
  INITIAL_SESSION_STATE,
  PERSISTED_STORAGE_KEYS,
  clearPortalHint,
  createSessionStore,
  readPortalHint,
  writePortalHint,
} from '../index'
import type { KeyValueStorage } from '../session'
import type { PatientPrincipal, StaffPrincipal } from '../principal'

const patient: PatientPrincipal = {
  kind: 'patient',
  subjectId: 'auth-user-1',
  appRole: 'patient',
  assuranceLevel: 'aal1',
}

const staff: StaffPrincipal = {
  kind: 'staff',
  subjectId: 'auth-user-2',
  appRole: 'clinician',
  assuranceLevel: 'aal2',
  staffRole: 'doctor',
  organizationId: 'org-1',
}

/** An in-memory stand-in that records every write, so we can assert on them. */
function recordingStorage() {
  const values = new Map<string, string>()
  const writes: { key: string; value: string }[] = []

  const storage: KeyValueStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => {
      writes.push({ key, value })
      values.set(key, value)
    },
    removeItem: key => {
      values.delete(key)
    },
  }

  return { storage, writes, values }
}

describe('session store', () => {
  it('starts in an unknown state so guards wait instead of redirecting', () => {
    expect(createSessionStore().getState()).toEqual(INITIAL_SESSION_STATE)
  })

  it('holds the principal in memory once authenticated', () => {
    const store = createSessionStore()
    store.setAuthenticated(patient)

    expect(store.getState()).toEqual({ status: 'authenticated', principal: patient })
  })

  it('keeps the access token out of the observable state', () => {
    const store = createSessionStore()
    store.setAccessToken('token-abc')
    store.setAuthenticated(patient)

    expect(JSON.stringify(store.getState())).not.toContain('token-abc')
    expect(store.getAccessToken()).toBe('token-abc')
  })

  it('drops the token when the session is cleared', () => {
    const store = createSessionStore()
    store.setAccessToken('token-abc')
    store.setAuthenticated(staff)
    store.clear()

    expect(store.getAccessToken()).toBeNull()
    expect(store.getState()).toEqual({ status: 'anonymous', principal: null })
  })

  it('notifies subscribers and stops after unsubscribe', () => {
    const store = createSessionStore()
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)

    store.setAuthenticated(patient)
    expect(listener).toHaveBeenCalledTimes(1)

    unsubscribe()
    store.clear()
    expect(listener).toHaveBeenCalledTimes(1)
  })
})

describe('principal contents', () => {
  it('carries no identifying or clinical fields', () => {
    for (const principal of [patient, staff]) {
      for (const field of Object.keys(principal)) {
        expect(ALLOWED_PRINCIPAL_FIELDS).toContain(field)
      }
    }
  })

  it('has no field whose name suggests a person rather than a subject', () => {
    const forbidden = ['name', 'fullName', 'hidCode', 'phone', 'email', 'dob']
    for (const principal of [patient, staff]) {
      for (const field of forbidden) {
        expect(principal).not.toHaveProperty(field)
      }
    }
  })
})

describe('persistence', () => {
  it('persists only the portal hint', () => {
    const { storage, writes } = recordingStorage()
    writePortalHint('staff', storage)

    expect(writes).toHaveLength(1)
    expect(PERSISTED_STORAGE_KEYS).toContain(writes[0]?.key)
    expect(writes[0]?.value).toBe('staff')
  })

  it('never writes anything that could identify a person', () => {
    const { storage, writes } = recordingStorage()
    writePortalHint('patient', storage)
    writePortalHint('platform', storage)

    for (const write of writes) {
      expect(['patient', 'staff', 'platform']).toContain(write.value)
    }
  })

  it('reads back a stored hint and rejects an unexpected value', () => {
    const { storage } = recordingStorage()
    writePortalHint('platform', storage)
    expect(readPortalHint(storage)).toBe('platform')

    storage.setItem('hid.portal-hint', 'HID-1234-AB')
    expect(readPortalHint(storage)).toBeNull()
  })

  it('clears the hint on request', () => {
    const { storage } = recordingStorage()
    writePortalHint('patient', storage)
    clearPortalHint(storage)

    expect(readPortalHint(storage)).toBeNull()
  })

  it('survives storage being unavailable', () => {
    const throwing: KeyValueStorage = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
      removeItem: () => {
        throw new Error('blocked')
      },
    }

    expect(() => writePortalHint('patient', throwing)).not.toThrow()
    expect(readPortalHint(throwing)).toBeNull()
    expect(() => clearPortalHint(throwing)).not.toThrow()
  })
})
