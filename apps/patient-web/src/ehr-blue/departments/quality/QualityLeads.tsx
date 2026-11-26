import { useCallback, useEffect, useState } from 'react'
import { EhrButton, EhrDataTable, EhrDrawer, EhrField, EhrSelect, EhrTextarea } from '@hid/ui/ehr'
import { qualityApi, type QualityLead } from '../../../staff/api'
import { useFocusById } from '../../../staff/focus'
import { DeptNotice, type DeptNoticeTone } from '../parts/DeptNotice'
import { DeptPage, DeptSection } from '../parts/DeptPage'
import { useIdempotencyKeys, useStaffDirectory } from './hooks'
import { QualityTabs, type QualityShared } from './parts'
import {
  DESCRIPTION, EYEBROW, LEADS_ADMIN_ONLY, LIMITS, NOT_AVAILABLE, TITLE, cancelled, learnFrom, memberText, notServed, reasonProblem,
  refusalWords, whenText,
} from './qualityRules'

/**
 * Quality leads (routes 13-15; Q-QUAL-1 A): up to 10 staff members of this facility the administrators name, each with a
 * manager's rights here from their next request. A list, not a role: nothing changes on the Staff page. The
 * administrators (quality.incident.manage) name and remove leads; a lead sees the list only. A removed lead's row is
 * kept by the backend; the list shows the active ones.
 */
export function QualityLeads({ facilityId, me, membershipId }: QualityShared) {
  const keyFor = useIdempotencyKeys()
  const focus = useFocusById()
  const [leads, setLeads] = useState<{ leads: readonly QualityLead[]; limit: number } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<{ text: string; unavailable: boolean } | null>(null)
  const [notice, setNotice] = useState<{ tone: DeptNoticeTone; text: string } | null>(null)
  const [naming, setNaming] = useState(false)
  const [ending, setEnding] = useState<QualityLead | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const answer = await qualityApi.leads(facilityId)
      learnFrom()
      setLeads({ leads: answer.leads ?? [], limit: answer.limit ?? 10 })
    } catch (caught) {
      if (cancelled(caught)) return
      learnFrom(caught)
      setError({ text: refusalWords(caught, 'The quality leads could not be loaded. Try again.'), unavailable: notServed(caught) })
    } finally { setLoading(false) }
  }, [facilityId])

  useEffect(() => { void load() }, [load])

  const directory = useStaffDirectory(facilityId, (leads?.leads ?? []).flatMap(lead => [lead.membershipId, lead.namedByMembershipId]))
  const who = (id: string | null | undefined) => memberText(id, membershipId, directory.names, 'A staff member here')
  const full = leads !== null && leads.leads.length >= leads.limit
  const leadIds = new Set((leads?.leads ?? []).map(lead => lead.membershipId.toLowerCase()))

  function done(text: string) {
    setNotice({ tone: 'positive', text })
    focus('qs-leads-notice')
    void load()
  }

  async function name(chosen: string): Promise<string | null> {
    try {
      await qualityApi.nameLead(facilityId, chosen, keyFor('name-lead', { membershipId: chosen }))
      learnFrom()
      setNaming(false)
      done(`${who(chosen)} is now a quality lead.`)
      return null
    } catch (caught) {
      if (cancelled(caught)) return null
      learnFrom(caught)
      return refusalWords(caught, 'The quality lead could not be named. Try again.')
    }
  }

  async function end(lead: QualityLead, reason: string): Promise<string | null> {
    try {
      await qualityApi.endLead(facilityId, lead.leadId, reason, keyFor('end-lead', { leadId: lead.leadId, reason }))
      learnFrom()
      setEnding(null)
      done(`${who(lead.membershipId)} is no longer a quality lead.`)
      return null
    } catch (caught) {
      if (cancelled(caught)) return null
      learnFrom(caught)
      return refusalWords(caught, 'The quality lead could not be removed. Try again.')
    }
  }

  return (
    <DeptPage eyebrow={EYEBROW} title={TITLE} description={DESCRIPTION} className="hid-ehr-dept-qs"
      primaryAction={me.canNameLeads ? <EhrButton disabled={full || leads === null} onClick={() => setNaming(true)}>Name a lead</EhrButton> : undefined}
      secondaryActions={<EhrButton variant="secondary" onClick={() => void load()} busy={loading && leads !== null}>Refresh</EhrButton>}>
      <QualityTabs me={me} current="leads" />
      {notice ? <DeptNotice id="qs-leads-notice" tabIndex={-1} role="status" tone={notice.tone} variant="box">{notice.text}</DeptNotice> : null}

      <DeptSection title="Quality leads" headingId="qs-leads-title">
        <p className="hid-ehr-qs-plain">
          Quality leads see and manage every incident report here, as the administrators do, and see who reported each one.
          {` A facility can have up to ${leads?.limit ?? 10}.`}
        </p>
        {me.canNameLeads ? null : <p className="hid-ehr-hint">{LEADS_ADMIN_ONLY}</p>}
        {full && me.canNameLeads ? <p className="hid-ehr-hint">This facility has the most quality leads it can have. Remove one to name another.</p> : null}
        {error ? <DeptNotice role="alert" tone={error.unavailable ? 'info' : 'critical'}>{error.unavailable ? NOT_AVAILABLE : error.text}</DeptNotice> : null}
        {error && !leads ? null : (
          <EhrDataTable caption="Quality leads" captionHidden rows={leads?.leads ?? []} rowKey={lead => lead.leadId} loading={loading && leads === null}
            emptyTitle="No quality leads" emptyMessage="The administrators manage incident reports until they name a lead."
            columns={[
              { id: 'name', header: 'Name', cell: lead => who(lead.membershipId) },
              { id: 'named', header: 'Named', cell: lead => `${whenText(lead.namedAt)}${lead.namedByMembershipId ? ` by ${who(lead.namedByMembershipId)}` : ''}` },
              ...(me.canNameLeads ? [{ id: 'remove', header: 'Remove', cell: (lead: QualityLead) => (
                <EhrButton size="sm" variant="quiet" onClick={() => setEnding(lead)} aria-label={`Remove ${who(lead.membershipId)} as a quality lead`}>Remove</EhrButton>
              ) }] : []),
            ]} />
        )}
      </DeptSection>

      {naming ? <NameLead directory={directory} own={membershipId} leadIds={leadIds} onClose={() => setNaming(false)} onSave={name} /> : null}
      {ending ? <EndLead name={who(ending.membershipId)} onClose={() => setEnding(null)} onSave={reason => end(ending, reason)} /> : null}
    </DeptPage>
  )
}

