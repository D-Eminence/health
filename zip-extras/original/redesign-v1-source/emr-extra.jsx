// emr-extra.jsx — expanded enterprise modules (journey engine, shifts, HR, quality,
// insurance, inventory, ambulance, blood bank, telemedicine, referrals)
const { useState: useX } = React;

const naira = (n) => '₦' + n.toLocaleString();
function MiniStat({ label, value, tone }) {
  const c = tone === 'up' || tone === 'down-good' ? 'var(--success-600)' : 'var(--text-secondary)';
  return <Card padding="var(--space-400)"><div style={{ fontSize: 'var(--fs-h-sm)', fontWeight: 'var(--fw-bold)', color: 'var(--text-heading)', lineHeight: 1 }}>{value}</div><div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)', marginTop: 4 }}>{label}</div></Card>;
}
function Table({ cols, children }) {
  return (
    <Card asArticle padding="0"><div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--fs-sm)' }}>
        <thead><tr style={{ textAlign: 'left', color: 'var(--text-secondary)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{cols.map((c) => <th key={c} style={{ padding: '10px 16px', fontWeight: 'var(--fw-bold)', whiteSpace: 'nowrap' }}>{c}</th>)}</tr></thead>
        <tbody>{children}</tbody>
      </table>
    </div></Card>
  );
}
const TD = { padding: '12px 16px', color: 'var(--text-body)' };
const TR = { borderTop: '1px solid var(--border-subtle)' };

// ============================================================================
//  Patient Journey Engine (Level 6) — live workflow state across the hospital
// ============================================================================
function JourneyModule() {
  const [sel, setSel] = useX(JOURNEY_PATIENTS[0]);
  const stages = JOURNEY_STAGES;
  // counts per stage for the pipeline header
  const counts = stages.map((s, i) => JOURNEY_PATIENTS.filter((p) => p.stage === i).length);
  return (
    <div>
      <PageHead sub="Clinical" title="Patient Journey" action={<Badge tone="info" icon="route">{JOURNEY_PATIENTS.length} patients in flow</Badge>} />

      {/* pipeline overview */}
      <Card asArticle padding="var(--space-500)" style={{ marginBottom: 'var(--space-400)' }}>
        <SectionHeader title="Live pipeline" hint="Where every patient currently is" />
        <div style={{ marginTop: 'var(--space-400)', display: 'flex', gap: 4, overflowX: 'auto', paddingBottom: 4 }}>
          {stages.map((s, i) => (
            <div key={s.id} style={{ flex: '1 0 110px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
              <div style={{ position: 'relative', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {i > 0 && <span style={{ position: 'absolute', left: 0, right: '50%', top: '50%', height: 2, background: 'var(--border-default)' }} />}
                {i < stages.length - 1 && <span style={{ position: 'absolute', left: '50%', right: 0, top: '50%', height: 2, background: 'var(--border-default)' }} />}
                <div style={{ position: 'relative', width: 44, height: 44, borderRadius: 'var(--radius-pill)', background: counts[i] ? 'var(--accent)' : 'var(--surface)', color: counts[i] ? '#fff' : 'var(--text-secondary)', border: counts[i] ? 'none' : '1.5px solid var(--border-default)', display: 'grid', placeItems: 'center' }}><Icon name={s.icon} size={19} /></div>
              </div>
              <div style={{ textAlign: 'center' }}><div style={{ fontSize: 11, fontWeight: 'var(--fw-semibold)', color: 'var(--text-strong)' }}>{s.label}</div><div style={{ fontSize: 11, color: counts[i] ? 'var(--accent-hover)' : 'var(--text-secondary)', fontWeight: counts[i] ? 'var(--fw-bold)' : 'var(--fw-regular)' }}>{counts[i]} waiting</div></div>
            </div>
          ))}
        </div>
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.3fr) minmax(0,1fr)', gap: 'var(--space-400)', alignItems: 'start' }} className="emr-cols">
        {/* patient list */}
        <Card asArticle padding="var(--space-500)">
          <SectionHeader title="Patients in flow" />
          <div style={{ marginTop: 'var(--space-300)', display: 'flex', flexDirection: 'column', gap: 'var(--space-200)' }}>
            {JOURNEY_PATIENTS.map((p) => {
              const on = sel.id === p.id;
              return (
                <button key={p.id} onClick={() => setSel(p)} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-300)', padding: 'var(--space-300)', textAlign: 'left', border: `1.5px solid ${on ? 'var(--accent)' : 'var(--border-subtle)'}`, borderRadius: 'var(--radius-lg)', background: on ? 'var(--primary-50)' : 'var(--surface)' }}>
                  <span style={{ width: 36, height: 36, borderRadius: 'var(--radius-pill)', background: 'var(--surface)', color: 'var(--accent-hover)', display: 'grid', placeItems: 'center', fontWeight: 'var(--fw-bold)', fontSize: 11, flexShrink: 0, border: '1px solid var(--border-subtle)' }}>{p.name.split(' ').map((x) => x[0]).join('')}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ fontWeight: 'var(--fw-semibold)', color: 'var(--text-strong)' }}>{p.name}</span>{p.flag === 'urgent' && <Badge tone="danger">Urgent</Badge>}{p.flag === 'long-wait' && <Badge tone="warning">Long wait</Badge>}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{p.dept} · at {JOURNEY_STAGES[p.stage].label}</div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}><div style={{ fontSize: 'var(--fs-md)', fontWeight: 'var(--fw-bold)', color: p.waitMins > 20 ? 'var(--warning-600)' : 'var(--text-strong)' }}>{p.waitMins}m</div><div style={{ fontSize: 10, color: 'var(--text-secondary)' }}>in stage</div></div>
                </button>
              );
            })}
          </div>
        </Card>

        {/* selected patient journey detail */}
        <Card asArticle padding="var(--space-500)">
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-300)', paddingBottom: 'var(--space-400)', borderBottom: '1px solid var(--border-subtle)' }}>
            <span style={{ width: 44, height: 44, borderRadius: 'var(--radius-pill)', background: 'var(--primary-50)', color: 'var(--accent-hover)', display: 'grid', placeItems: 'center', fontWeight: 'var(--fw-bold)' }}>{sel.name.split(' ').map((x) => x[0]).join('')}</span>
            <div><div style={{ fontWeight: 'var(--fw-bold)', color: 'var(--text-heading)' }}>{sel.name}</div><div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)' }}>{sel.hid} · {sel.dept}</div></div>
          </div>
          <div style={{ marginTop: 'var(--space-400)', display: 'flex', flexDirection: 'column' }}>
            {JOURNEY_STAGES.map((s, i) => {
              const done = i < sel.stage, current = i === sel.stage;
              return (
                <div key={s.id} style={{ display: 'flex', gap: 'var(--space-300)', alignItems: 'flex-start' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                    <div style={{ width: 28, height: 28, borderRadius: 'var(--radius-pill)', display: 'grid', placeItems: 'center', background: done ? 'var(--success-500)' : current ? 'var(--accent)' : 'var(--surface)', color: done || current ? '#fff' : 'var(--text-secondary)', border: done || current ? 'none' : '1.5px solid var(--border-default)' }}><Icon name={done ? 'check' : s.icon} size={14} /></div>
                    {i < JOURNEY_STAGES.length - 1 && <div style={{ width: 2, height: 22, background: done ? 'var(--success-500)' : 'var(--border-default)' }} />}
                  </div>
                  <div style={{ paddingTop: 3, paddingBottom: 12 }}>
                    <div style={{ fontSize: 'var(--fs-sm)', fontWeight: current ? 'var(--fw-bold)' : 'var(--fw-medium)', color: current ? 'var(--accent-hover)' : done ? 'var(--text-strong)' : 'var(--text-secondary)' }}>{s.label}</div>
                    {current && <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Currently here · {sel.waitMins} min</div>}
                    {done && <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Completed</div>}
                  </div>
                </div>
              );
            })}
          </div>
          <Button variant="primary" size="md" fullWidth icon="route" style={{ marginTop: 'var(--space-200)' }}>Advance to next stage</Button>
        </Card>
      </div>
    </div>
  );
}

