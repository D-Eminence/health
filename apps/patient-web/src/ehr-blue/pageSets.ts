/**
 * The page folders the blue EHR has: the same './<folder>/pages.ts' keys routes.tsx discovers its pages by. Only the
 * names are read here (a lazy glob, never called), so nothing of the blue EHR loads until it opens.
 */
export const PAGE_FILES: readonly string[] = Object.keys(import.meta.glob('./*/pages.ts'))