function NameLead({ directory, own, leadIds, onClose, onSave }: {
  readonly directory: ReturnType<typeof useStaffDirectory>
  readonly own: string | undefined
  readonly leadIds: ReadonlySet<string>
  readonly onClose: () => void
  readonly onSave: (membershipId: string) => Promise<string | null>
}) {
  const [chosen, setChosen] = useState('')
  const [problem, setProblem] = useState('')
  const [refusal, setRefusal] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const choices = directory.current.filter(member => !leadIds.has(member.membershipId.toLowerCase()))
  async function submit() {
    if (busy) return
    if (!chosen) { setProblem('Choose a staff member.'); return }
    setProblem('')
    setBusy(true)
    setRefusal(await onSave(chosen))
    setBusy(false)
  }
  return (
    <EhrDrawer open title="Name a quality lead" dirty={chosen !== '' && !busy} onClose={onClose}>
      <form className="hid-ehr-qs-drawer-form" noValidate onSubmit={event => { event.preventDefault(); void submit() }}>
        {refusal ? <DeptNotice role="alert" tone="critical" variant="box">{refusal}</DeptNotice> : null}
        <p className="hid-ehr-qs-plain">The lead sees every incident report here, with who reported it and the linked patient, from their next page. Tell them yourself: Health ID does not.</p>
        <EhrField label="Staff member" controlId="qs-lead-member" error={problem || undefined}
          hint={!directory.loaded ? 'Loading this facility’s staff…' : directory.failed ? 'The staff list could not be loaded. Close this and try again.' : undefined}>
          <EhrSelect value={chosen} onChange={event => setChosen(event.target.value)}>
            <option value="">Choose a staff member</option>
            {choices.map(member => <option key={member.membershipId} value={member.membershipId}>{memberText(member.membershipId, own, directory.names)}</option>)}
          </EhrSelect>
        </EhrField>
        <div className="hid-ehr-dept-form-actions">
          <EhrButton type="submit" busy={busy}>Name lead</EhrButton>
          <EhrButton variant="secondary" onClick={onClose} disabled={busy}>Cancel</EhrButton>
        </div>
      </form>
    </EhrDrawer>
  )
}

function EndLead({ name, onClose, onSave }: {
  readonly name: string
  readonly onClose: () => void
  readonly onSave: (reason: string) => Promise<string | null>
}) {
  const [reason, setReason] = useState('')
  const [problem, setProblem] = useState('')
  const [refusal, setRefusal] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  async function submit() {
    if (busy) return
    const found = reasonProblem(reason)
    setProblem(found)
    if (found) return
    setBusy(true)
    setRefusal(await onSave(reason.trim()))
    setBusy(false)
  }
  return (
    <EhrDrawer open title="Remove quality lead" dirty={reason !== '' && !busy} onClose={onClose}>
      <form className="hid-ehr-qs-drawer-form" noValidate onSubmit={event => { event.preventDefault(); void submit() }}>
        {refusal ? <DeptNotice role="alert" tone="critical" variant="box">{refusal}</DeptNotice> : null}
        <p className="hid-ehr-qs-plain">{name} will no longer manage incident reports here. Reports assigned to them as reviewer stay assigned.</p>
        <EhrField label="Why" controlId="qs-lead-end-reason" error={problem || undefined}>
          <EhrTextarea rows={3} value={reason} maxLength={LIMITS.reason[1]} onChange={event => setReason(event.target.value)} />
        </EhrField>
        <div className="hid-ehr-dept-form-actions">
          <EhrButton type="submit" variant="danger" busy={busy}>Remove lead</EhrButton>
          <EhrButton variant="secondary" onClick={onClose} disabled={busy}>Cancel</EhrButton>
        </div>
      </form>
    </EhrDrawer>
  )
}