// ============================================================================
//  Shifts & Roster (Level 5)
// ============================================================================
function ShiftsModule() {
  const statusTone = { 'clocked-in': 'success', 'on-call': 'info', overtime: 'warning' };
  return (
    <div>
      <PageHead sub="Administration" title="Shifts & Roster" action={<Button variant="primary" icon="clock">Clock in</Button>} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 'var(--space-300)', marginBottom: 'var(--space-400)' }}>
        {SHIFTS.map((s) => (
          <Card key={s.id} padding="var(--space-400)">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}><span style={{ fontSize: 'var(--fs-md)', fontWeight: 'var(--fw-semibold)', color: 'var(--text-strong)' }}>{s.label}</span><Badge tone={s.tone}>{s.onDuty}/{s.required}</Badge></div>
            <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)', marginTop: 4 }}>{s.time}</div>
            <div style={{ marginTop: 10, height: 6, background: 'var(--neutral-100)', borderRadius: 'var(--radius-pill)', overflow: 'hidden' }}><span style={{ display: 'block', height: '100%', width: `${(s.onDuty / s.required) * 100}%`, background: s.tone === 'danger' ? 'var(--danger-500)' : s.tone === 'warning' ? 'var(--warning-500)' : 'var(--success-500)' }} /></div>
            {s.onDuty < s.required && <div style={{ fontSize: 11, color: 'var(--danger-500)', marginTop: 6, display: 'flex', alignItems: 'center', gap: 4 }}><Icon name="alert" size={12} /> {s.required - s.onDuty} coverage gap</div>}
          </Card>
        ))}
      </div>
      <Table cols={['Staff', 'Role', 'Shift', 'Department', 'Status', 'Clock-in']}>
        {ROSTER.map((r) => (
          <tr key={r.name} style={TR}>
            <td style={{ ...TD, fontWeight: 'var(--fw-semibold)', color: 'var(--text-strong)' }}>{r.name}</td>
            <td style={TD}>{r.role}</td><td style={TD}>{r.shift}</td><td style={TD}>{r.dept}</td>
            <td style={TD}><Badge tone={statusTone[r.status]}>{r.status === 'clocked-in' ? 'Clocked in' : r.status === 'on-call' ? 'On call' : 'Overtime'}</Badge></td>
            <td style={TD}>{r.at}</td>
          </tr>
        ))}
      </Table>
    </div>
  );
}

