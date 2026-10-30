// emr-dashboards.jsx — bespoke per-role landing dashboards.
// Each role lands on a tailored dashboard (stats + queues that match their job),
// then navigates modules via the top tabs. Falls back to the operations dashboard.
const { useState: useRD } = React;

function Hello({ who, sub, action }) {
  return (
    <div className="page-heading" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--space-400)', flexWrap: 'wrap', marginBottom: 'var(--space-600)' }}>
      <div style={{ minWidth: 0 }}>
        <h1 style={{ fontSize: 'var(--fs-h-md)', fontWeight: 'var(--fw-bold)', color: 'var(--text-heading)', letterSpacing: 'var(--tracking-tight)', lineHeight: 1.15 }}>{who}</h1>
        <p style={{ fontSize: 'var(--fs-md)', color: 'var(--text-secondary)', marginTop: 'var(--space-200)' }}>{sub}</p>
      </div>
      {action}
    </div>
  );
}

function StatCards({ items, role, onNav }) {
 return <><div className="stat-grid">{items.map(k => <div className="stat-tile" key={k.label}><div className="stat-label"><span>{k.label}</span><Icon name={k.icon} size={16}/></div><div className="stat-value">{k.value}</div>{k.foot && <div className={'stat-foot ' + (k.tone || '')}><span>{k.foot}</span><strong>{k.footValue}</strong></div>}</div>)}</div>{role && QUICK_ACTIONS[role.key] && <QuickBar role={role} onNav={onNav}/>}</>;
}

// ---- quick-action primary uses the brand blue for every tier (brand discipline: blue only) ----
const TIER_COLOR = { L1: 'var(--accent)', L2: 'var(--accent)', L3: 'var(--accent)', L4: 'var(--accent)', L5: 'var(--accent)', L6: 'var(--accent)', L7: 'var(--accent)' };

// ---- per-role quick actions (verb-first, icon-led). First = PRIMARY (tier-color fill). ----
const QUICK_ACTIONS = {
  platform_admin: [
    { icon: 'building', label: 'Add hospital', to: 'setup' }, { icon: 'x', label: 'Suspend hospital', to: 'setup' },
    { icon: 'history', label: 'Audit logs', to: 'audit' }, { icon: 'download', label: 'Platform reports', to: 'reports' }],
  owner: [
    { icon: 'building', label: 'Add branch', to: 'setup' }, { icon: 'receipt', label: 'View revenue', to: 'billing' }, { icon: 'chart', label: 'View reports', to: 'reports' }],
  medical_director: [
    { icon: 'alert', label: 'Critical cases', to: 'quality' }, { icon: 'x', label: 'Clinical incidents', to: 'quality' },
    { icon: 'check', label: 'Approve policies', to: 'quality' }, { icon: 'users', label: 'Review consultants', to: 'staff' }],
  administrator: [
    { icon: 'user-plus', label: 'Create staff', to: 'staff' }, { icon: 'plus', label: 'Assign department', to: 'setup' },
    { icon: 'clock', label: 'Manage shifts', to: 'shifts' }, { icon: 'download', label: 'Generate reports', to: 'reports' }],
  consultant: [
    { icon: 'stethoscope', label: 'Start consultation', to: 'consult' }, { icon: 'notes', label: 'Review case', to: 'patients' },
    { icon: 'check', label: 'Approve treatment', to: 'consult' }, { icon: 'share', label: 'Refer patient', to: 'referrals' }],
  doctor: [
    { icon: 'stethoscope', label: 'Start consultation', to: 'consult' }, { icon: 'flask', label: 'Request lab', to: 'lab' },
    { icon: 'scan', label: 'Request imaging', to: 'radiology' }, { icon: 'pill', label: 'Prescribe', to: 'pharmacy' }],
  nurse: [
    { icon: 'activity', label: 'Record vitals', to: 'triage' }, { icon: 'pill', label: 'Administer medication', to: 'inpatient' }, { icon: 'edit', label: 'Nursing notes', to: 'patients' }],
  receptionist: [
    { icon: 'user-plus', label: 'Register patient', to: 'patients' }, { icon: 'calendar', label: 'Book appointment', to: 'appointments' }, { icon: 'check', label: 'Check-in patient', to: 'journey' }],
  records: [
    { icon: 'search', label: 'Retrieve record', to: 'patients' }, { icon: 'merge', label: 'Merge records', to: 'patients' }, { icon: 'upload', label: 'Upload document', to: 'patients' }],
  lab_manager: [
    { icon: 'users', label: 'Assign scientist', to: 'lab' }, { icon: 'check', label: 'Verify results', to: 'lab' }, { icon: 'chart', label: 'View analytics', to: 'reports' }],
  lab: [
    { icon: 'flask', label: 'Process sample', to: 'lab' }, { icon: 'edit', label: 'Enter result', to: 'lab' }, { icon: 'shield-check', label: 'Submit for verification', to: 'lab' }],
  pharmacy_manager: [
    { icon: 'plus', label: 'Add inventory', to: 'inventory' }, { icon: 'alert', label: 'Review expiry', to: 'inventory' }, { icon: 'receipt', label: 'Purchase stock', to: 'inventory' }],
  pharmacist: [
    { icon: 'pill', label: 'Dispense medication', to: 'pharmacy' }, { icon: 'check', label: 'Verify prescription', to: 'pharmacy' }, { icon: 'edit', label: 'Record stock usage', to: 'inventory' }],
  billing: [
    { icon: 'plus', label: 'Create invoice', to: 'billing' }, { icon: 'receipt', label: 'Record payment', to: 'billing' }, { icon: 'download', label: 'Generate receipt', to: 'billing' }],
  cashier: [
    { icon: 'receipt', label: 'Receive payment', to: 'billing' }, { icon: 'file', label: 'Print receipt', to: 'billing' }],
};

