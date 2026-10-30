import { useCallback, useEffect } from 'react'
import { EhrBadge, EhrButton, EhrEmptyState, EhrSkeleton } from '@hid/ui/ehr'
import { staffApi, type OutreachCampaign } from '../../../staff/api'
import { DeptNotice } from '../parts/DeptNotice'
import { DeptPage, DeptSection } from '../parts/DeptPage'
import { DeptActions, DeptContextLine, DeptFacts, DeptRecordLayout } from '../parts/DeptRecord'
import { dateText } from '../parts/format'
import { useFacilityRead } from '../parts/useFacilityRead'
import {
  campaignFacts, CAMPAIGNS_READ_ONLY, CAMPAIGNS_READ_ONLY_TITLE, ErrorBox, MEMBERS_NOT_LOADED, NO_ACTIONS, reference, statusWords,
  type MembersRead,
} from './outreachParts'

/**
 * One campaign's members, read as today's campaign card reads them: for every campaign
 * listed, as soon as it is listed. It draws nothing: the page keeps what it read, for the
 * campaign's record view and to know which campaigns a case may name.
 */
export function CampaignMembersRead({ facilityId, membershipId, campaign, onMembershipChange, onRead }: {
  readonly facilityId: string
  readonly membershipId: string | undefined
  readonly campaign: OutreachCampaign
  readonly onMembershipChange: (campaignId: string, isMember: boolean) => void
  readonly onRead: (campaignId: string, read: MembersRead | null) => void
}) {
  const members = useFacilityRead(facilityId, true, useCallback(id => staffApi.outreachCampaignMembers(id, campaign.id), [campaign.id]), MEMBERS_NOT_LOADED)
  useEffect(() => {
    if (members.value) onMembershipChange(campaign.id, members.value.some(member => member.membershipId === membershipId))
  }, [campaign.id, membershipId, members.value, onMembershipChange])
  const { value, loading, error, refresh } = members
  useEffect(() => {
    onRead(campaign.id, { facilityId, items: value, loading, error, refresh })
  }, [campaign.id, facilityId, value, loading, error, refresh, onRead])
  useEffect(() => () => onRead(campaign.id, null), [campaign.id, onRead])
  return null
}

/**
 * A campaign as the design's record view: read only, since Identity does not authorize
 * campaign writes until campaign governance is decided, so no action is offered and the page
 * says why. Its members are listed under it.
 */
export function OutreachCampaignView({ campaign, members, onBack }: {
  readonly campaign: OutreachCampaign
  readonly members: MembersRead | undefined
  readonly onBack: () => void
}) {
  const items = members?.items ?? null
  const loading = !members || (members.loading && !items)
  return (
    <DeptPage title={campaign.name} onBack={onBack}>
      <DeptContextLine status={statusWords(campaign.status)}
        items={[campaign.services.length ? campaign.services.join(', ') : 'No services listed', `Starts ${dateText(campaign.startsAt)}`]} />
      <DeptNotice title={CAMPAIGNS_READ_ONLY_TITLE}>{CAMPAIGNS_READ_ONLY}</DeptNotice>
      <DeptRecordLayout
        main={<DeptSection title="Saved record"><DeptFacts facts={campaignFacts(campaign)} /></DeptSection>}
        aside={<DeptActions empty={NO_ACTIONS} />}
      />
      <DeptSection title="Members">
        <ErrorBox message={members?.error ?? ''} />
        {members?.error && !items ? <EhrButton variant="secondary" onClick={() => members.refresh()}>Try again</EhrButton> : null}
        {loading && !members?.error ? <EhrSkeleton label="Loading members" /> : null}
        {!loading && !members?.error && items?.length === 0
          ? <EhrEmptyState title="No members" message="No facility memberships are listed for this campaign." /> : null}
        {items && items.length > 0 ? (
          <ul className="hid-ehr-dept-rows">
            {items.map(member => (
              <li key={member.id}>
                <div className="hid-ehr-dept-row-main">
                  <span className="hid-ehr-dept-row-title">Membership {reference(member.membershipId)}</span>
                  <span className="hid-ehr-dept-muted">Added {dateText(member.createdAt)}</span>
                </div>
                <EhrBadge>{statusWords(member.role)}</EhrBadge>
              </li>
            ))}
          </ul>
        ) : null}
      </DeptSection>
    </DeptPage>
  )
}