// ============================================================================
//  HR & Credentials (Level 21) — license expiry tracking
// ============================================================================
function HRModule() {
  const tone = { valid: 'success', expiring: 'warning', expired: 'danger' };
  const label = { valid: 'Valid', expiring: 'Expiring soon', expired: 'Expired' };
  return (
    <div>
      <PageHead sub="Administration" title="HR & Credentials" action={<Button variant="primary" icon="user-plus">Add staff</Button>} />
      <div style={{ display: 'flex', gap: 8, padding: 'var(--space-300)', background: 'var(--warning-50)', borderRadius: 'var(--radius-md)', fontSize: 'var(--fs-sm)', color: 'var(--warning-600)', marginBottom: 'var(--space-400)' }}>
        <Icon name="alert" size={16} style={{ flexShrink: 0 }} /> 1 licence has expired and 1 expires within 60 days — practising on an expired licence is a compliance risk.
      </div>
      <Table cols={['Staff', 'Role', 'Licence', 'Expires', 'Status', 'Leave balance']}>
        {HR_STAFF.map((s) => (
          <tr key={s.name} style={TR}>
            <td style={{ ...TD, fontWeight: 'var(--fw-semibold)', color: 'var(--text-strong)' }}>{s.name}</td>
            <td style={TD}>{s.role}</td><td style={TD}>{s.license}</td><td style={TD}>{s.expires}</td>
            <td style={TD}><Badge tone={tone[s.status]} icon={s.status === 'valid' ? 'check' : 'alert'}>{label[s.status]}</Badge></td>
            <td style={TD}>{s.leave}</td>
          </tr>
        ))}
      </Table>
    </div>
  );
}