function QuickBar({ role, onNav }) {
  const actions = QUICK_ACTIONS[role.key] || [];
  const tc = TIER_COLOR[role.tier] || 'var(--accent)';
  return (
    <div role="toolbar" aria-label="Quick actions" style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-200)', marginBottom: 'var(--space-500)' }} className="quick-bar">
      {actions.map((a, i) => {
        const primary = i === 0;
        return (
          <button key={a.label} onClick={() => onNav(a.to)} disabled={a.disabled}
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '10px 16px', minHeight: 42,
              borderRadius: 'var(--radius-md)', fontSize: 'var(--fs-sm)', fontWeight: 'var(--fw-semibold)', cursor: a.disabled ? 'not-allowed' : 'pointer',
              border: primary ? `1px solid ${tc}` : '1px solid var(--border-default)',
              background: primary ? tc : 'var(--surface)', color: primary ? '#fff' : 'var(--text-strong)',
              opacity: a.disabled ? 0.45 : 1,
            }}>
            <Icon name={a.icon} size={16} />{a.label}
          </button>
        );
      })}
    </div>
  );
}

function ListCard({ title, hint, action, children }) {
  return (
    <Card asArticle padding="var(--space-500)">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}><SectionHeader title={title} hint={hint} />{action}</div>
      <div style={{ marginTop: 'var(--space-300)', display: 'flex', flexDirection: 'column', gap: 'var(--space-200)' }}>{children}</div>
    </Card>
  );
}
function RowBtn({ avatarName, icon, title, sub, right, onClick, accent }) {
  return (
    <button className="queue-row" onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-300)', padding: 'var(--space-300) var(--space-400)', textAlign: 'left', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', background: 'var(--surface)', width: '100%' }}>
      {avatarName !== undefined
        ? <span style={{ width: 36, height: 36, borderRadius: 'var(--radius-pill)', background: 'var(--primary-50)', color: 'var(--accent-hover)', display: 'grid', placeItems: 'center', fontWeight: 'var(--fw-bold)', fontSize: 11, flexShrink: 0 }}>{avatarName.split(' ').map((x) => x[0]).join('')}</span>
        : <span style={{ width: 36, height: 36, borderRadius: 'var(--radius-md)', background: accent || 'var(--surface-muted)', color: accent ? '#fff' : 'var(--text-secondary)', display: 'grid', placeItems: 'center', flexShrink: 0 }}><Icon name={icon} size={18} /></span>}
      <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 'var(--fw-semibold)', color: 'var(--text-strong)' }}>{title}</div><div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)' }}>{sub}</div></div>
      {right}
    </button>
  );
}
function TwoCol({ a, b }) {
  return <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.4fr) minmax(0,1fr)', gap: 'var(--space-500)', alignItems: 'start' }} className="emr-cols">{a}{b}</div>;
}
const GoLink = <Icon name="chevron" size={16} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />;

