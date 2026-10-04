import type { ReactNode } from 'react'
import { LogoImage } from '@/components/layout/Logo'
import { HealthIcon, type HealthIconName } from './HealthIcon'

const WORKSPACES: Record<string, { label: string; icon: HealthIconName; items: readonly string[] }> = {
  ehr: { label: 'Clinical workspace', icon: 'hospital', items: ['Overview', 'Patient records', 'Encounters', 'Vitals', 'Documents'] },
  laboratory: { label: 'Laboratory workspace', icon: 'laboratory', items: ['Overview', 'Investigations', 'Samples', 'Results', 'Verification'] },
  pharmacy: { label: 'Pharmacy workspace', icon: 'medicine', items: ['Overview', 'Work items', 'Dispensing', 'Reversals', 'Imports'] },
  migrate: { label: 'Migration workspace', icon: 'database', items: ['Overview', 'OCR jobs', 'Extraction', 'Validation', 'Publication'] },
  outreach: { label: 'Outreach workspace', icon: 'location', items: ['Overview', 'Campaigns', 'Registration', 'Members', 'Cases'] },
  api: { label: 'Integration overview', icon: 'code', items: ['Overview', 'Identity', 'Authorisation', 'Records', 'Audit'] },
  identity: { label: 'Identity workspace', icon: 'shield', items: ['Overview', 'Health identities', 'Access requests', 'Connected care', 'Activity log'] },
}
const NAV_ICONS: readonly HealthIconName[] = ['dashboard', 'people', 'file', 'calendar', 'activity']

export function DashboardShell({ slug, title, children }: { slug: string; title: string; children: ReactNode }) {
  const workspace = WORKSPACES[slug] ?? WORKSPACES.ehr!
  return <div className="product-console" role="img" aria-label={`Illustration of the Health ID ${slug.toUpperCase()} dashboard: ${title}, showing example workload figures and queues.`}>
    <div aria-hidden="true">
      <div className="console-browser">
        <span className="console-window-dots"><i /><i /><i /></span>
        <span className="console-address"><HealthIcon name="shield" size={12} /> app.healthidentitydirectory.com</span>
        <span className="console-browser-label">Illustrative view</span>
      </div>
      <div className="console-workspace">
        <aside className="console-sidebar">
          <LogoImage />
          <div className="console-facility"><span><HealthIcon name={workspace.icon} size={19} /></span><div><b>Health ID</b><small>{workspace.label}</small></div><HealthIcon name="down" size={13} /></div>
          <p className="console-nav-label">WORKSPACE</p>
          <div className="console-nav">
            {workspace.items.map((item, index) => <span key={item} data-active={index === 0}><HealthIcon name={NAV_ICONS[index] ?? 'file'} size={18} />{item}{index === 0 ? <i /> : null}</span>)}
          </div>
          <div className="console-sidebar-bottom"><span><HealthIcon name="shield" size={17} /> Access protected</span><span><HealthIcon name="settings" size={17} /> Settings</span><div className="console-team"><b>HI</b><span>Care team<small>Authorised workspace</small></span></div></div>
        </aside>
        <div className="console-main">
          <div className="console-toolbar"><span>{workspace.label} <span>/</span> <b>Overview</b></span><div><HealthIcon name="search" size={18} /><span className="console-notification"><HealthIcon name="bell" size={18} /><i /></span><span className="console-avatar">AE</span></div></div>
          <div className="console-content">
            <div className="console-heading"><div><span className="console-eyebrow">SAMPLE WORKSPACE · INVENTED DATA</span><h3>{title}</h3><p>Example screens show a possible workflow.</p></div><span className="console-date"><HealthIcon name="calendar" size={15} /> Example <HealthIcon name="down" size={12} /></span></div>
            {children}
          </div>
        </div>
      </div>
    </div>
  </div>
}
