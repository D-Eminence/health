import { useEffect, useRef, useState } from 'react'
import { ImportedHistory } from '../../ImportedHistory'
import { parseImportedRecords, type ImportedRecordsResponse } from '../../importedRecords'
import { staffApi } from '../api'
import { getEnvironment } from '../env'
import { plainErrorText } from '@hid/http'

/** Mounted with a patient/facility/actor key, so a previous scope never survives. */
export function ImportedPatientHistory({ facilityId, patientId, purpose, canDownload, verify }: {
  facilityId: string; patientId: string; purpose: 'direct-care' | 'emergency'; canDownload: boolean; verify: () => Promise<void>
}) {
  const [data, setData] = useState<ImportedRecordsResponse | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [revision, setRevision] = useState(0)
  const check = useRef(verify)
  check.current = verify
  useEffect(() => {
    const controller = new AbortController()
    setData(null); setLoading(true); setError('')
    void (async () => {
      try {
        // This patient was opened through governed access. The GET independently
        // enforces the current facility, purpose and consent on the server.
        const result = await staffApi.importedRecords(facilityId, patientId, purpose, controller.signal)
        const importedRecords = parseImportedRecords(result.importedRecords)
        if (!controller.signal.aborted) setData({ ...result, importedRecords })
      } catch (caught) {
        if (!controller.signal.aborted) setError(plainErrorText(caught, 'Imported history could not be loaded.', { audience: 'facility' }))
      } finally { if (!controller.signal.aborted) setLoading(false) }
    })()
    return () => controller.abort()
  }, [facilityId, patientId, purpose, revision])
  return <div>
    {loading && <p role="status">Loading imported medical history…</p>}
    {error && <div><h2>Imported medical history</h2><p role="alert">{error}</p>
      <button type="button" onClick={() => setRevision(value => value + 1)}>Retry imported history</button></div>}
    {data && !loading && !error && <ImportedHistory records={data.importedRecords} limit={data.limit}
      allowLocalHttp={getEnvironment().name === 'local'} download={canDownload ? async (id, signal) => {
        await check.current()
        if (signal.aborted) throw new Error('The attachment request was cancelled.')
        return staffApi.importedAttachment(facilityId, patientId, id, purpose, signal)
      } : undefined} />}
  </div>
}