function NoticesCard() {
  return (
    <Card asArticle padding="var(--space-500)">
      <SectionHeader title="Needs attention" />
      <div style={{ marginTop: 'var(--space-300)', display: 'flex', flexDirection: 'column', gap: 'var(--space-200)' }}>
        {DASH_NOTICES.map((n, i) => (
          <div key={i} style={{ display: 'flex', gap: 10, padding: 'var(--space-300)', borderRadius: 'var(--radius-md)', background: n.tone === 'danger' ? 'var(--danger-50)' : n.tone === 'warning' ? 'var(--warning-50)' : 'var(--surface-info)' }}>
            <span style={{ flexShrink: 0, marginTop: 1, color: n.tone === 'danger' ? 'var(--danger-500)' : n.tone === 'warning' ? 'var(--warning-600)' : 'var(--accent)' }}><Icon name={n.icon} size={16} /></span>
            <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-body)', lineHeight: 1.4 }}>{n.text}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ---------- Doctor / Consultant ----------
function DoctorDash({ role, onNav }) {
  return (
    <div>
      <Hello who={`Good morning, ${role.who}`} sub="Your clinical day at a glance." action={<Button variant="primary" icon="stethoscope" onClick={() => onNav('consult')}>Start consultation</Button>} />
      <StatCards role={role} onNav={onNav} items={[
        { label: 'My patients today', value: '18', icon: 'user', foot: 'Seen', footValue: '9' },
        { label: 'Ready for doctor', value: '9', icon: 'stethoscope', foot: 'Longest wait', footValue: '24 min', tone: 'warn' },
        { label: 'Results to review', value: '6', icon: 'flask', foot: 'Urgent', footValue: '2', tone: 'danger' },
        { label: 'Pending sign-offs', value: '3', icon: 'check', foot: 'From', footValue: 'Residents' },
      ]} />
      <TwoCol
        a={<ListCard title="Ready for doctor" hint="From triage" action={<Button size="sm" variant="ghost" onClick={() => onNav('consult')}>Open queue</Button>}>
          {PATIENTS.slice(0, 4).map((p) => (
            <RowBtn key={p.id} avatarName={p.name} title={p.name} sub={`${p.hid} · ${p.age}${p.sex}${p.flag ? ' · ' + p.flag : ''}`} onClick={() => onNav('consult')}
              right={<span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 'var(--fs-sm)', fontWeight: 'var(--fw-semibold)', color: 'var(--text-link)' }}>Start {GoLink}</span>} />
          ))}
        </ListCard>}
        b={<NoticesCard />} />
    </div>
  );
}

// ---------- Nurse ----------
function NurseDash({ role, onNav }) {
  const ward = WARDS[0];
  return (
    <div>
      <Hello who={`Hello, ${role.who}`} sub="Your shift — General Ward · Morning." action={<Button variant="primary" icon="activity" onClick={() => onNav('triage')}>Take vitals</Button>} />
      <StatCards role={role} onNav={onNav} items={[
        { label: 'Assigned beds', value: '8', icon: 'bed', foot: 'Occupied', footValue: '6' },
        { label: 'Vitals to take', value: '5', icon: 'activity', foot: 'Overdue', footValue: '1', tone: 'warn' },
        { label: 'Medications due', value: '4', icon: 'pill', foot: 'Next', footValue: '10:30' },
        { label: 'Handover', value: '21:00', icon: 'clock', foot: 'To', footValue: 'Night shift' },
      ]} />
      <TwoCol
        a={<ListCard title="Triage & vitals queue" action={<Button size="sm" variant="ghost" onClick={() => onNav('triage')}>Open</Button>}>
          {TRIAGE_QUEUE.map((t) => (
            <RowBtn key={t.id} avatarName={t.name} title={t.name} sub={`${t.complaint} · arrived ${t.arrived}`} onClick={() => onNav('triage')}
              right={t.priority === 'urgent' ? <Badge tone="danger" icon="alert">Urgent</Badge> : <Badge tone="gray">Routine</Badge>} />
          ))}
        </ListCard>}
        b={<ListCard title={ward.name} hint={`${ward.beds.filter((x) => x.s === 'occupied').length}/${ward.beds.length} occupied`} action={<Button size="sm" variant="ghost" onClick={() => onNav('inpatient')}>Beds</Button>}>
          {ward.beds.slice(0, 5).map((b) => (
            <div key={b.n} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 'var(--radius-md)', background: 'var(--surface-muted)' }}>
              <Icon name="bed" size={15} style={{ color: 'var(--text-secondary)' }} /><span style={{ fontSize: 'var(--fs-sm)', fontWeight: 'var(--fw-semibold)', color: 'var(--text-strong)', flex: 1 }}>Bed {b.n}</span>
              <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)' }}>{b.who || (b.s === 'free' ? 'Available' : 'Cleaning')}</span>
            </div>
          ))}
        </ListCard>} />
    </div>
  );
}

