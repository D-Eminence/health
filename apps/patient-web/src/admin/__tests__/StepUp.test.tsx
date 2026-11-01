import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { HidApiError } from '@hid/http'
import { StepUpProvider } from '../StepUp'
import { useGovernedSubmit } from '../ui'

const mocks = vi.hoisted(() => ({ stepUp: vi.fn(), keys: 0 }))
vi.mock('../api', () => ({
  adminApi: { stepUp: mocks.stepUp },
  newIdempotencyKey: () => `submission-${++mocks.keys}`,
}))

const problem = (status: number, code: string) => new HidApiError(status, 'Backend detail', { code })

function Command({ name, command }: { name: string; command: (key: string) => Promise<string> }) {
  const governed = useGovernedSubmit()
  const [result, setResult] = useState<string | null>(null)
  return <div>
    <button type="button" onClick={() => void governed.submit(command, 'The command failed.').then(value => {
      if (value) setResult(value)
    })}>{name}</button>
    {governed.error && <p role="alert">{name}: {governed.error}</p>}
    {result && <p>{name} done: {result}</p>}
  </div>
}

function enterCode(code: string) {
  fireEvent.change(screen.getByLabelText('Sign-in code'), { target: { value: code } })
  fireEvent.click(screen.getByRole('button', { name: 'Confirm and continue' }))
}

beforeEach(() => { vi.clearAllMocks(); mocks.keys = 0 })

describe('step-up for high-risk actions', () => {
  it('asks for a code only after the backend requires it, then repeats the same submission once', async () => {
    const command = vi.fn<(key: string) => Promise<string>>()
      .mockRejectedValueOnce(problem(403, 'STEP_UP_REQUIRED'))
      .mockResolvedValueOnce('saved')
    mocks.stepUp.mockResolvedValueOnce({ stepUpExpiresAt: '2026-10-08T12:05:00.000Z' })
    render(<StepUpProvider><Command name="Disable control" command={command} /></StepUpProvider>)

    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Disable control' }))
    expect(await screen.findByRole('dialog')).toBeTruthy()
    expect(screen.getByText(/Nothing has changed yet\./)).toBeTruthy()
    expect(command).toHaveBeenCalledTimes(1)

    enterCode('123456')
    expect(await screen.findByText('Disable control done: saved')).toBeTruthy()
    expect(mocks.stepUp).toHaveBeenCalledWith('123456')
    // The repeat is the same command: same idempotency key, no second submission.
    expect(command.mock.calls).toEqual([['submission-1'], ['submission-1']])
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('treats an expired step-up like a missing one and says the last confirmation is too old (Stage 4A)', async () => {
    const command = vi.fn<(key: string) => Promise<string>>()
      .mockRejectedValueOnce(problem(403, 'STEP_UP_EXPIRED'))
      .mockResolvedValueOnce('saved')
    mocks.stepUp.mockResolvedValueOnce({ stepUpExpiresAt: '2026-10-08T12:05:00.000Z' })
    render(<StepUpProvider><Command name="Change role" command={command} /></StepUpProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Change role' }))
    expect(await screen.findByRole('dialog')).toBeTruthy()
    expect(screen.getByText('Your last code was more than 5 minutes ago.')).toBeTruthy()
    enterCode('123456')
    expect(await screen.findByText('Change role done: saved')).toBeTruthy()
    expect(command.mock.calls).toEqual([['submission-1'], ['submission-1']])
  })

  it('does not say a confirmation expired when the session has none', async () => {
    const command = vi.fn<(key: string) => Promise<string>>().mockRejectedValueOnce(problem(403, 'STEP_UP_REQUIRED'))
      .mockResolvedValueOnce('saved')
    render(<StepUpProvider><Command name="Change status" command={command} /></StepUpProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Change status' }))
    expect(await screen.findByRole('dialog')).toBeTruthy()
    expect(screen.queryByText(/more than 5 minutes old/)).toBeNull()
  })

  it('does not carry out the action when the administrator cancels', async () => {
    const command = vi.fn<(key: string) => Promise<string>>().mockRejectedValue(problem(403, 'STEP_UP_REQUIRED'))
    render(<StepUpProvider><Command name="Revoke sessions" command={command} /></StepUpProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Revoke sessions' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent',
      'Revoke sessions: You cancelled the code check, so nothing was changed.')
    expect(command).toHaveBeenCalledTimes(1)
    expect(mocks.stepUp).not.toHaveBeenCalled()
  })

  it('keeps asking after a rejected or rate-limited code and never repeats the action without a confirmation', async () => {
    const command = vi.fn<(key: string) => Promise<string>>()
      .mockRejectedValueOnce(problem(403, 'STEP_UP_REQUIRED')).mockResolvedValueOnce('done')
    mocks.stepUp
      .mockRejectedValueOnce(problem(401, 'MFA_INVALID_CODE'))
      .mockRejectedValueOnce(problem(429, 'MFA_RATE_LIMITED'))
      .mockResolvedValueOnce({ stepUpExpiresAt: '2026-10-08T12:05:00.000Z' })
    render(<StepUpProvider><Command name="Export" command={command} /></StepUpProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Export' }))
    await screen.findByRole('dialog')

    enterCode('111111')
    expect(await screen.findByText(/Each code works only once/)).toBeTruthy()
    enterCode('222222')
    expect(await screen.findByText(/Wait 15 minutes and try again/)).toBeTruthy()
    expect(command).toHaveBeenCalledTimes(1)
    enterCode('333333')
    expect(await screen.findByText('Export done: done')).toBeTruthy()
    expect(command).toHaveBeenCalledTimes(2)
  })

  it('shows other refusals directly without asking for a code', async () => {
    const command = vi.fn<(key: string) => Promise<string>>().mockRejectedValue(problem(403, 'PERMISSION_DENIED'))
    render(<StepUpProvider><Command name="Grant" command={command} /></StepUpProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Grant' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent',
      'Grant: Your account does not have permission for this action.')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('reports the backend refusal instead of looping when step-up is still required after confirming', async () => {
    const command = vi.fn<(key: string) => Promise<string>>().mockRejectedValue(problem(403, 'STEP_UP_REQUIRED'))
    mocks.stepUp.mockResolvedValue({ stepUpExpiresAt: '2026-10-08T12:05:00.000Z' })
    render(<StepUpProvider><Command name="Approve" command={command} /></StepUpProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    await screen.findByRole('dialog')
    enterCode('123456')
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringMatching(/It was not carried out/))
    expect(command).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('uses one confirmation for actions that need it at the same time', async () => {
    const first = vi.fn<(key: string) => Promise<string>>()
      .mockRejectedValueOnce(problem(403, 'STEP_UP_REQUIRED')).mockResolvedValueOnce('one')
    const second = vi.fn<(key: string) => Promise<string>>()
      .mockRejectedValueOnce(problem(403, 'STEP_UP_REQUIRED')).mockResolvedValueOnce('two')
    mocks.stepUp.mockResolvedValueOnce({ stepUpExpiresAt: '2026-10-08T12:05:00.000Z' })
    render(<StepUpProvider><Command name="First" command={first} /><Command name="Second" command={second} /></StepUpProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'First' }))
    fireEvent.click(screen.getByRole('button', { name: 'Second' }))
    await waitFor(() => expect(second).toHaveBeenCalledTimes(1))
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    enterCode('123456')
    expect(await screen.findByText('First done: one')).toBeTruthy()
    expect(await screen.findByText('Second done: two')).toBeTruthy()
    expect(mocks.stepUp).toHaveBeenCalledTimes(1)
  })
})
