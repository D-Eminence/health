// emr-clinical.jsx — clinical modules (own-EMR data; no consent gate — first-party records)
const { useState: useClin } = React;

const EMR_INPUT = { width: '100%', padding: '10px 12px', fontSize: 'var(--fs-md)', border: '1px solid var(--border-control)', borderRadius: 'var(--radius-md)', color: 'var(--text-strong)', background: 'var(--surface)' };
function ClinField({ label, children, optional }) {
  return <label style={{ display: 'block' }}><span style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--fs-sm)', fontWeight: 'var(--fw-semibold)', color: 'var(--text-strong)', marginBottom: 6 }}>{label}{optional && <span style={{ fontWeight: 'var(--fw-regular)', color: 'var(--text-secondary)' }}>Optional</span>}</span>{children}</label>;
}

// ============================================================================
//  Patients — list + universal search + registration (with duplicate detection)
// ============================================================================
function PatientsModule({ onOpenPatient }) {
  const [q, setQ] = useClin('');
  const [reg, setReg] = useClin(false);
  const rows = PATIENTS.filter((p) => (p.name + p.hid + p.phone).toLowerCase().includes(q.toLowerCase()));
  if (reg) return <RegisterPatient onCancel={() => setReg(false)} onDone={() => setReg(false)} />;
  return (
    <div>
      <PageHead sub="Clinical" title="Patients" action={<Button variant="primary" icon="user-plus" onClick={() => setReg(true)}>Register patient</Button>} />
      <Card asArticle padding="0">
        <div style={{ padding: 'var(--space-400)', borderBottom: '1px solid var(--border-subtle)', position: 'relative' }}>
          <span style={{ position: 'absolute', left: 'calc(var(--space-400) + 12px)', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }}><Icon name="search" size={16} /></span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, HID or phone…" style={{ ...EMR_INPUT, paddingLeft: 38 }} />
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--fs-sm)' }}>
            <thead><tr style={{ textAlign: 'left', color: 'var(--text-secondary)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {['Patient', 'HID', 'Age/Sex', 'Blood/Genotype', 'Insurer', 'Status', ''].map((h) => <th key={h} style={{ padding: '10px 16px', fontWeight: 'var(--fw-bold)', whiteSpace: 'nowrap' }}>{h}</th>)}
            </tr></thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} onClick={() => onOpenPatient(p)} style={{ borderTop: '1px solid var(--border-subtle)', cursor: 'pointer' }}>
                  <td style={{ padding: '12px 16px' }}><div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><span style={{ width: 32, height: 32, borderRadius: 'var(--radius-pill)', background: 'var(--primary-50)', color: 'var(--accent-hover)', display: 'grid', placeItems: 'center', fontWeight: 'var(--fw-bold)', fontSize: 11, flexShrink: 0 }}>{p.name.split(' ').map((x) => x[0]).join('')}</span><div><div style={{ fontWeight: 'var(--fw-semibold)', color: 'var(--text-strong)' }}>{p.name}</div>{p.flag && <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{p.flag}</div>}</div></div></td>
                  <td style={{ padding: '12px 16px', color: 'var(--text-body)', whiteSpace: 'nowrap' }}><span className="mono">{p.hid}</span></td>
                  <td style={{ padding: '12px 16px', color: 'var(--text-body)' }}>{p.age} · {p.sex}</td>
                  <td style={{ padding: '12px 16px', color: 'var(--text-body)' }}>{p.blood} · {p.genotype}</td>
                  <td style={{ padding: '12px 16px', color: 'var(--text-body)' }}>{p.insurer}</td>
                  <td style={{ padding: '12px 16px' }}><Badge tone={p.status === 'Admitted' ? 'warning' : 'gray'}>{p.status}</Badge></td>
                  <td style={{ padding: '12px 16px', textAlign: 'right' }}><Icon name="chevron" size={16} style={{ color: 'var(--text-secondary)' }} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && <div style={{ padding: 'var(--space-600)' }}><EmptyState icon="search" title="No patients found" body={`Nothing matches “${q}”.`} /></div>}
        </div>
      </Card>
    </div>
  );
}

