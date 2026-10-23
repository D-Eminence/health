/** The id of the name and the check that goes with it, which the contact field is also described by. */
export const RECORD_NAME_ID = 'enroll-record-name'

/**
 * The full name on the NIN record (EnrollmentProgress.recordName), under "NIN
 * verified", so the person can check that the NIN they typed is theirs before
 * going on (owner decision). Shown from the contact step until activation, with
 * "Use a different NIN" for a name that is not theirs. The button is outside
 * the description, so the contact field is not described by its label.
 */
export function RecordName({ name, busy, onDifferentNin }: { name: string; busy: boolean; onDifferentNin: () => void }) {
  return <div className="patient-inline-success">
    <p><strong>NIN verified</strong></p>
    <div id={RECORD_NAME_ID}>
      <p>Name on your NIN record: <strong>{name}</strong></p>
      <p>Check that this is your name before you continue. If it is not, the NIN you typed may be wrong. Check it on your NIN slip or in the NIMC app, then select Use a different NIN. For help, contact Health ID support.</p>
    </div>
    <button type="button" className="patient-text-button" disabled={busy} onClick={onDifferentNin}>Use a different NIN</button>
  </div>
}
