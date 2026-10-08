import { useState, type FormEvent } from 'react'
import { adminApi, type AdminActor, type IntegrationCapability, type IntegrationEvent, type IntegrationProvider } from './api'
import { failure } from './problems'
import { ActionForm, Page, Refresh, ResourceView, Status, Table, date, has, label, useGovernedSubmit, useResource } from './ui'

/**
 * Dashboard-editable, non-secret provider settings. Mirrors hid-system
 * IntegrationAdminService `publicSettings`; migration 0047 validates the same
 * keys and formats again. Credentials are never edited or shown here.
 */
const PROVIDER_SETTINGS: Readonly<Record<string, ReadonlyArray<{ key: string; title: string; pattern: RegExp; hint: string; options?: readonly string[] }>>> = {
  ses: [{ key: 'fromAddress', title: 'From address', pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, hint: 'An email address' }],
  termii: [
    { key: 'senderId', title: 'Sender ID', pattern: /^[A-Za-z0-9]{3,20}$/, hint: '3 to 20 letters or digits' },
    { key: 'channel', title: 'Channel', pattern: /^(generic|dnd)$/, hint: 'generic or dnd', options: ['generic', 'dnd'] },
  ],
  'meta-whatsapp': [
    { key: 'phoneNumberId', title: 'Phone number ID', pattern: /^\d{5,30}$/, hint: '5 to 30 digits' },
    { key: 'templateName', title: 'Template name', pattern: /^[A-Za-z0-9_]{2,120}$/, hint: 'Letters, digits and underscores' },
    { key: 'templateLanguage', title: 'Template language', pattern: /^[a-z]{2}_[A-Z]{2}$/, hint: 'For example en_US' },
  ],
  brevo: [
    { key: 'emailFrom', title: 'Email from', pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, hint: 'An email address' },
    { key: 'smsSender', title: 'SMS sender', pattern: /^[A-Za-z0-9]{3,20}$/, hint: '3 to 20 letters or digits' },
    { key: 'whatsappSender', title: 'WhatsApp sender', pattern: /^\+[1-9]\d{7,14}$/, hint: 'International format, for example +2348000000000' },
  ],
}

/**
 * The form starts again from the server's values whenever the provider's
 * version changes, so it never re-sends settings another administrator has
 * since replaced. The confirmation lives outside it and survives that reset.
 */
function ProviderSettings({ provider, reload }: { provider: IntegrationProvider; reload: () => void }) {
  const [notice, setNotice] = useState<string | null>(null)
  if (!PROVIDER_SETTINGS[provider.provider]) return null
  return <>
    <ProviderSettingsForm key={provider.version} provider={provider} onEdit={() => setNotice(null)}
      onSaved={() => { setNotice('Settings saved.'); reload() }} />
    {notice && <p role="status" className="admin-success">{notice}</p>}
  </>
}

function ProviderSettingsForm({ provider, onEdit, onSaved }: {
  provider: IntegrationProvider; onEdit: () => void; onSaved: () => void
}) {
  const fields = PROVIDER_SETTINGS[provider.provider] ?? []
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map(field => [field.key, provider.configuration?.[field.key] ?? ''])))
  const [reason, setReason] = useState('')
  const governed = useGovernedSubmit()
  const invalid = fields.filter(field => values[field.key] && !field.pattern.test(values[field.key]!.trim()))
  if (fields.length === 0) return null

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (governed.busy || invalid.length > 0 || reason.trim().length < 8) return
    onEdit()
    // The backend replaces the whole public configuration: empty fields are removed.
    const configuration = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value.trim()]).filter(([, value]) => value))
    const saved = await governed.submit(idempotencyKey => adminApi.configureIntegration(provider, configuration, reason.trim(), idempotencyKey),
      'The settings could not be saved.')
    if (saved) onSaved()
  }

  return <details className="admin-action"><summary>Edit settings</summary>
    <form className="admin-action-form" onSubmit={event => void submit(event)}>
      <p className="admin-note">Only non-secret settings are edited here. Credentials stay in deployment configuration.
        Leave a field empty to remove it.</p>
      {fields.map(field => <label key={field.key}>{field.title}
        {field.options
          ? <select value={values[field.key]} onChange={event => setValues(current => ({ ...current, [field.key]: event.target.value }))}>
            <option value="">Not set</option>{field.options.map(option => <option key={option} value={option}>{option}</option>)}</select>
          : <input value={values[field.key]} aria-invalid={invalid.includes(field)} placeholder={field.hint}
            onChange={event => setValues(current => ({ ...current, [field.key]: event.target.value }))} />}
      </label>)}
      {invalid.length > 0 && <p role="alert" className="admin-error">Check {invalid.map(field => field.title).join(', ')}: {invalid.map(field => field.hint).join('; ')}.</p>}
      <label>Reason for this change<textarea required minLength={8} maxLength={500} rows={2} value={reason}
        onChange={event => setReason(event.target.value)} /></label>
      <button type="submit" className="admin-primary" disabled={governed.busy || invalid.length > 0 || reason.trim().length < 8}>
        {governed.busy ? 'Saving…' : 'Save settings'}</button>
      {governed.error && <p role="alert" className="admin-error">{governed.error}</p>}
    </form>
  </details>
}

