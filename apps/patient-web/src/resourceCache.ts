import { createContext } from 'react'

/**
 * The last answer of each patient read the portal's pages make (routes/usePatientResource.ts), so a page opened
 * again shows what it showed before at once while it reads again. In memory only, never browser storage, and for
 * one account: the answers go as that account signs out, or as another signs in (session.tsx).
 */
export interface PatientResourceCache {
  /** The account the answers are for; another account, or none, drops every answer held. */
  holdFor(account: string | null): void
  read(key: unknown, account: string | null): { value: unknown } | undefined
  /** Kept only while `account` is the one held: a late answer for an account since signed out is not. */
  write(key: unknown, account: string | null, value: unknown): void
}

export function createPatientResourceCache(account: string | null = null): PatientResourceCache {
  let held = account
  let answers = new Map<unknown, unknown>()
  return {
    holdFor(next) {
      if (next === held) return
      held = next
      answers = new Map()
    },
    read(key, forAccount) {
      if (forAccount === null || forAccount !== held || !answers.has(key)) return undefined
      return { value: answers.get(key) }
    },
    write(key, forAccount, value) {
      if (forAccount !== null && forAccount === held) answers.set(key, value)
    },
  }
}

/**
 * The cache and the account signed in, from SessionProvider. Outside it (a page tested on its own) nothing is
 * kept, and every page reads as it opens.
 */
export const PatientResourcesContext = createContext<{ cache: PatientResourceCache; account: string | null } | null>(null)
