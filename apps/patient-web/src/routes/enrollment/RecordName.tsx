/** The id of the name, which the contact field is also described by. */
export const RECORD_NAME_ID = 'enroll-record-name'

/**
 * The full name on the NIN record (EnrollmentProgress.recordName), under "NIN
 * verified", so the person can check that the NIN they typed is theirs before
 * going on (owner decision). Shown from the contact step until activation.
 */
export function RecordName({ name }: { name: string }) {
  return <section className="patient-inline-success" aria-label="NIN verified">
    <p><strong>NIN verified</strong></p>
    <p id={RECORD_NAME_ID}>Name on your NIN record: <strong>{name}</strong></p>
    <p>Check that this is your name before you continue.</p>
  </section>
}