function ProviderHistory({ provider }: { provider: IntegrationProvider }) {
  const [items, setItems] = useState<IntegrationEvent[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function load() {
    setLoading(true); setError(null)
    try { setItems((await adminApi.integrationHistory(provider.provider)).items) }
    catch (caught) { setError(failure(caught, 'The change history could not be loaded.')) }
    finally { setLoading(false) }
  }

  return <details className="admin-action" onToggle={event => {
    if ((event.currentTarget as HTMLDetailsElement).open && !items && !loading) void load()
  }}><summary>Change history</summary>
    <div className="admin-action-form">
      {loading && <p role="status">Loading history…</p>}
      {error && <p role="alert" className="admin-error">{error}</p>}
      {items && (items.length === 0 ? <p className="admin-note">No recorded changes.</p> :
        <Table headings={['When', 'Change', 'Reason']}>
          {items.map(item => <tr key={item.eventId}><td>{date(item.occurredAt)}</td>
            <td>{label(item.action)}{item.capability ? <small>{label(item.capability)}</small> : null}</td>
            <td>{item.reason ?? 'Not recorded'}</td></tr>)}
        </Table>)}
    </div>
  </details>
}

function ProviderDetails({ provider }: { provider: IntegrationProvider }) {
  // Only the allow-listed public settings are ever shown, whatever else a response carries.
  const settings = (PROVIDER_SETTINGS[provider.provider] ?? []).flatMap(field => {
    const value = provider.configuration?.[field.key]
    return typeof value === 'string' && value ? [[field.key, value] as const] : []
  })
  return <dl className="admin-detail-grid">
    <div><dt>Capabilities</dt><dd>{provider.capabilities?.length ? provider.capabilities.map(label).join(', ') : 'None'}</dd></div>
    <div><dt>In use for</dt><dd>{provider.activeCapabilities?.length ? provider.activeCapabilities.map(label).join(', ') : 'Nothing'}</dd></div>
    <div><dt>Credentials</dt><dd>{provider.credential ? label(provider.credential.state) : 'Not reported'}</dd></div>
    <div><dt>Last test</dt><dd>{date(provider.lastTestedAt)}{provider.lastFailedTestAt ? <small>Last failure {date(provider.lastFailedTestAt)}</small> : null}</dd></div>
    {settings.length > 0 && <div><dt>Settings</dt><dd>{settings.map(([key, value]) => <small key={key}>{label(key)}: {value}</small>)}</dd></div>}
    {provider.operationGates?.map(gate => <div key={gate.operation}><dt>{label(gate.operation)}</dt>
      <dd><Status value={gate.state} /><small>{gate.detail}</small></dd></div>)}
  </dl>
}

function IntegrationAction({ provider, reload, actor }: {
  provider: IntegrationProvider; reload: () => void; actor: AdminActor
}) {
  const options = provider.availableActions.filter(action => action === 'enable' || action === 'pause')
    .map(value => ({ value, title: label(value) }))
  return <div className="admin-action-row">
    {has(actor, 'platform.integration.manage') && options.length > 0 && <ActionForm title="Change provider state" options={options}
      onSubmit={async (action, reason, idempotencyKey) => {
        await adminApi.command(`/api/v1/admin/integrations/${encodeURIComponent(provider.provider)}/${action}`,
          { reason }, { version: provider.version, idempotencyKey })
        reload()
      }} />}
    {has(actor, 'platform.integration.test') && provider.availableActions.includes('test') && <ActionForm title="Test connection"
      onSubmit={async (_, reason, idempotencyKey) => {
        await adminApi.command(`/api/v1/admin/integrations/${encodeURIComponent(provider.provider)}/test`,
          { reason }, { version: provider.version, idempotencyKey })
        reload()
      }} />}
  </div>
}

/** Not a valid provider key (they start with a letter), so it cannot collide with one. */
const NO_FALLBACK = '(none)'

function CapabilityAction({ capability, actor, reload }: {
  capability: IntegrationCapability; actor: AdminActor; reload: () => void
}) {
  if (!has(actor, 'platform.integration.manage') || capability.eligibleProviders.length === 0) return null
  const choices = (exclude: Array<string | null>) => capability.eligibleProviders
    .filter(provider => !exclude.includes(provider)).map(provider => ({ value: provider, title: label(provider) }))
  const active = choices([capability.activeProvider])
  // The backend refuses a fallback equal to the active provider, and accepts no provider to remove the fallback.
  const fallback = [...choices([capability.activeProvider, capability.fallbackProvider]),
    ...(capability.fallbackProvider ? [{ value: NO_FALLBACK, title: 'No fallback' }] : [])]
  return <div className="admin-action-row">
    {active.length > 0 && <ActionForm title="Select active provider" options={active} onSubmit={async (provider, reason, idempotencyKey) => {
      await adminApi.command(`/api/v1/admin/integrations/capabilities/${encodeURIComponent(capability.capability)}/selection`,
        { provider, reason }, { version: capability.version, idempotencyKey })
      reload()
    }} />}
    {fallback.length > 0 && <ActionForm title="Change fallback provider" options={fallback} onSubmit={async (provider, reason, idempotencyKey) => {
      await adminApi.command(`/api/v1/admin/integrations/capabilities/${encodeURIComponent(capability.capability)}/fallback`,
        { provider: provider === NO_FALLBACK ? null : provider, reason }, { version: capability.version, idempotencyKey })
      reload()
    }} />}
  </div>
}

export function IntegrationsPage({ actor }: { actor: AdminActor }) {
  const resource = useResource(adminApi.integrations, 'Integration configuration could not be loaded.')
  return <Page eyebrow="Operations" title="Integrations"
    description="Provider status, routing and non-secret settings. Credentials are never shown; they stay in deployment configuration."
    action={<Refresh onClick={resource.reload} disabled={resource.loading} />}>
    <ResourceView resource={resource} empty={catalog => catalog.items.length === 0 && catalog.capabilities.length === 0}>{catalog => <div className="admin-stack">
      <section className="admin-panel"><h2>Providers</h2>{catalog.items.length === 0 ? <p className="admin-note">No providers are configured.</p> :
        <div className="admin-tile-grid">{catalog.items.map(provider => <article className="admin-tile" key={provider.provider}>
          <div className="admin-panel-head"><h3>{provider.name}</h3><Status value={provider.enabled ? 'enabled' : 'paused'} /></div>
          <p>Health: <Status value={provider.health} /></p><p>Management: {label(provider.managementMode)}</p>
          <ProviderDetails provider={provider} />
          <IntegrationAction provider={provider} reload={resource.reload} actor={actor} />
          {has(actor, 'platform.integration.manage') && provider.availableActions.includes('configure')
            && <ProviderSettings provider={provider} reload={resource.reload} />}
          <ProviderHistory provider={provider} />
        </article>)}</div>}</section>
      <section className="admin-panel"><h2>Capability routing</h2>{catalog.capabilities.length === 0 ? <p className="admin-note">No capability routes are configured.</p> :
        <div className="admin-tile-grid">{catalog.capabilities.map(capability => <article className="admin-tile" key={capability.capability}>
          <h3>{label(capability.capability)}</h3><p>Active: <strong>{capability.activeProvider ? label(capability.activeProvider) : 'None'}</strong></p>
          <p>Fallback: <strong>{capability.fallbackProvider ? label(capability.fallbackProvider) : 'None'}</strong></p>
          <CapabilityAction capability={capability} actor={actor} reload={resource.reload} />
        </article>)}</div>}</section>
    </div>}</ResourceView>
  </Page>
}