// ---------- Receptionist ----------
function ReceptionDash({ role, onNav }) {
  const tone = { 'checked-in': 'success', booked: 'gray' };
  return (
    <div>
      <Hello who={`Hello, ${role.who}`} sub="Front desk — Living Word Hospital, Main." action={<Button variant="primary" icon="user-plus" onClick={() => onNav('patients')}>Register patient</Button>} />
      <StatCards role={role} onNav={onNav} items={[
        { label: 'Checked in', value: '12', icon: 'check', foot: 'This hour', footValue: '4' },
        { label: 'Waiting', value: '14', icon: 'clock', foot: 'Avg wait', footValue: '18 min', tone: 'warn' },
        { label: "Today's appointments", value: '5', icon: 'calendar', foot: 'Next', footValue: '09:30' },
        { label: 'Unpaid invoices', value: '7', icon: 'receipt', foot: 'Outstanding', footValue: '₦1.27M', tone: 'warn' },
      ]} />
      <TwoCol
        a={<ListCard title="Today's appointments" hint={`${APPTS.length} booked`} action={<Button size="sm" variant="ghost" onClick={() => onNav('appointments')}>Schedule</Button>}>
          {APPTS.map((a) => (
            <RowBtn key={a.id} icon="calendar" title={a.patient} sub={`${a.time} · ${a.type} · ${a.doctor}`} onClick={() => onNav('appointments')}
              right={<Badge tone={tone[a.status]} icon={a.status === 'checked-in' ? 'check' : 'clock'}>{a.status === 'checked-in' ? 'Checked in' : 'Booked'}</Badge>} />
          ))}
        </ListCard>}
        b={<ListCard title="Quick actions">
          <RowBtn icon="user-plus" title="Register new patient" sub="Search Health ID first" accent="var(--accent)" onClick={() => onNav('patients')} right={GoLink} />
          <RowBtn icon="calendar" title="Book appointment" sub="For an existing patient" accent="var(--accent)" onClick={() => onNav('appointments')} right={GoLink} />
          <RowBtn icon="receipt" title="Take a payment" sub="Settle an invoice" accent="var(--accent)" onClick={() => onNav('billing')} right={GoLink} />
        </ListCard>} />
    </div>
  );
}