function RegisterPatient({ onCancel, onDone }) {
  const [name, setName] = useClin('');
  const [dup, setDup] = useClin(false);
  const [done, setDone] = useClin(false);
  // duplicate detection fires when the typed name resembles an existing record
  function check(v) { setName(v); setDup(v.trim().toLowerCase().startsWith('ngozi')); }
  if (done) {
    return (
      <div style={{ maxWidth: 520, margin: '0 auto', textAlign: 'center', padding: 'var(--space-800) 0' }}>
        <div style={{ width: 60, height: 60, borderRadius: 'var(--radius-pill)', background: 'var(--success-50)', color: 'var(--success-600)', display: 'grid', placeItems: 'center', margin: '0 auto var(--space-400)' }}><Icon name="check" size={30} strokeWidth={2.4} /></div>
        <h2 style={{ fontSize: 'var(--fs-h-sm)', fontWeight: 'var(--fw-bold)', color: 'var(--text-heading)' }}>{name || 'Patient'} registered</h2>
        <div style={{ marginTop: 8 }}><Badge tone="info" icon="qr">HID-71-9920 assigned</Badge></div>
        <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)', marginTop: 'var(--space-300)', maxWidth: 340, marginInline: 'auto', lineHeight: 1.45 }}>A HID card with QR identity is ready to print. The patient can now be sent to triage.</div>
        <div style={{ display: 'flex', gap: 'var(--space-200)', justifyContent: 'center', marginTop: 'var(--space-500)' }}><Button variant="secondary" onClick={onDone}>Done</Button><Button variant="primary" icon="qr">Print HID card</Button></div>
      </div>
    );
  }
  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      <button onClick={onCancel} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: 'var(--fs-sm)', fontWeight: 'var(--fw-semibold)', marginBottom: 'var(--space-400)' }}><Icon name="arrowLeft" size={16} /> Patients</button>
      <PageHead sub="Clinical" title="Register patient" />
      <Card asArticle padding="var(--space-500)">
        <div style={{ display: 'flex', gap: 8, padding: 'var(--space-300)', background: 'var(--surface-info)', borderRadius: 'var(--radius-md)', fontSize: 'var(--fs-sm)', color: 'var(--text-body)', marginBottom: 'var(--space-400)' }}>
          <Icon name="search" size={16} style={{ flexShrink: 0, color: 'var(--accent)' }} /> Search HID Identity first to avoid creating a duplicate record.
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 'var(--space-400)' }}>
          <ClinField label="Full name"><input value={name} onChange={(e) => check(e.target.value)} placeholder="First and last name" style={EMR_INPUT} /></ClinField>
          <ClinField label="Phone"><input placeholder="080…" style={EMR_INPUT} inputMode="tel" /></ClinField>
          <ClinField label="Date of birth"><input type="date" style={EMR_INPUT} /></ClinField>
          <ClinField label="Sex"><select style={EMR_INPUT}><option>Female</option><option>Male</option></select></ClinField>
          <ClinField label="Blood group" optional><select style={EMR_INPUT}><option>Unknown</option><option>O+</option><option>A+</option><option>B+</option><option>AB+</option></select></ClinField>
          <ClinField label="Genotype" optional><select style={EMR_INPUT}><option>Unknown</option><option>AA</option><option>AS</option><option>SS</option></select></ClinField>
          <ClinField label="Next of kin" optional><input placeholder="Name & phone" style={EMR_INPUT} /></ClinField>
          <ClinField label="Insurer" optional><select style={EMR_INPUT}><option>Self-pay</option><option>NHIS</option><option>Hygeia HMO</option></select></ClinField>
        </div>
        {dup && (
          <div style={{ marginTop: 'var(--space-400)', padding: 'var(--space-400)', border: '1px solid var(--warning-500)', borderRadius: 'var(--radius-lg)', background: 'var(--warning-50)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 'var(--fw-semibold)', color: 'var(--warning-600)' }}><Icon name="alert" size={16} /> Possible duplicate found</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-300)', marginTop: 'var(--space-300)', padding: 'var(--space-300)', background: 'var(--surface)', borderRadius: 'var(--radius-md)' }}>
              <span style={{ width: 36, height: 36, borderRadius: 'var(--radius-pill)', background: 'var(--primary-50)', color: 'var(--accent-hover)', display: 'grid', placeItems: 'center', fontWeight: 'var(--fw-bold)', fontSize: 12 }}>NB</span>
              <div style={{ flex: 1 }}><div style={{ fontWeight: 'var(--fw-semibold)', color: 'var(--text-strong)' }}>Ngozi Bello</div><div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>31 · F · HID-71-2204 · last seen 2 days ago</div></div>
              <Button size="sm" variant="secondary">Use this record</Button>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 8, fontStyle: 'italic' }}>A person reviews every match — records are never auto-merged (D18).</div>
          </div>
        )}
      </Card>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-200)', marginTop: 'var(--space-400)' }}>
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button variant="primary" icon="check" onClick={() => setDone(true)}>Register & assign HID</Button>
      </div>
    </div>
  );
}