// ============================================================================
//  Quality & Safety (Level 23) + incident reporting
// ============================================================================
function QualityModule() {
  const sevTone = { high: 'danger', moderate: 'warning', low: 'gray' };
  const stTone = { open: 'danger', investigating: 'warning', closed: 'success' };
  return (
    <div>
      <PageHead sub="Administration" title="Quality & Safety" action={<Button variant="primary" icon="plus">Report incident</Button>} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 'var(--space-300)', marginBottom: 'var(--space-400)' }}>
        {QUALITY_KPIS.map((k) => (
          <Card key={k.label} padding="var(--space-400)">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}><span style={{ fontSize: 'var(--fs-h-sm)', fontWeight: 'var(--fw-bold)', color: 'var(--text-heading)', lineHeight: 1 }}>{k.value}</span><span style={{ fontSize: 11, fontWeight: 'var(--fw-semibold)', color: k.tone === 'flat' ? 'var(--text-secondary)' : 'var(--success-600)' }}>{k.delta}</span></div>
            <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)', marginTop: 4 }}>{k.label}</div>
          </Card>
        ))}
      </div>
      <SectionHeader title="Incident reports" hint="Medico-legal — nothing is hard-deleted (L22)" />
      <div style={{ marginTop: 'var(--space-300)' }}>
        <Table cols={['ID', 'Type', 'Department', 'Severity', 'Status', 'When']}>
          {INCIDENTS.map((i) => (
            <tr key={i.id} style={TR}>
              <td style={{ ...TD, fontWeight: 'var(--fw-semibold)', color: 'var(--text-strong)' }}>{i.id}</td>
              <td style={TD}>{i.type}</td><td style={TD}>{i.dept}</td>
              <td style={TD}><Badge tone={sevTone[i.severity]}>{i.severity}</Badge></td>
              <td style={TD}><Badge tone={stTone[i.status]}>{i.status}</Badge></td>
              <td style={TD}>{i.when}</td>
            </tr>
          ))}
        </Table>
      </div>
    </div>
  );
}

// ============================================================================
//  Insurance & Claims (Level 15)
// ============================================================================
function InsuranceModule() {
  const tone = { submitted: 'info', 'pre-auth': 'warning', approved: 'success', rejected: 'danger' };
  const label = { submitted: 'Submitted', 'pre-auth': 'Pre-auth', approved: 'Approved', rejected: 'Rejected' };
  return (
    <div>
      <PageHead sub="Operations" title="Insurance & Claims" action={<Button variant="primary" icon="plus">New claim</Button>} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 'var(--space-300)', marginBottom: 'var(--space-400)' }}>
        {INSURANCE_KPIS.map(([l, v]) => <MiniStat key={l} label={l} value={v} />)}
      </div>
      <Table cols={['Claim', 'Patient', 'Insurer', 'Service', 'Amount', 'Status', '']}>
        {CLAIMS.map((c) => (
          <tr key={c.id} style={TR}>
            <td style={{ ...TD, fontWeight: 'var(--fw-semibold)', color: 'var(--text-strong)', whiteSpace: 'nowrap' }}>{c.id}</td>
            <td style={TD}>{c.patient}</td><td style={TD}>{c.insurer}</td><td style={TD}>{c.service}</td>
            <td style={{ ...TD, fontWeight: 'var(--fw-semibold)', color: 'var(--text-strong)' }}>{naira(c.amount)}</td>
            <td style={TD}><Badge tone={tone[c.status]}>{label[c.status]}</Badge></td>
            <td style={{ ...TD, textAlign: 'right' }}>{c.status === 'pre-auth' ? <Button size="sm" variant="primary">Authorize</Button> : <Button size="sm" variant="ghost">View</Button>}</td>
          </tr>
        ))}
      </Table>
      <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 'var(--space-300)', fontStyle: 'italic' }}>Health ID records claim status — settlement happens with the HMO, not on Health ID (D6).</div>
    </div>
  );
}