// ---------- Pharmacist ----------
function PharmacyDash({ role, onNav }) {
  return (
    <div>
      <Hello who={`Hello, ${role.who}`} sub="Pharmacy — dispensing & stock." action={<Button variant="primary" icon="pill" onClick={() => onNav('pharmacy')}>Dispensing queue</Button>} />
      <StatCards role={role} onNav={onNav} items={[
        { label: 'To dispense', value: String(PHARM_QUEUE.filter((p) => p.status === 'new').length), icon: 'pill', foot: 'Controlled', footValue: String(PHARM_QUEUE.filter((p) => p.controlled).length), tone: 'warn' },
        { label: 'Dispensed today', value: '24', icon: 'check', foot: 'vs yesterday', footValue: '+8%' },
        { label: 'Low stock items', value: String(INVENTORY_ALERTS.length), icon: 'box', foot: 'Critical', footValue: '1', tone: 'danger' },
        { label: 'Purchase orders', value: '3', icon: 'receipt', foot: 'Pending', footValue: '1' },
      ]} />
      <TwoCol
        a={<ListCard title="Dispensing queue" action={<Button size="sm" variant="ghost" onClick={() => onNav('pharmacy')}>Open</Button>}>
          {PHARM_QUEUE.map((r) => (
            <RowBtn key={r.id} icon="pill" accent={r.controlled ? 'var(--danger-500)' : 'var(--accent)'} title={r.patient} sub={`${r.id} · ${r.items} item${r.items > 1 ? 's' : ''}`} onClick={() => onNav('pharmacy')}
              right={r.status === 'dispensed' ? <Badge tone="success" icon="check">Dispensed</Badge> : r.controlled ? <Badge tone="danger" icon="shield">Controlled</Badge> : <Badge tone="info">New</Badge>} />
          ))}
        </ListCard>}
        b={<ListCard title="Inventory alerts" hint="Below reorder" action={<Button size="sm" variant="ghost" onClick={() => onNav('inventory')}>Stock</Button>}>
          {INVENTORY_ALERTS.map((d) => (
            <div key={d.drug} style={{ padding: 'var(--space-300)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><span style={{ fontSize: 'var(--fs-sm)', fontWeight: 'var(--fw-semibold)', color: 'var(--text-strong)' }}>{d.drug}</span><Badge tone="warning">{d.stock} left</Badge></div>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>Reorder at {d.reorder} · expires {d.expiry}</div>
            </div>
          ))}
        </ListCard>} />
    </div>
  );
}

// ---------- Laboratory ----------
function LabDash({ role, onNav }) {
  const by = (s) => LAB_QUEUE.filter((r) => r.stage === s).length;
  return (
    <div>
      <Hello who={`Hello, ${role.who}`} sub="Laboratory — sample workflow." action={<Button variant="primary" icon="flask" onClick={() => onNav('lab')}>Lab queue</Button>} />
      <StatCards role={role} onNav={onNav} items={[
        { label: 'Collected', value: String(by('collected')), icon: 'droplet', foot: 'Awaiting run', footValue: '—' },
        { label: 'Processing', value: String(by('processing')), icon: 'flask', foot: 'Urgent', footValue: String(LAB_QUEUE.filter((r) => r.urgency === 'urgent').length), tone: 'warn' },
        { label: 'To verify', value: String(by('verify')), icon: 'check', foot: 'Action needed', footValue: 'Yes', tone: 'warn' },
        { label: 'Avg turnaround', value: '38 min', icon: 'clock', foot: 'Target', footValue: '≤ 45 min' },
      ]} />
      <ListCard title="Sample queue" hint="Collect → process → verify → release" action={<Button size="sm" variant="ghost" onClick={() => onNav('lab')}>Open lab</Button>}>
        {LAB_QUEUE.map((r) => (
          <RowBtn key={r.id} icon="flask" accent="var(--accent)" title={`${r.test} · ${r.patient}`} sub={<span className="mono">{r.id}</span>} onClick={() => onNav('lab')}
            right={<div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>{r.urgency === 'urgent' && <Badge tone="danger">Urgent</Badge>}<Badge tone={TONE_BY_STAGE[r.stage]}>{r.stage}</Badge></div>} />
        ))}
      </ListCard>
    </div>
  );
}

// ---------- Billing / Cashier ----------
function BillingDash({ role, onNav }) {
  const tone = { unpaid: 'danger', paid: 'success', part: 'warning', insurance: 'info' };
  const label = { unpaid: 'Unpaid', paid: 'Paid', part: 'Part-paid', insurance: 'Insurance' };
  return (
    <div>
      <Hello who={`Hello, ${role.who}`} sub="Billing & revenue — today." action={<Button variant="primary" icon="receipt" onClick={() => onNav('billing')}>Open billing</Button>} />
      <StatCards role={role} onNav={onNav} items={[
        { label: 'Recorded today', value: '₦4.82M', icon: 'receipt', foot: 'Payments', footValue: '34' },
        { label: 'Outstanding', value: '₦1.27M', icon: 'clock', foot: 'Invoices', footValue: '7', tone: 'warn' },
        { label: 'Invoices', value: '32', icon: 'file', foot: 'Part-paid', footValue: '1' },
        { label: 'Insurance claims', value: '8', icon: 'shield', foot: 'Pending', footValue: '18' },
      ]} />
      <TwoCol
        a={<ListCard title="Recent invoices" action={<Button size="sm" variant="ghost" onClick={() => onNav('billing')}>All invoices</Button>}>
          {INVOICES.map((inv) => (
            <RowBtn key={inv.id} icon="receipt" accent="var(--accent)" title={inv.patient} sub={<span><span className="mono">{inv.id}</span> · ₦{inv.amount.toLocaleString()}</span>} onClick={() => onNav('billing')}
              right={<Badge tone={tone[inv.status]}>{label[inv.status]}</Badge>} />
          ))}
        </ListCard>}
        b={<ListCard title="Revenue mix" hint="Recorded, by service">
          {REVENUE_SPLIT.map((r) => (
            <div key={r.label} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-300)' }}>
              <span style={{ width: 92, fontSize: 'var(--fs-sm)', color: 'var(--text-body)', flexShrink: 0 }}>{r.label}</span>
              <span style={{ flex: 1, height: 8, background: 'var(--neutral-100)', borderRadius: 'var(--radius-pill)', overflow: 'hidden' }}><span style={{ display: 'block', height: '100%', width: `${r.value * 2.6}%`, background: 'var(--accent)', borderRadius: 'var(--radius-pill)' }} /></span>
              <span style={{ width: 30, textAlign: 'right', fontSize: 'var(--fs-sm)', fontWeight: 'var(--fw-semibold)', color: 'var(--text-strong)' }}>{r.value}%</span>
            </div>
          ))}
        </ListCard>} />
    </div>
  );
}

// ---------- Medical Director ----------
function DirectorDash({ role, onNav }) {
  const sevTone = { high: 'danger', moderate: 'warning', low: 'gray' };
  return (
    <div>
      <Hello who={`Good morning, ${role.who}`} sub="Clinical governance across the hospital." action={<Button variant="primary" icon="history" onClick={() => onNav('audit')}>Review audit</Button>} />
      <StatCards role={role} onNav={onNav} items={QUALITY_KPIS.map((k) => ({ label: k.label, value: k.value, icon: 'shield-check', foot: 'Trend', footValue: k.delta }))} />
      <TwoCol
        a={<ListCard title="Incident reports" hint="Quality & safety" action={<Button size="sm" variant="ghost" onClick={() => onNav('quality')}>All incidents</Button>}>
          {INCIDENTS.map((i) => (
            <RowBtn key={i.id} icon="alert" accent={i.severity === 'high' ? 'var(--danger-500)' : 'var(--warning-500)'} title={i.type} sub={`${i.id} · ${i.dept} · ${i.when}`} onClick={() => onNav('quality')}
              right={<Badge tone={sevTone[i.severity]}>{i.severity}</Badge>} />
          ))}
        </ListCard>}
        b={<ListCard title="Governance">
          <RowBtn icon="alert" accent="var(--danger-500)" title="Break-glass reviews" sub="1 emergency access to adjudicate" onClick={() => onNav('audit')} right={<Badge tone="danger">1</Badge>} />
          <RowBtn icon="route" accent="var(--accent)" title="Patient journey" sub="Live flow & bottlenecks" onClick={() => onNav('journey')} right={GoLink} />
          <RowBtn icon="users" accent="var(--accent)" title="Staff on duty" sub="Coverage across departments" onClick={() => onNav('staff')} right={GoLink} />
        </ListCard>} />
    </div>
  );
}

// ---------- Super Admin (platform) ----------
function SuperAdminDash({ role, onNav }) {
  return (
    <div>
      <Hello who={`Welcome, ${role.who}`} sub="Health ID platform — all hospitals." action={<Button variant="primary" icon="building" onClick={() => onNav('setup')}>Add hospital</Button>} />
      <StatCards role={role} onNav={onNav} items={[
        { label: 'Total hospitals', value: '38', icon: 'building', foot: 'Active', footValue: '36' },
        { label: 'Total patients', value: '184K', icon: 'user', foot: 'This month', footValue: '+4.2%' },
        { label: 'Total staff', value: '2,940', icon: 'users', foot: 'Across tenants', footValue: '38' },
        { label: 'System uptime', value: '99.98%', icon: 'activity', foot: 'Compliance', footValue: '96%', tone: 'warn' },
      ]} />
      <TwoCol
        a={<ListCard title="Compliance alerts" action={<Button size="sm" variant="ghost" onClick={() => onNav('audit')}>Audit logs</Button>}>
          <RowBtn icon="alert" accent="var(--danger-500)" title="Break-glass review overdue" sub="Living Word Hospital · 1 case" onClick={() => onNav('audit')} right={<Badge tone="danger">1</Badge>} />
          <RowBtn icon="shield-check" accent="var(--accent)" title="Licence expiries this month" sub="3 staff across 2 tenants" onClick={() => onNav('staff')} right={<Badge tone="warning">3</Badge>} />
          <RowBtn icon="history" accent="var(--accent)" title="Audit log volume" sub="2.1M events today" onClick={() => onNav('audit')} right={GoLink} />
        </ListCard>}
        b={<ListCard title="Quick actions">
          <RowBtn icon="building" accent="var(--accent)" title="Add hospital" sub="Onboard a new tenant" onClick={() => onNav('setup')} right={GoLink} />
          <RowBtn icon="users" accent="var(--accent)" title="Manage users" sub="Platform-wide directory" onClick={() => onNav('staff')} right={GoLink} />
          <RowBtn icon="chart" accent="var(--accent)" title="Platform analytics" sub="Cross-tenant reporting" onClick={() => onNav('reports')} right={GoLink} />
        </ListCard>} />
    </div>
  );
}

// ---------- Hospital Owner (NO clinical/patient — isolation rule) ----------
function OwnerDash({ role, onNav }) {
  return (
    <div>
      <Hello who={`Good morning, ${role.who}`} sub="Business performance across branches." action={<Button variant="primary" icon="receipt" onClick={() => onNav('billing')}>View revenue</Button>} />
      <StatCards role={role} onNav={onNav} items={[
        { label: 'Revenue (MTD)', value: '₦92.4M', icon: 'receipt', foot: 'vs last month', footValue: '+8%' },
        { label: 'Bed occupancy', value: '82%', icon: 'bed', foot: 'Across branches', footValue: '3' },
        { label: 'Staff count', value: '214', icon: 'users', foot: 'Active', footValue: '198' },
        { label: 'Growth', value: '+12%', icon: 'activity', foot: 'Patients YoY', footValue: 'Up' },
      ]} />
      <TwoCol
        a={<ListCard title="Branch performance" action={<Button size="sm" variant="ghost" onClick={() => onNav('reports')}>Reports</Button>}>
          {[['Main — Enugu', 86, '₦54.2M'], ['GRA Annex', 72, '₦24.8M'], ['Nsukka', 61, '₦13.4M']].map(([b, occ, rev]) => (
            <div key={b} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-300)', padding: 'var(--space-300) var(--space-400)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)' }}>
              <div style={{ flex: 1 }}><div style={{ fontWeight: 'var(--fw-semibold)', color: 'var(--text-strong)' }}>{b}</div><div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Occupancy {occ}%</div></div>
              <span className="mono" style={{ fontWeight: 'var(--fw-semibold)', color: 'var(--text-strong)' }}>{rev}</span>
            </div>
          ))}
        </ListCard>}
        b={<ListCard title="Quick actions">
          <RowBtn icon="building" accent="var(--accent)" title="Add branch" sub="Expand the group" onClick={() => onNav('setup')} right={GoLink} />
          <RowBtn icon="receipt" accent="var(--accent)" title="View revenue" sub="Billing & collections" onClick={() => onNav('billing')} right={GoLink} />
          <RowBtn icon="chart" accent="var(--accent)" title="View reports" sub="Group performance" onClick={() => onNav('reports')} right={GoLink} />
        </ListCard>} />
      <div style={{ marginTop: 'var(--space-400)', display: 'flex', gap: 8, padding: 'var(--space-300) var(--space-400)', background: 'var(--surface-muted)', borderRadius: 'var(--radius-md)', fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)' }}>
        <Icon name="lock" size={15} style={{ flexShrink: 0 }} /> Business view only — clinical queues and patient records are never shown to ownership.
      </div>
    </div>
  );
}

