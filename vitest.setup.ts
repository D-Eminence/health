import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

// Without this, one test's DOM survives into the next and assertions about
// what is *not* rendered quietly pass against stale markup.
afterEach(cleanup)
