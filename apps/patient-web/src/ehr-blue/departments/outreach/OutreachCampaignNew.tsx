import { useRef } from 'react'
import type { OutreachCampaign } from '../../../staff/api'
import { CampaignPlanWizard } from './plan/CampaignPlanWizard'

/**
 * "New campaign" (hid-system#222, 0111; owner decisions of 13 November 2026): the plan's steps (plan/CampaignPlanWizard).
 * Its first step is today's create (a name of 2 to 200 characters, known services, an end on or after the start, days in
 * Nigerian time); the person who creates it becomes its first admin. Outreach takes no Idempotency-Key there, so a
 * create whose answer was lost is not sent again by itself: the list is read again and the person is asked to check it
 * first. Where Outreach serves campaign plans the steps go on to what it's for, sites, stations, partners, consent and
 * kits; elsewhere the campaign opens as soon as it is made, as before.
 */
export function OutreachCampaignNew({ facilityId, onBack, onCreated, onUnsure }: {
  readonly facilityId: string
  readonly onBack: () => void
  readonly onCreated: (created: OutreachCampaign) => void
  /** No answer came: reads the campaigns again, since this one may be saved. */
  readonly onUnsure: () => void
}) {
  const created = useRef<OutreachCampaign | null>(null)
  return (
    <CampaignPlanWizard facilityId={facilityId} onCancel={onBack} onUnsure={onUnsure}
      onCreated={campaign => { created.current = campaign }}
      onDone={() => { if (created.current) onCreated(created.current); else onBack() }} />
  )
}
