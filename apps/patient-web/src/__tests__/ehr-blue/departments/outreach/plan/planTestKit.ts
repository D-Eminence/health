import { vi } from 'vitest'
import { HidApiError } from '@hid/http'

/*
 * A fictional Outreach for the plan screens' tests: the proposed campaign routes (plan, team) as calls a test can read
 * back, each with its method, path, body and headers. `answers` decides each answer; anything not given is 404 from the
 * gateway (not served).
 */

export interface CampaignCall { readonly method: string; readonly path: string; readonly body?: unknown; readonly headers?: Record<string, string> }

export function campaignRoutes() {
  const calls: CampaignCall[] = []
  const answers: Array<(call: CampaignCall) => unknown> = []
  const request = vi.fn(async (_facilityId: string, spec: CampaignCall) => {
    calls.push(spec)
    for (const answer of answers) {
      const value = answer(spec)
      if (value instanceof Error) throw value
      if (value !== undefined) return value
    }
    throw new HidApiError(404, 'Not Found', { code: 'NOT_FOUND' })
  })
  return {
    calls, request,
    /** Answers a call: return undefined to pass, an Error to refuse, anything else to answer. */
    on(answer: (call: CampaignCall) => unknown) { answers.push(answer) },
    reset() { calls.length = 0; answers.length = 0; request.mockClear() },
    of(method: string, suffix: string) { return calls.filter(call => call.method === method && call.path.endsWith(suffix)) },
  }
}

export const problem = (status: number, code: string) => new HidApiError(status, code, { code })
