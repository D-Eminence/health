import { Button } from '../../kasuwa/ui'
/** The id of the name and the check that goes with it, which the contact field is also described by. */
export const RECORD_NAME_ID = 'enroll-record-name'

/**
 * The full name on the NIN record (EnrollmentProgress.recordName), under "NIN
 * verified", so the person can check that the NIN they typed is theirs before
 * going on (owner decision). Shown from the contact step until activation, with
 * "Use a different NIN" for a name that is not theirs while registration is
 * open (onDifferentNin given). Otherwise the advice is to stop and let this
 * registration close. The button is outside the description, so the contact
 * field is not described by its label.
 */
export function RecordName({ name, busy, onDifferentNin }: { name: string; busy: boolean; onDifferentNin?: () => void }) {
  return <div className="flex flex-col gap-1.5 rounded-xl p-4 text-[13.5px] text-ink ring-1 ring-line [&_p]:m-0">
    <p className="font-medium text-success-ink">NIN verified</p>
    <div id={RECORD_NAME_ID} className="flex flex-col gap-1 text-ink-2 [&_strong]:text-ink">
      <p>Name on your NIN record: <strong>{name}</strong></p>
      {onDifferentNin
        ? <p>Not your name? The NIN you typed may be wrong. Check your NIN slip or the NIMC app, then use a different NIN.</p>
        : <p>Not your name? Stop here and check your NIN slip or the NIMC app. This registration closes by itself within 24 hours; then start again with the right NIN.</p>}
    </div>
    {onDifferentNin && <Button variant="link" className="-my-2 self-start" disabled={busy} onClick={onDifferentNin}>Use a different NIN</Button>}
  </div>
}