// ---------- Hospital Admin (operations) ----------
function AdminDash({ role, onNav }) {
  return (
    <div>
      <Hello who={`Hello, ${role.who}`} sub="Operations — Living Word Hospital, Main." action={<Button variant="primary" icon="user-plus" onClick={() => onNav('staff')}>Create staff</Button>} />
      <StatCards role={role} onNav={onNav} items={[
        { label: 'Staff attendance', value: '92%', icon: 'users', foot: 'On duty', footValue: '198 / 214' },
        { label: 'Dept activity', value: '7', icon: 'activity', foot: 'Busiest', footValue: 'OPD', tone: 'warn' },
        { label: 'Appointment volume', value: '248', icon: 'calendar', foot: 'Today', footValue: '+12%' },
        { label: 'Resource use', value: '78%', icon: 'box', foot: 'Beds + theatres', footValue: 'High' },
      ]} />
      <TwoCol
        a={<ListCard title="Department load" action={<Button size="sm" variant="ghost" onClick={() => onNav('reports')}>Reports</Button>}>
          {DEPT_LOAD.map((d) => (
            <div key={d.dept} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-300)', padding: '8px 4px' }}>
              <span style={{ width: 110, fontSize: 'var(--fs-sm)', color: 'var(--text-body)', flexShrink: 0 }}>{d.dept}</span>
              <span style={{ flex: 1, height: 8, background: 'var(--neutral-100)', borderRadius: 'var(--radius-pill)', overflow: 'hidden' }}><span style={{ display: 'block', height: '100%', width: `${d.load}%`, background: d.load > 80 ? 'var(--warning-500)' : 'var(--accent)' }} /></span>
              <span style={{ width: 36, textAlign: 'right', fontSize: 'var(--fs-sm)', fontWeight: 'var(--fw-semibold)', color: 'var(--text-strong)' }}>{d.load}%</span>
            </div>
          ))}
        </ListCard>}
        b={<ListCard title="Quick actions">
          <RowBtn icon="user-plus" accent="var(--accent)" title="Create staff" sub="Onboard a team member" onClick={() => onNav('staff')} right={GoLink} />
          <RowBtn icon="clock" accent="var(--accent)" title="Manage shifts" sub="Roster & coverage" onClick={() => onNav('shifts')} right={GoLink} />
          <RowBtn icon="box" accent="var(--accent)" title="Inventory" sub="Stock across departments" onClick={() => onNav('inventory')} right={GoLink} />
        </ListCard>} />
    </div>
  );
}

