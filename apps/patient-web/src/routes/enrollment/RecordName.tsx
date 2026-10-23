/** The id of the name and the check that goes with it, which the contact field is also described by. */
export const RECORD_NAME_ID = 'enroll-record-name'

/**
 * The full name on the NIN record (EnrollmentProgress.recordName), under "NIN
 * verified", so the person can check that the NIN they typed is theirs before
 * going on (owner decision). Shown from the contact step until activation.
 */
export function RecordName({ name }: { name: string }) {
  return <div className="patient-inline-success">
    <p><strong>NIN verified</strong></p>
    <div id={RECORD_NAME_ID}>
      <p>Name on your NIN record: <strong>{name}</strong></p>
      <p>Check that this is your name before you continue. If it is not, do not continue: the NIN you typed may be wrong. Check it on your NIN slip or in the NIMC app.</p>
    </div>
  </div>
}
