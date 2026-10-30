// Model-based randomised test, seeds 226–300 of 300 (split across four files so they run in parallel). See model.ts.
import { describe, it } from 'vitest'
import { runSequence } from './model'

describe('offline state machine model (seeds 226–300)', () => {
  it('holds I1–I5 and D9 over 75 random sequences of 40 steps', async () => {
    for (let seed = 226; seed <= 300; seed += 1) await runSequence(seed, 40)
  }, 120_000)
})