// ---------- Records Officer ----------
function RecordsDash({ role, onNav }) {
  return (
    <div>
      <Hello who={`Hello, ${role.who}`} sub="Medical records — integrity & requests." action={<Button variant="primary" icon="search" onClick={() => onNav('patients')}>Retrieve record</Button>} />
      <StatCards role={role} onNav={onNav} items={[
        { label: 'Record requests', value: '11', icon: 'notes', foot: 'Pending', footValue: '4', tone: 'warn' },
        { label: 'Pending updates', value: '6', icon: 'edit', foot: 'Today', footValue: '6' },
        { label: 'Missing documents', value: '3', icon: 'alert', foot: 'Follow up', footValue: 'Yes', tone: 'warn' },
        { label: 'Merge queue', value: '2', icon: 'merge', foot: 'Human-reviewed', footValue: 'Always' },
      ]} />
      <TwoCol
        a={<ListCard title="Recent patients" action={<Button size="sm" variant="ghost" onClick={() => onNav('patients')}>All patients</Button>}>
          {PATIENTS.slice(0, 4).map((p) => (
            <RowBtn key={p.id} avatarName={p.name} title={p.name} sub={<span><span className="mono">{p.hid}</span> · {p.status}</span>} onClick={() => onNav('patients')} right={GoLink} />
          ))}
        </ListCard>}
        b={<ListCard title="Quick actions">
          <RowBtn icon="search" accent="var(--accent)" title="Retrieve record" sub="Search by Health ID or name" onClick={() => onNav('patients')} right={GoLink} />
          <RowBtn icon="merge" accent="var(--accent)" title="Merge records" sub="Duplicate resolution (reviewed)" onClick={() => onNav('patients')} right={GoLink} />
          <RowBtn icon="history" accent="var(--accent)" title="Audit" sub="Record access trail" onClick={() => onNav('audit')} right={GoLink} />
        </ListCard>} />
    </div>
  );
}

// ---------- Router ----------
const ROLE_DASH = {
  platform_admin: SuperAdminDash, owner: OwnerDash, administrator: AdminDash, medical_director: DirectorDash,
  consultant: DoctorDash, doctor: DoctorDash, nurse: NurseDash, receptionist: ReceptionDash, records: RecordsDash,
  lab_manager: LabDash, lab: LabDash, pharmacy_manager: PharmacyDash, pharmacist: PharmacyDash,
  billing: BillingDash, cashier: BillingDash,
};
function RoleDashboard({ role, onNav, onOpenPatient }) {
  const Comp = role && ROLE_DASH[role.key];
  if (Comp) return <Comp role={role} onNav={onNav} />;
  return <EmrDashboard onNav={onNav} onOpenPatient={onOpenPatient} />;
}

Object.assign(window, { RoleDashboard });
