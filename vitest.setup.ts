import { afterEach } from 'vitest'
import { cleanup, configure } from '@testing-library/react'

// Without this, one test's DOM survives into the next and assertions about
// what is *not* rendered quietly pass against stale markup.
afterEach(cleanup)

// findBy and waitFor give up after one second by default. GitHub's runners, busy with the whole suite, can take
// longer to show a result, and two tests failed that way on main's CI (runs 38983273017 and 38987960500) while
// passing every time on their own. A wait that is about to succeed does not wait longer; only a failing one does.
//
// Five seconds was not always enough either: on a busy release runner the enrollment tests waited just over five
// seconds for an element (EnrollmentLimits failed the 15:12 release build; EnrollmentAvailability timed out in a
// review run). Ten seconds only lets a slow pass finish; a missing element still fails.
configure({ asyncUtilTimeout: 10000 })
