// emr-ops.jsx — diagnostics + operations + administration modules
const { useState: useOps } = React;

function QueueRow({ left, title, sub, right }) {
  return (
    <Card asArticle padding="var(--space-300) var(--space-400)">
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-300)' }}>
        {left}
        <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 'var(--fw-semibold)', color: 'var(--text-strong)' }}>{title}</div><div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)' }}>{sub}</div></div>
        {right}
      </div>
    </Card>
  );
}
const STAGE_LABEL = { collected: 'Collected', processing: 'Processing', verify: 'To verify', completed: 'Completed', requested: 'Requested', acquired: 'Acquired', reporting: 'Reporting' };

// ============================================================================
//  Laboratory — workflow queue (collect → process → verify → completed)
// ============================================================================
function LabModule() {
  const [tab, setTab] = useOps('all');
  const tabs = [['all', 'All'], ['collected', 'Collected'], ['processing', 'Processing'], ['verify', 'To verify'], ['completed', 'Completed']];
  const rows = LAB_QUEUE.filter((r) => tab === 'all' || r.stage === tab);
  return (
    <div>
      <PageHead sub="Diagnostics" title="Laboratory" action={<Button variant="primary" icon="plus">Log sample</Button>} />
      <Tabs tabs={tabs} active={tab} onTab={setTab} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-200)', marginTop: 'var(--space-400)' }}>
        {rows.map((r) => (
          <QueueRow key={r.id}
            left={<div style={{ width: 36, height: 36, borderRadius: 'var(--radius-md)', background: 'var(--primary-50)', color: 'var(--accent-hover)', display: 'grid', placeItems: 'center', flexShrink: 0 }}><Icon name="flask" size={18} /></div>}
            title={`${r.test} · ${r.patient}`} sub={`${r.id} · ${r.urgency}`}
            right={<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>{r.urgency === 'urgent' && <Badge tone="danger">Urgent</Badge>}<Badge tone={TONE_BY_STAGE[r.stage]}>{STAGE_LABEL[r.stage]}</Badge>{r.stage === 'verify' ? <Button size="sm" variant="primary">Verify</Button> : r.stage === 'completed' ? <Button size="sm" variant="ghost" icon="upload">Report</Button> : <Button size="sm" variant="secondary">Advance</Button>}</div>}
          />
        ))}
      </div>
    </div>
  );
}

// ============================================================================
//  Radiology — imaging requests + reporting
// ============================================================================
function RadiologyModule() {
  return (
    <div>
      <PageHead sub="Diagnostics" title="Radiology" action={<Button variant="primary" icon="upload">Upload study</Button>} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-200)' }}>
        {RAD_REQUESTS.map((r) => (
          <QueueRow key={r.id}
            left={<div style={{ width: 36, height: 36, borderRadius: 'var(--radius-md)', background: 'var(--primary-50)', color: 'var(--accent-hover)', display: 'grid', placeItems: 'center', flexShrink: 0 }}><Icon name="scan" size={18} /></div>}
            title={`${r.study} · ${r.patient}`} sub={`${r.id} · ${r.urgency}`}
            right={<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>{r.urgency === 'stat' && <Badge tone="danger">STAT</Badge>}<Badge tone={TONE_BY_STAGE[r.status]}>{STAGE_LABEL[r.status]}</Badge><Button size="sm" variant={r.status === 'reporting' ? 'primary' : 'secondary'}>{r.status === 'reporting' ? 'Write report' : 'Open'}</Button></div>}
          />
        ))}
      </div>
      <div style={{ marginTop: 'var(--space-400)', display: 'flex', gap: 8, padding: 'var(--space-300)', background: 'var(--surface-muted)', borderRadius: 'var(--radius-md)', fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)' }}><Icon name="scan" size={15} style={{ flexShrink: 0 }} /> PACS integration is planned — studies are uploaded as files for now (HL7/DICOM later).</div>
    </div>
  );
}