// ============================================================================
//  Triage & Vitals — queue + vitals entry with abnormality alerts
// ============================================================================
function TriageModule() {
  const [active, setActive] = useClin(null);
  if (active) return <VitalsEntry patient={active} onBack={() => setActive(null)} />;
  return (
    <div>
      <PageHead sub="Clinical" title="Triage & Vitals" action={<Badge tone="warning" icon="activity">{TRIAGE_QUEUE.length} waiting</Badge>} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-200)' }}>
        {TRIAGE_QUEUE.map((t) => (
          <Card key={t.id} asArticle padding="var(--space-300) var(--space-400)">
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-300)' }}>
              <div style={{ width: 6, height: 40, borderRadius: 3, background: t.priority === 'urgent' ? 'var(--danger-500)' : 'var(--border-default)', flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span style={{ fontWeight: 'var(--fw-semibold)', color: 'var(--text-strong)' }}>{t.name}</span>{t.priority === 'urgent' && <Badge tone="danger" icon="alert">Urgent</Badge>}</div>
                <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)' }}>{t.hid} · {t.complaint} · arrived {t.arrived}</div>
              </div>
              <Button size="sm" variant="primary" icon="activity" onClick={() => setActive(t)}>Take vitals</Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function VitalsEntry({ patient, onBack }) {
  const [v, setV] = useClin({});
  const [saved, setSaved] = useClin(false);
  function set(k, val) { setV((s) => ({ ...s, [k]: val })); }
  function abnormal(f) { const n = parseFloat(v[f.k]); return !isNaN(n) && (n < f.lo || n > f.hi); }
  const anyAbn = VITAL_FIELDS.some((f) => f.lo > 0 && abnormal(f));
  const bmi = (() => { const w = parseFloat(v.weight), h = parseFloat(v.height) / 100; return w && h ? (w / (h * h)).toFixed(1) : '—'; })();
  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      <button onClick={onBack} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: 'var(--fs-sm)', fontWeight: 'var(--fw-semibold)', marginBottom: 'var(--space-400)' }}><Icon name="arrowLeft" size={16} /> Triage queue</button>
      <PageHead sub={`${patient.hid} · ${patient.complaint}`} title={patient.name} />
      {saved ? (
        <Card asArticle padding="var(--space-600)"><div style={{ textAlign: 'center' }}><div style={{ width: 52, height: 52, borderRadius: 'var(--radius-pill)', background: 'var(--success-50)', color: 'var(--success-600)', display: 'grid', placeItems: 'center', margin: '0 auto var(--space-300)' }}><Icon name="check" size={26} strokeWidth={2.4} /></div><div style={{ fontSize: 'var(--fs-lg)', fontWeight: 'var(--fw-bold)', color: 'var(--text-heading)' }}>Vitals recorded</div><div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)', marginTop: 6 }}>{patient.name} is now in the doctor's queue.</div><Button variant="primary" icon="arrowLeft" onClick={onBack} style={{ marginTop: 'var(--space-400)' }}>Back to triage</Button></div></Card>
      ) : (
        <React.Fragment>
          <Card asArticle padding="var(--space-500)">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 'var(--space-300)' }}>
              {VITAL_FIELDS.map((f) => {
                const abn = f.lo > 0 && abnormal(f);
                return (
                  <ClinField key={f.k} label={`${f.label} (${f.unit})`}>
                    <input value={v[f.k] || ''} onChange={(e) => set(f.k, e.target.value)} placeholder={f.ph} inputMode="decimal" style={{ ...EMR_INPUT, borderColor: abn ? 'var(--danger-500)' : 'var(--border-control)', color: abn ? 'var(--danger-badge-text)' : 'var(--text-strong)', fontWeight: abn ? 'var(--fw-semibold)' : 'var(--fw-regular)' }} />
                    {abn && <span style={{ fontSize: 11, color: 'var(--danger-500)', display: 'flex', alignItems: 'center', gap: 4, marginTop: 4 }}><Icon name="alert" size={12} /> Outside {f.lo}–{f.hi}</span>}
                  </ClinField>
                );
              })}
              <ClinField label="BMI (auto)"><div style={{ ...EMR_INPUT, background: 'var(--surface-muted)', color: 'var(--text-secondary)' }}>{bmi}</div></ClinField>
            </div>
            {anyAbn && <div style={{ display: 'flex', gap: 8, padding: 'var(--space-300)', background: 'var(--danger-50)', borderRadius: 'var(--radius-md)', fontSize: 'var(--fs-sm)', color: 'var(--danger-badge-text)', marginTop: 'var(--space-400)' }}><Icon name="alert" size={16} style={{ flexShrink: 0 }} /> One or more vitals are outside the normal range — the doctor will be alerted.</div>}
          </Card>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-200)', marginTop: 'var(--space-400)' }}><Button variant="secondary" onClick={onBack}>Cancel</Button><Button variant="primary" icon="check" onClick={() => setSaved(true)}>Save & send to doctor</Button></div>
        </React.Fragment>
      )}
    </div>
  );
}

