import type * as ApiModuleNs from '../../api'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MediaRefused } from '@hid/offline'
import { openVault, PILOT, snapshotOf } from './offlineFixture'

type ApiModule = typeof ApiModuleNs

/** Review item 16 (A12.10): a file the device cannot keep still uploads online as today; only offline is it refused. */
const api = vi.hoisted(() => ({ uploadDocument: vi.fn() }))
vi.mock('../../api', async importOriginal => {
  const original = await importOriginal<ApiModule>()
  return { ...original, staffApi: { ...original.staffApi, ...api } }
})
vi.mock('../../env', () => ({ getEnvironment: () => ({ apiBaseUrl: 'https://gateway.example.test' }) }))
const { setOfflineRuntimeForTests } = await import('../runtime')
const { documentCommands } = await import('../documentCommands')

const PATIENT = 'b1000000-0000-4000-8000-00000000a7c3'
const bigPdf = () => new File([new Uint8Array([37, 80, 68, 70])], 'scan.pdf', { type: 'application/pdf' })

afterEach(() => { setOfflineRuntimeForTests(undefined); api.uploadDocument.mockReset() })

describe('a file the device cannot keep', () => {
  it('uploads online in one call when Health ID can be reached', async () => {
    const fake = await openVault(snapshotOf(PILOT))
    setOfflineRuntimeForTests(fake.runtime)
    vi.spyOn(fake.runtime, 'stageMedia').mockRejectedValue(new MediaRefused('too-large'))
    api.uploadDocument.mockResolvedValue('doc-1')
    const file = bigPdf()
    const outcome = await documentCommands.uploadDocument(PILOT, PATIENT, 'enc-1', file, 'key-1')
    expect(outcome).toMatchObject({ kind: 'applied', value: 'doc-1' })
    expect(api.uploadDocument).toHaveBeenCalledTimes(1)
    expect(api.uploadDocument).toHaveBeenCalledWith(PILOT, PATIENT, 'enc-1', file, 'key-1')
    expect(fake.controls.commands()).toEqual([])
  })

  it('offline, says why the device refused it', async () => {
    const fake = await openVault(snapshotOf(PILOT))
    setOfflineRuntimeForTests(fake.runtime)
    fake.controls.setConnectivity('offline')
    vi.spyOn(fake.runtime, 'stageMedia').mockRejectedValue(new MediaRefused('too-large'))
    await expect(documentCommands.uploadDocument(PILOT, PATIENT, 'enc-1', bigPdf(), 'key-1')).rejects.toThrow('This file is too large to keep on this device.')
    expect(api.uploadDocument).not.toHaveBeenCalled()
  })

  it('a type the device refuses is refused online too (EHR would refuse it as well)', async () => {
    const fake = await openVault(snapshotOf(PILOT))
    setOfflineRuntimeForTests(fake.runtime)
    vi.spyOn(fake.runtime, 'stageMedia').mockRejectedValue(new MediaRefused('type'))
    await expect(documentCommands.uploadDocument(PILOT, PATIENT, 'enc-1', bigPdf(), 'key-1')).rejects.toThrow(/Only PDF, JPEG, PNG and TIFF/)
    expect(api.uploadDocument).not.toHaveBeenCalled()
  })
})
