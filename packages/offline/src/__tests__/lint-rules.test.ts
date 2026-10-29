// Finding 6 of the coordinator review: NO_KEY_HANDLING and NO_INDEXED_DB catch computed and string-keyed access.
import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'

const eslint = new ESLint()

async function restricted(code: string, file = 'packages/offline/src/somewhere.ts'): Promise<number> {
  const [result] = await eslint.lintText(code, { filePath: file })
  return result!.messages.filter(m => m.ruleId === 'no-restricted-syntax').length
}

describe('guard-rail lint rules', () => {
  const keyCases = [
    'export const a = crypto.subtle.wrapKey',
    "export const b = crypto.subtle['wrapKey']",
    'export const c = crypto.subtle[`unwrapKey`]',
    "const { 'exportKey': ex } = crypto.subtle\nexport { ex }",
    'const { generateKey } = crypto.subtle\nexport { generateKey }',
  ]
  for (const code of keyCases) {
    it(`refuses key handling outside crypto.ts: ${code.split('\n')[0]}`, async () => {
      expect(await restricted(code)).toBeGreaterThan(0)
      expect(await restricted(code, 'packages/offline/src/crypto.ts')).toBe(0)
    })
  }

  for (const code of ["export const d = globalThis['indexedDB']", 'export const e = globalThis.indexedDB']) {
    it(`refuses IndexedDB outside store.ts: ${code}`, async () => {
      expect(await restricted(code)).toBeGreaterThan(0)
      expect(await restricted(code, 'packages/offline/src/store.ts')).toBe(0)
    })
  }

  it('leaves ordinary Web Crypto calls alone', async () => {
    expect(await restricted("export const f = crypto.subtle['digest']")).toBe(0)
  })
}, 60_000)