// ============================================================================
//  Inpatient / Wards — bed occupancy grid
// ============================================================================
const BED_TONE = { occupied: { bg: 'var(--primary-50)', bd: 'var(--accent)', fg: 'var(--accent-hover)' }, free: { bg: 'var(--success-50)', bd: 'var(--success-500)', fg: 'var(--success-600)' }, cleaning: { bg: 'var(--warning-50)', bd: 'var(--warning-500)', fg: 'var(--warning-600)' } };
function InpatientModule() {
  const total = WARDS.reduce((s, w) => s + w.beds.length, 0);
  const occ = WARDS.reduce((s, w) => s + w.beds.filter((b) => b.s === 'occupied').length, 0);
  return (
    <div>
      <PageHead sub="Clinical" title="Inpatient / Wards" action={<Badge tone="info" icon="bed">{occ}/{total} beds occupied</Badge>} />
      <div style={{ display: 'flex', gap: 'var(--space-300)', marginBottom: 'var(--space-400)', flexWrap: 'wrap' }}>
        {[['occupied', 'Occupied'], ['free', 'Available'], ['cleaning', 'Cleaning']].map(([s, l]) => <span key={s} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)' }}><span style={{ width: 12, height: 12, borderRadius: 3, background: BED_TONE[s].bg, border: `1.5px solid ${BED_TONE[s].bd}` }} /> {l}</span>)}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-400)' }}>
        {WARDS.map((w) => (
          <Card key={w.id} asArticle padding="var(--space-500)">
            <SectionHeader title={w.name} hint={`${w.beds.filter((b) => b.s === 'occupied').length} of ${w.beds.length} occupied`} />
            <div style={{ marginTop: 'var(--space-400)', display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(120px,1fr))', gap: 'var(--space-200)' }}>
              {w.beds.map((b) => { const t = BED_TONE[b.s]; return (
                <div key={b.n} style={{ padding: 'var(--space-300)', border: `1.5px solid ${t.bd}`, borderRadius: 'var(--radius-lg)', background: t.bg }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}><span style={{ fontSize: 11, fontWeight: 'var(--fw-bold)', color: t.fg }}>Bed {b.n}</span><Icon name="bed" size={15} style={{ color: t.fg }} /></div>
                  <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 'var(--fw-semibold)', color: 'var(--text-strong)', marginTop: 6, textTransform: b.who ? 'none' : 'capitalize' }}>{b.who || b.s}</div>
                </div>
              ); })}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
//  Appointments — day schedule
// ============================================================================
function AppointmentsModule() {
  const statusTone = { 'checked-in': 'success', booked: 'gray' };
  return (
    <div>
      <PageHead sub="Clinical" title="Appointments" action={<Button variant="primary" icon="plus">New booking</Button>} />
      <Card asArticle padding="var(--space-500)">
        <SectionHeader title="Today · Thu 29 May" hint={`${APPTS.length} appointments`} />
        <div style={{ marginTop: 'var(--space-400)', display: 'flex', flexDirection: 'column' }}>
          {APPTS.map((a, i) => (
            <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-400)', padding: 'var(--space-300) 0', borderTop: i ? '1px solid var(--border-subtle)' : 'none' }}>
              <div style={{ width: 56, fontSize: 'var(--fs-md)', fontWeight: 'var(--fw-bold)', color: 'var(--accent-hover)', flexShrink: 0 }}>{a.time}</div>
              <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 'var(--fw-semibold)', color: 'var(--text-strong)' }}>{a.patient}</div><div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)' }}>{a.type} · {a.doctor}</div></div>
              <Badge tone={statusTone[a.status]} icon={a.status === 'checked-in' ? 'check' : 'clock'}>{a.status === 'checked-in' ? 'Checked in' : 'Booked'}</Badge>
              <Button size="sm" variant="ghost" icon="bell">Remind</Button>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

// ============================================================================
//  Emergency — critical cases (links break-glass)
// ============================================================================
function EmergencyModule({ onBreakGlass }) {
  return (
    <div>
      <PageHead sub="Clinical" title="Emergency" action={<Button variant="primary" icon="user-plus">Fast registration</Button>} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-200)' }}>
        {EMERGENCY_CASES.map((c) => (
          <Card key={c.id} asArticle padding="var(--space-400)" style={c.triage.startsWith('P1') ? { borderColor: 'var(--danger-300)' } : undefined}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-400)' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span style={{ fontSize: 'var(--fs-md)', fontWeight: 'var(--fw-bold)', color: 'var(--text-heading)' }}>{c.name}</span><Badge tone={c.triage.startsWith('P1') ? 'danger' : 'warning'}>{c.triage}</Badge></div>
                <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)', marginTop: 2 }}>{c.complaint} · arrived {c.arrived}</div>
              </div>
              {c.glass
                ? <Button size="sm" variant="outline" icon="alert" onClick={onBreakGlass} style={{ color: 'var(--danger-500)', borderColor: 'var(--danger-300)' }}>Break glass</Button>
                : <Button size="sm" variant="secondary" icon="stethoscope">Open case</Button>}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
//  Maternity — ANC register
// ============================================================================
function MaternityModule() {
  return (
    <div>
      <PageHead sub="Clinical" title="Maternity — Antenatal" action={<Button variant="primary" icon="user-plus">New ANC registration</Button>} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-200)' }}>
        {ANC.map((m) => (
          <Card key={m.id} asArticle padding="var(--space-400)">
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-400)', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 160 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span style={{ fontWeight: 'var(--fw-semibold)', color: 'var(--text-strong)' }}>{m.name}</span>{m.risk === 'high' && <Badge tone="danger" icon="alert">High risk</Badge>}</div>
                <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)' }}>{m.ga} · EDD {m.edd} · {m.visit}</div>
              </div>
              <div style={{ textAlign: 'right' }}><div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Next visit</div><div style={{ fontWeight: 'var(--fw-semibold)', color: m.next === 'Today' ? 'var(--accent-hover)' : 'var(--text-strong)' }}>{m.next}</div></div>
              <Button size="sm" variant="secondary">Open ANC card</Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
//  Theatre / Surgery — day schedule
// ============================================================================
function SurgeryModule() {
  const tone = { 'in-theatre': 'danger', scheduled: 'gray' };
  return (
    <div>
      <PageHead sub="Clinical" title="Theatre" action={<Button variant="primary" icon="plus">Schedule surgery</Button>} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-200)' }}>
        {SURGERIES.map((s) => (
          <Card key={s.id} asArticle padding="var(--space-400)">
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-400)' }}>
              <div style={{ width: 56, fontSize: 'var(--fs-md)', fontWeight: 'var(--fw-bold)', color: 'var(--accent-hover)', flexShrink: 0 }}>{s.time}</div>
              <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 'var(--fw-semibold)', color: 'var(--text-strong)' }}>{s.proc}</div><div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)' }}>{s.theatre} · {s.surgeon}</div></div>
              <Badge tone={tone[s.status]} icon={s.status === 'in-theatre' ? 'activity' : 'clock'}>{s.status === 'in-theatre' ? 'In theatre' : 'Scheduled'}</Badge>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

Object.assign(window, { PatientsModule, RegisterPatient, TriageModule, InpatientModule, AppointmentsModule, EmergencyModule, MaternityModule, SurgeryModule, EMR_INPUT, ClinField });