// ============================================================================
//  Pharmacy — dispensing queue + inventory alerts
// ============================================================================
function PharmacyModule() {
  return (
    <div>
      <PageHead sub="Diagnostics" title="Pharmacy" action={<Button variant="primary" icon="plus">New purchase order</Button>} />
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.4fr) minmax(0,1fr)', gap: 'var(--space-400)', alignItems: 'start' }} className="emr-cols">
        <div>
          <SectionHeader title="Dispensing queue" hint={`${PHARM_QUEUE.filter((p) => p.status === 'new').length} to dispense`} />
          <div style={{ marginTop: 'var(--space-300)', display: 'flex', flexDirection: 'column', gap: 'var(--space-200)' }}>
            {PHARM_QUEUE.map((r) => (
              <QueueRow key={r.id}
                left={<div style={{ width: 36, height: 36, borderRadius: 'var(--radius-md)', background: r.controlled ? 'var(--danger-50)' : 'var(--primary-50)', color: r.controlled ? 'var(--danger-500)' : 'var(--accent-hover)', display: 'grid', placeItems: 'center', flexShrink: 0 }}><Icon name="pill" size={18} /></div>}
                title={`${r.patient}`} sub={`${r.id} · ${r.items} item${r.items > 1 ? 's' : ''}`}
                right={<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>{r.controlled && <Badge tone="danger" icon="shield">Controlled</Badge>}{r.status === 'dispensed' ? <Badge tone="success" icon="check">Dispensed</Badge> : <Button size="sm" variant="primary">Dispense</Button>}</div>}
              />
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, padding: 'var(--space-300)', background: 'var(--surface-info)', borderRadius: 'var(--radius-md)', fontSize: 'var(--fs-sm)', color: 'var(--text-body)', marginTop: 'var(--space-300)' }}><Icon name="shield" size={15} style={{ flexShrink: 0, color: 'var(--accent)' }} /> Controlled-drug dispensing is recorded against the licensed pharmacist and audited — recording, not authorizing (D5).</div>
        </div>
        <Card asArticle padding="var(--space-500)">
          <SectionHeader title="Inventory alerts" hint="Below reorder level" />
          <div style={{ marginTop: 'var(--space-300)', display: 'flex', flexDirection: 'column', gap: 'var(--space-200)' }}>
            {INVENTORY_ALERTS.map((d) => (
              <div key={d.drug} style={{ padding: 'var(--space-300)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><span style={{ fontSize: 'var(--fs-sm)', fontWeight: 'var(--fw-semibold)', color: 'var(--text-strong)' }}>{d.drug}</span><Badge tone="warning">{d.stock} left</Badge></div>
                <div style={{ marginTop: 6, height: 6, background: 'var(--neutral-100)', borderRadius: 'var(--radius-pill)', overflow: 'hidden' }}><span style={{ display: 'block', height: '100%', width: `${Math.min(100, (d.stock / d.reorder) * 100)}%`, background: 'var(--warning-500)' }} /></div>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>Reorder at {d.reorder} · expires {d.expiry}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

// ============================================================================
//  Billing & Revenue — invoices + recorded payments (no money processing, D6)
// ============================================================================
function BillingModule() {
  const statusTone = { unpaid: 'danger', paid: 'success', part: 'warning', insurance: 'info' };
  const statusLabel = { unpaid: 'Unpaid', paid: 'Paid', part: 'Part-paid', insurance: 'Insurance' };
  const naira = (n) => '₦' + n.toLocaleString();
  return (
    <div>
      <PageHead sub="Operations" title="Billing & Revenue" action={<Button variant="primary" icon="plus">New invoice</Button>} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 'var(--space-300)', marginBottom: 'var(--space-400)' }}>
        {[['Recorded today', '₦4.82M'], ['Outstanding', '₦1.27M'], ['Invoices', '32'], ['Insurance claims', '8']].map(([l, v]) => (
          <Card key={l} padding="var(--space-400)"><div style={{ fontSize: 'var(--fs-h-sm)', fontWeight: 'var(--fw-bold)', color: 'var(--text-heading)', lineHeight: 1 }}>{v}</div><div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)', marginTop: 4 }}>{l}</div></Card>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.5fr) minmax(0,1fr)', gap: 'var(--space-400)', alignItems: 'start' }} className="emr-cols">
        <Card asArticle padding="0">
          <div style={{ padding: 'var(--space-400)', borderBottom: '1px solid var(--border-subtle)' }}><SectionHeader title="Invoices" /></div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--fs-sm)' }}>
              <thead><tr style={{ textAlign: 'left', color: 'var(--text-secondary)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{['Invoice', 'Patient', 'Amount', 'Status', ''].map((h) => <th key={h} style={{ padding: '10px 16px', fontWeight: 'var(--fw-bold)', whiteSpace: 'nowrap' }}>{h}</th>)}</tr></thead>
              <tbody>
                {INVOICES.map((inv) => (
                  <tr key={inv.id} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                    <td style={{ padding: '12px 16px', fontWeight: 'var(--fw-semibold)', color: 'var(--text-strong)', whiteSpace: 'nowrap' }}><span className="mono">{inv.id}</span><div style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 'var(--fw-regular)' }}>{inv.items} items · {inv.when}</div></td>
                    <td style={{ padding: '12px 16px', color: 'var(--text-body)' }}>{inv.patient}</td>
                    <td style={{ padding: '12px 16px', fontWeight: 'var(--fw-semibold)', color: 'var(--text-strong)', whiteSpace: 'nowrap' }}>{naira(inv.amount)}</td>
                    <td style={{ padding: '12px 16px' }}><Badge tone={statusTone[inv.status]}>{statusLabel[inv.status]}</Badge></td>
                    <td style={{ padding: '12px 16px', textAlign: 'right' }}>{inv.status === 'unpaid' || inv.status === 'part' ? <Button size="sm" variant="primary">Record payment</Button> : <Button size="sm" variant="ghost" icon="receipt">Receipt</Button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Card asArticle padding="var(--space-500)">
          <SectionHeader title="Revenue mix" hint="Recorded, by service" />
          <div style={{ marginTop: 'var(--space-400)', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {REVENUE_SPLIT.map((r) => (
              <div key={r.label} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-300)' }}>
                <span style={{ width: 96, fontSize: 'var(--fs-sm)', color: 'var(--text-body)', flexShrink: 0 }}>{r.label}</span>
                <span style={{ flex: 1, height: 8, background: 'var(--neutral-100)', borderRadius: 'var(--radius-pill)', overflow: 'hidden' }}><span style={{ display: 'block', height: '100%', width: `${r.value * 2.6}%`, background: 'var(--accent)', borderRadius: 'var(--radius-pill)' }} /></span>
                <span style={{ width: 32, textAlign: 'right', fontSize: 'var(--fs-sm)', fontWeight: 'var(--fw-semibold)', color: 'var(--text-strong)' }}>{r.value}%</span>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 'var(--space-400)', fontStyle: 'italic' }}>HID records payment method and marks paid — it never processes money (D6).</div>
        </Card>
      </div>
    </div>
  );
}

// ============================================================================
//  Reports & Analytics
// ============================================================================
function ReportsModule() {
  return (
    <div>
      <PageHead sub="Operations" title="Reports & Analytics" action={<Button variant="secondary" icon="upload">Export</Button>} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 'var(--space-300)' }}>
        {REPORTS.map((r) => (
          <button key={r.id} style={{ textAlign: 'left', padding: 'var(--space-400)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-lg)', background: 'var(--surface)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}><div style={{ width: 38, height: 38, borderRadius: 'var(--radius-md)', background: 'var(--primary-50)', color: 'var(--accent-hover)', display: 'grid', placeItems: 'center' }}><Icon name={r.icon} size={19} /></div><Icon name="chevron" size={16} style={{ color: 'var(--text-secondary)' }} /></div>
            <div style={{ fontSize: 'var(--fs-md)', fontWeight: 'var(--fw-semibold)', color: 'var(--text-strong)', marginTop: 'var(--space-300)' }}>{r.name}</div>
            <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)', marginTop: 2 }}>{r.desc}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
//  Hospital Setup — profile, branches, departments, services, pricing
// ============================================================================
function SetupModule({ config, onConfigure }) {
  const cfg = config || HOSPITAL_CONFIG;
  const ftype = (FACILITY_TYPES.find((t) => t.id === cfg.type) || {}).label || '—';
  const enabledDepts = DEPARTMENTS.filter((d) => cfg.departments.includes(d.id));
  const cards = [
    { icon: 'building', title: 'Hospital profile', desc: 'Name, branding, contact, licences' },
    { icon: 'store', title: 'Branches', desc: cfg.multiBranch ? `${BRANCHES.length} branches · multi-site` : 'Single branch' },
    { icon: 'home', title: 'Departments & wards', desc: 'Hierarchy, ward & bed setup' },
    { icon: 'receipt', title: 'Service catalog & pricing', desc: 'Consultation, lab, procedures' },
    { icon: 'shield', title: 'Insurance setup', desc: 'NHIS, HMOs, claim rules' },
    { icon: 'users', title: 'Roles & permissions', desc: 'RBAC capability matrix' },
  ];
  return (
    <div>
      <PageHead sub="Administration" title="Hospital Setup" action={<Button variant="primary" icon="building" onClick={onConfigure}>Configure facility</Button>} />

      {/* live configuration summary */}
      <Card asArticle padding="var(--space-500)" style={{ marginBottom: 'var(--space-500)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--space-400)', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 'var(--fs-lg)', fontWeight: 'var(--fw-bold)', color: 'var(--text-heading)' }}>{cfg.name}</div>
            <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)', marginTop: 2 }}>{ftype} · {cfg.multiBranch ? 'Multi-branch' : 'Single branch'} · {enabledDepts.length} departments</div>
          </div>
          <Button variant="secondary" size="sm" icon="edit" onClick={onConfigure}>Re-run setup wizard</Button>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 'var(--space-400)' }}>
          {enabledDepts.map((d) => (
            <span key={d.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, padding: '4px 10px', borderRadius: 'var(--radius-pill)', background: 'var(--primary-50)', color: 'var(--accent-hover)', fontWeight: 'var(--fw-semibold)' }}><Icon name="check" size={11} strokeWidth={3} />{d.label}</span>
          ))}
        </div>
      </Card>

      <SectionHeader title="Configuration" />
      <div style={{ marginTop: 'var(--space-400)', display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 'var(--space-300)' }}>
        {cards.map((c) => (
          <button key={c.title} onClick={c.title === 'Departments & wards' ? onConfigure : undefined} style={{ textAlign: 'left', padding: 'var(--space-400)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-lg)', background: 'var(--surface)' }}>
            <div style={{ width: 40, height: 40, borderRadius: 'var(--radius-md)', background: 'var(--surface-muted)', color: 'var(--text-secondary)', display: 'grid', placeItems: 'center' }}><Icon name={c.icon} size={20} /></div>
            <div style={{ fontSize: 'var(--fs-md)', fontWeight: 'var(--fw-semibold)', color: 'var(--text-strong)', marginTop: 'var(--space-300)' }}>{c.title}</div>
            <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)', marginTop: 2 }}>{c.desc}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
//  Staff & Roles
// ============================================================================
const STAFF_LIST = [
  { name: 'Dr. Amaka Eze', role: 'Consultant', dept: 'Antenatal', status: 'active' },
  { name: 'Dr. Ibrahim Nwankwo', role: 'General Doctor', dept: 'General OPD', status: 'active' },
  { name: 'Nurse Grace Obi', role: 'Nurse', dept: 'General Ward', status: 'active' },
  { name: 'Bola Adeyemi', role: 'Lab Scientist', dept: 'Laboratory', status: 'active' },
  { name: 'Tunde Bello', role: 'Pharmacist', dept: 'Pharmacy', status: 'on-leave' },
  { name: 'Joy Eze', role: 'Receptionist', dept: 'Front desk', status: 'active' },
];
function StaffModule() {
  return (
    <div>
      <PageHead sub="Administration" title="Staff & Roles" action={<Button variant="primary" icon="user-plus">Add staff</Button>} />
      <Card asArticle padding="0">
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--fs-sm)' }}>
            <thead><tr style={{ textAlign: 'left', color: 'var(--text-secondary)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{['Staff', 'Role', 'Department', 'Status', ''].map((h) => <th key={h} style={{ padding: '10px 16px', fontWeight: 'var(--fw-bold)' }}>{h}</th>)}</tr></thead>
            <tbody>
              {STAFF_LIST.map((s) => (
                <tr key={s.name} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                  <td style={{ padding: '12px 16px' }}><div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><span style={{ width: 32, height: 32, borderRadius: 'var(--radius-pill)', background: 'var(--primary-50)', color: 'var(--accent-hover)', display: 'grid', placeItems: 'center', fontWeight: 'var(--fw-bold)', fontSize: 11 }}>{s.name.split(' ').slice(-2).map((x) => x[0]).join('')}</span><span style={{ fontWeight: 'var(--fw-semibold)', color: 'var(--text-strong)' }}>{s.name}</span></div></td>
                  <td style={{ padding: '12px 16px', color: 'var(--text-body)' }}>{s.role}</td>
                  <td style={{ padding: '12px 16px', color: 'var(--text-body)' }}>{s.dept}</td>
                  <td style={{ padding: '12px 16px' }}><Badge tone={s.status === 'active' ? 'success' : 'gray'}>{s.status === 'active' ? 'Active' : 'On leave'}</Badge></td>
                  <td style={{ padding: '12px 16px', textAlign: 'right' }}><Button size="sm" variant="ghost">Edit</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// shared tabs control
function Tabs({ tabs, active, onTab }) {
  return (
    <div style={{ display: 'inline-flex', gap: 4, padding: 4, background: 'var(--neutral-100)', borderRadius: 'var(--radius-md)', flexWrap: 'wrap' }}>
      {tabs.map(([id, label]) => { const on = active === id; return <button key={id} onClick={() => onTab(id)} aria-pressed={on} style={{ padding: '7px 14px', minHeight: 36, border: 'none', borderRadius: 'var(--radius-sm)', background: on ? 'var(--surface)' : 'transparent', color: on ? 'var(--text-strong)' : 'var(--text-secondary)', fontWeight: 'var(--fw-semibold)', fontSize: 'var(--fs-sm)', boxShadow: on ? 'var(--shadow-xs)' : 'none' }}>{label}</button>; })}
    </div>
  );
}

Object.assign(window, { LabModule, RadiologyModule, PharmacyModule, BillingModule, ReportsModule, SetupModule, StaffModule, Tabs, QueueRow });
