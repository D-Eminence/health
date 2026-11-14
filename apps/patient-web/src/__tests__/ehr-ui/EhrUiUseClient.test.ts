import { describe, expect, it } from 'vitest'
import { ehrFiles, readEhrFile } from './ehrCss'

/**
 * The public site renders @hid/ui from server components, whose React has no
 * context, state or effect hooks and no portals. FieldDescription.test.tsx
 * checks the top-level packages/ui/src modules; this checks every module in
 * packages/ui/src/ehr, subfolders included: one that needs the client says
 * 'use client' first.
 */

const CLIENT_ONLY = /\b(?:createContext|useContext|useState|useReducer|useEffect|useLayoutEffect|useInsertionEffect|useRef|useId|useMemo|useCallback|useSyncExternalStore|useImperativeHandle|useTransition|useDeferredValue|useOptimistic|useActionState|createPortal|useEhrShell)\b/
const modules = ehrFiles().filter(file => /\.(ts|tsx)$/.test(file)).map(file => [file, readEhrFile(file)] as const)

describe("'use client' in packages/ui/src/ehr", () => {
  it('finds the modules', () => {
    expect(modules.map(([file]) => file)).toEqual(expect.arrayContaining(['index.ts', 'tokens.ts', 'EhrAppShell.tsx', 'EhrDialog.tsx']))
  })

  it.each(modules)('%s', (_, source) => {
    if (CLIENT_ONLY.test(source)) expect(source.trimStart().startsWith("'use client'")).toBe(true)
  })

  it('reads no window or document while a module loads', () => {
    for (const [file, source] of modules) {
      // Top-level statements only: lines that start at column 0 and are not inside a function body.
      const topLevel = source.split('\n').filter(line => /^(?:const|let|var|export const|export let)\b/.test(line))
      expect(topLevel.filter(line => /\b(window|document|navigator|matchMedia|localStorage|sessionStorage)\b/.test(line)), file).toEqual([])
    }
  })
})