// ============================================================================
//  Inventory & Procurement (Level 20)
// ============================================================================
function InventoryModule() {
  const poTone = { pending: 'warning', approved: 'info', delivered: 'success' };
  return (
    <div>
      <PageHead sub="Operations" title="Inventory & Procurement" action={<Button variant="primary" icon="plus">Purchase request</Button>} />
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.4fr) minmax(0,1fr)', gap: 'var(--space-400)', alignItems: 'start' }} className="emr-cols">
        <div>
          <SectionHeader title="Stock levels" />
          <div style={{ marginTop: 'var(--space-300)' }}>
            <Table cols={['Item', 'Category', 'In stock', 'Status']}>
              {STOCK_ITEMS.map((s) => (
                <tr key={s.item} style={TR}>
                  <td style={{ ...TD, fontWeight: 'var(--fw-semibold)', color: 'var(--text-strong)' }}>{s.item}</td>
                  <td style={TD}>{s.cat}</td><td style={TD}>{s.stock}</td>
                  <td style={TD}><Badge tone={s.tone}>{s.tone === 'danger' ? 'Critical' : s.tone === 'warning' ? 'Low' : 'OK'}</Badge></td>
                </tr>
              ))}
            </Table>
          </div>
        </div>
        <Card asArticle padding="var(--space-500)">
          <SectionHeader title="Purchase orders" />
          <div style={{ marginTop: 'var(--space-300)', display: 'flex', flexDirection: 'column', gap: 'var(--space-200)' }}>
            {PROCUREMENT.map((p) => (
              <div key={p.id} style={{ padding: 'var(--space-300)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><span style={{ fontWeight: 'var(--fw-semibold)', color: 'var(--text-strong)' }}>{p.id}</span><Badge tone={poTone[p.status]}>{p.status}</Badge></div>
                <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)', marginTop: 2 }}>{p.vendor} · {p.items} items · {naira(p.value)}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

// ============================================================================
//  Ambulance (blind-spot)
// ============================================================================
function AmbulanceModule() {
  const tone = { 'on-call': 'success', dispatched: 'danger', maintenance: 'gray' };
  return (
    <div>
      <PageHead sub="Network & Services" title="Ambulance" action={<Button variant="primary" icon="truck">Dispatch</Button>} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-200)' }}>
        {AMBULANCES.map((a) => (
          <Card key={a.id} asArticle padding="var(--space-400)">
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-400)' }}>
              <div style={{ width: 44, height: 44, borderRadius: 'var(--radius-md)', background: a.status === 'dispatched' ? 'var(--danger-50)' : 'var(--primary-50)', color: a.status === 'dispatched' ? 'var(--danger-500)' : 'var(--accent-hover)', display: 'grid', placeItems: 'center', flexShrink: 0 }}><Icon name="truck" size={22} /></div>
              <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 'var(--fw-semibold)', color: 'var(--text-strong)' }}>{a.id} · {a.plate}</div><div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)' }}>{a.crew}{a.eta !== '—' ? ' · ETA ' + a.eta : ''}</div></div>
              <Badge tone={tone[a.status]}>{a.status === 'on-call' ? 'On call' : a.status === 'dispatched' ? 'Dispatched' : 'Maintenance'}</Badge>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
//  Blood Bank (blind-spot)
// ============================================================================
function BloodBankModule() {
  const tone = { success: { bg: 'var(--success-50)', fg: 'var(--success-600)' }, warning: { bg: 'var(--warning-50)', fg: 'var(--warning-600)' }, danger: { bg: 'var(--danger-50)', fg: 'var(--danger-500)' } };
  return (
    <div>
      <PageHead sub="Network & Services" title="Blood Bank" action={<Button variant="primary" icon="plus">Log donation</Button>} />
      <div style={{ display: 'flex', gap: 8, padding: 'var(--space-300)', background: 'var(--danger-50)', borderRadius: 'var(--radius-md)', fontSize: 'var(--fs-sm)', color: 'var(--danger-badge-text)', marginBottom: 'var(--space-400)' }}>
        <Icon name="alert" size={16} style={{ flexShrink: 0 }} /> O− and B− are critically low — consider a donor call-out.
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: 'var(--space-300)' }}>
        {BLOOD_STOCK.map((b) => { const t = tone[b.tone]; return (
          <Card key={b.group} padding="var(--space-400)" style={{ background: t.bg }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Icon name="droplet" size={20} style={{ color: t.fg }} /><span style={{ fontSize: 'var(--fs-h-sm)', fontWeight: 'var(--fw-bold)', color: 'var(--text-heading)' }}>{b.group}</span></div>
            <div style={{ fontSize: 'var(--fs-lg)', fontWeight: 'var(--fw-bold)', color: t.fg, marginTop: 8 }}>{b.units} <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 'var(--fw-regular)', color: 'var(--text-secondary)' }}>units</span></div>
          </Card>
        ); })}
      </div>
    </div>
  );
}

// ============================================================================
//  Telemedicine (blind-spot)
// ============================================================================
function TelemedicineModule() {
  const tone = { waiting: 'warning', scheduled: 'gray', completed: 'success' };
  return (
    <div>
      <PageHead sub="Network & Services" title="Telemedicine" action={<Button variant="primary" icon="video">Start session</Button>} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-200)' }}>
        {TELE_SESSIONS.map((s) => (
          <Card key={s.id} asArticle padding="var(--space-400)">
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-400)' }}>
              <div style={{ width: 56, fontSize: 'var(--fs-md)', fontWeight: 'var(--fw-bold)', color: 'var(--accent-hover)', flexShrink: 0 }}>{s.time}</div>
              <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 'var(--fw-semibold)', color: 'var(--text-strong)' }}>{s.patient}</div><div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)' }}>{s.doctor} · video consult</div></div>
              <Badge tone={tone[s.status]}>{s.status}</Badge>
              {s.status === 'waiting' && <Button size="sm" variant="primary" icon="video">Join</Button>}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
//  Referral Network (Level 25 / blind-spot)
// ============================================================================
function ReferralsModule() {
  const tone = { sent: 'info', accepted: 'warning', completed: 'success' };
  return (
    <div>
      <PageHead sub="Network & Services" title="Referral Network" action={<Button variant="primary" icon="share">New referral</Button>} />
      <Table cols={['Ref', 'Patient', 'Referred to', 'Reason', 'Urgency', 'Status']}>
        {REFERRALS_OUT.map((r) => (
          <tr key={r.id} style={TR}>
            <td style={{ ...TD, fontWeight: 'var(--fw-semibold)', color: 'var(--text-strong)', whiteSpace: 'nowrap' }}>{r.id}</td>
            <td style={TD}>{r.patient}</td><td style={TD}>{r.to}</td><td style={TD}>{r.reason}</td>
            <td style={TD}>{r.urgency === 'urgent' ? <Badge tone="danger">Urgent</Badge> : <span style={{ color: 'var(--text-secondary)' }}>Routine</span>}</td>
            <td style={TD}><Badge tone={tone[r.status]}>{r.status}</Badge></td>
          </tr>
        ))}
      </Table>
      <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 'var(--space-300)', fontStyle: 'italic' }}>Referrals carry a consented clinical summary through the Health ID Referral Network — the receiving facility still requests record access.</div>
    </div>
  );
}

Object.assign(window, {
  JourneyModule, ShiftsModule, HRModule, QualityModule, InsuranceModule, InventoryModule,
  AmbulanceModule, BloodBankModule, TelemedicineModule, ReferralsModule,
});
