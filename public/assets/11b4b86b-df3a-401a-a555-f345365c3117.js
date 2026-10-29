// hospital-consult.jsx — consultation body: record panels + composers
const { useState: useConsult } = React;

// ---- record panels (visible only under grant/break-glass) ----
function RecordPanel({ title, icon, children, danger }) {
  return (
    <Card asArticle padding="var(--space-400)">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 'var(--space-300)' }}>
        <span style={{ color: danger ? 'var(--danger-500)' : 'var(--text-secondary)' }}><Icon name={icon} size={18} /></span>
        <span style={{ fontSize: 'var(--fs-md)', fontWeight: 'var(--fw-semibold)', color: 'var(--text-strong)' }}>{title}</span>
      </div>
      {children}
    </Card>
  );
}

function AllergyPanel() {
  return (
    <RecordPanel title="Allergies" icon="alert" danger>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-200)' }}>
        {PATIENT.allergies.map((a) => (
          <div key={a.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: a.severity === 'severe' ? 'var(--danger-50)' : 'var(--surface-muted)', borderRadius: 'var(--radius-md)' }}>
            <div>
              <span style={{ fontWeight: 'var(--fw-semibold)', color: a.severity === 'severe' ? 'var(--danger-badge-text)' : 'var(--text-strong)' }}>{a.name}</span>
              <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)' }}> · {a.note}</span>
            </div>
            {a.severity === 'severe' && <Badge tone="danger">Severe</Badge>}
          </div>
        ))}
      </div>
    </RecordPanel>
  );
}

function MedsPanel() {
  return (
    <RecordPanel title="Current medications" icon="pill">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {PATIENT.medications.map((m) => (
          <div key={m.name} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--fs-md)' }}>
            <span style={{ color: 'var(--text-strong)' }}>{m.name}</span>
            <span style={{ color: 'var(--text-secondary)', fontSize: 'var(--fs-sm)' }}>{m.dose}</span>
          </div>
        ))}
      </div>
    </RecordPanel>
  );
}

function VitalsPanel() {
  const v = PATIENT.vitals;
  const items = [
    { k: 'BP', val: v.bp, flag: true }, { k: 'Pulse', val: v.pulse }, { k: 'Temp', val: v.temp }, { k: 'SpO₂', val: v.spo2 },
  ];
  return (
    <RecordPanel title="Vitals" icon="activity">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 'var(--space-200)' }}>
        {items.map((it) => (
          <div key={it.k} style={{ padding: '8px 10px', background: 'var(--surface-muted)', borderRadius: 'var(--radius-md)', textAlign: 'center' }}>
            <div style={{ fontSize: 'var(--fs-md)', fontWeight: 'var(--fw-bold)', color: it.flag ? 'var(--warning-600)' : 'var(--text-strong)' }}>{it.val}</div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{it.k}</div>
          </div>
        ))}
      </div>
    </RecordPanel>
  );
}

function ResultsPanel() {
  return (
    <RecordPanel title="Recent results" icon="flask">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {PATIENT.recentResults.map((r) => (
          <div key={r.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <span style={{ color: 'var(--text-strong)', fontWeight: 'var(--fw-medium)' }}>{r.name}</span>
              <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}> · {r.when}</span>
            </div>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontWeight: 'var(--fw-semibold)', color: r.flag === 'normal' ? 'var(--text-strong)' : 'var(--warning-600)' }}>{r.value}</span>
              {r.flag === 'low' && <Badge tone="warning">Low</Badge>}
              {r.flag === 'high' && <Badge tone="warning">High</Badge>}
            </span>
          </div>
        ))}
      </div>
    </RecordPanel>
  );
}

// ---- consultation note ----
function NotePanel({ note, onNote, dx, onDx }) {
  return (
    <Card asArticle>
      <SectionHeader title="Consultation note" />
      <textarea value={note} onChange={(e) => onNote(e.target.value)} rows={4} placeholder="History, examination, findings…"
        style={{ width: '100%', marginTop: 'var(--space-300)', padding: '12px', fontSize: 'var(--fs-md)', border: '1px solid var(--border-control)', borderRadius: 'var(--radius-md)', color: 'var(--text-strong)', resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }} />
      <label style={{ display: 'block', marginTop: 'var(--space-300)', fontSize: 'var(--fs-sm)', fontWeight: 'var(--fw-semibold)', color: 'var(--text-strong)' }}>Assessment / diagnosis</label>
      <input value={dx} onChange={(e) => onDx(e.target.value)} placeholder="e.g. Iron-deficiency anaemia in pregnancy"
        style={{ width: '100%', marginTop: 6, padding: '10px 12px', fontSize: 'var(--fs-md)', border: '1px solid var(--border-control)', borderRadius: 'var(--radius-md)', color: 'var(--text-strong)' }} />
    </Card>
  );
}

// ---- prescribe composer (searchable catalog, per-line dosage, auto classification; allergy
//      interaction surfaced — clinician decides — D5. Carries clinician + institution metadata.) ----
function PrescribePanel({ items, onAdd, onRemove, onDose }) {
  const [open, setOpen] = useConsult(false);
  const [q, setQ] = useConsult('');
  const matches = DRUGS.filter((d) => d.name.toLowerCase().includes(q.toLowerCase()));
  const klassLabel = { rx: 'Rx', controlled: 'Controlled', otc: 'OTC', special: 'Special' };
  return (
    <Card asArticle>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <SectionHeader title="Prescription" hint="Sent to the patient — they present it at any pharmacy" />
        <Button size="sm" variant={open ? 'secondary' : 'primary'} icon={open ? 'x' : 'plus'} onClick={() => setOpen(o => !o)}>{open ? 'Close' : 'Add drug'}</Button>
      </div>
      {open && (
        <div style={{ marginTop: 'var(--space-300)' }}>
          <div style={{ position: 'relative', marginBottom: 8 }}>
            <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }}><Icon name="search" size={16} /></span>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the drug catalog…" autoFocus
              style={{ width: '100%', padding: '10px 12px 10px 36px', fontSize: 'var(--fs-md)', border: '1px solid var(--border-control)', borderRadius: 'var(--radius-md)', color: 'var(--text-strong)' }} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 6, maxHeight: 168, overflowY: 'auto' }}>
            {matches.map((d) => {
              const allergy = PATIENT.allergies.some((a) => a.name === d.interacts);
              const added = items.some((x) => x.sku === d.sku);
              return (
                <button key={d.sku} onClick={() => onAdd(d)} disabled={added} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, padding: '10px 12px', textAlign: 'left', minWidth: 0, border: `1px solid ${allergy ? 'var(--danger-300)' : 'var(--border-subtle)'}`, borderRadius: 'var(--radius-md)', background: added ? 'var(--surface-muted)' : (allergy ? 'var(--danger-50)' : 'var(--surface)'), opacity: added ? 0.55 : 1 }}>
                  <span style={{ minWidth: 0, fontSize: 'var(--fs-sm)', fontWeight: 'var(--fw-medium)', color: 'var(--text-strong)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.name}</span>
                  {allergy ? <Badge tone="danger" icon="alert">Allergy</Badge> : (d.klass !== 'otc' && <Badge tone={d.klass === 'controlled' ? 'danger' : 'info'}>{d.klass === 'controlled' ? 'CD' : 'Rx'}</Badge>)}
                </button>
              );
            })}
            {matches.length === 0 && <div style={{ gridColumn: '1/-1', fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)', textAlign: 'center', padding: 'var(--space-300)' }}>No drug matches “{q}”.</div>}
          </div>
        </div>
      )}
      <div style={{ marginTop: items.length ? 'var(--space-300)' : 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.map((d) => {
          const allergy = PATIENT.allergies.some((a) => a.name === d.interacts);
          return (
            <div key={d.sku} style={{ padding: '10px 12px', borderRadius: 'var(--radius-md)', background: 'var(--surface-muted)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-300)' }}>
                <Icon name="pill" size={16} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
                <span style={{ flex: 1, fontWeight: 'var(--fw-semibold)', color: 'var(--text-strong)' }}>{d.name}</span>
                {d.klass !== 'otc' && <Badge tone={d.klass === 'controlled' ? 'danger' : 'info'}>{klassLabel[d.klass] || 'Rx'}</Badge>}
                {allergy && <Badge tone="danger" icon="alert">Allergy</Badge>}
                <button onClick={() => onRemove(d.sku)} aria-label={`Remove ${d.name}`} style={{ width: 28, height: 28, border: 'none', background: 'transparent', color: 'var(--text-secondary)', display: 'grid', placeItems: 'center' }}><Icon name="x" size={15} /></button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 8 }}>
                <select value={d.freq || ''} onChange={(e) => onDose(d.sku, 'freq', e.target.value)} style={DOSE_SELECT}>
                  <option value="" disabled>Frequency…</option>
                  {DOSE_FREQ.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
                <select value={d.dur || ''} onChange={(e) => onDose(d.sku, 'dur', e.target.value)} style={DOSE_SELECT}>
                  <option value="" disabled>Duration…</option>
                  {DOSE_DUR.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
              </div>
            </div>
          );
        })}
        {items.some((d) => PATIENT.allergies.some((a) => a.name === d.interacts)) && (
          <div style={{ display: 'flex', gap: 8, padding: 'var(--space-300)', background: 'var(--danger-50)', borderRadius: 'var(--radius-md)', fontSize: 'var(--fs-sm)', color: 'var(--danger-badge-text)' }}>
            <Icon name="alert" size={16} style={{ flexShrink: 0 }} /> This patient has a recorded allergy to one of these drugs. HID flags it — the decision is yours to make and record.
          </div>
        )}
        {items.some((d) => d.klass === 'controlled') && (
          <div style={{ display: 'flex', gap: 8, padding: 'var(--space-300)', background: 'var(--surface-info)', borderRadius: 'var(--radius-md)', fontSize: 'var(--fs-sm)', color: 'var(--text-body)' }}>
            <Icon name="shield" size={16} style={{ flexShrink: 0, color: 'var(--accent)' }} /> Controlled drug — recorded against {CLINICIAN.name} ({CLINICIAN.reg}) at {HOSP_NODE.name}, fully audited.
          </div>
        )}
        {items.length > 0 && (
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6 }}><Icon name="user" size={13} /> Prescriber: {CLINICIAN.name} · {HOSP_NODE.name}</div>
        )}
      </div>
    </Card>
  );
}
const DOSE_SELECT = { width: '100%', padding: '8px 10px', fontSize: 'var(--fs-sm)', border: '1px solid var(--border-control)', borderRadius: 'var(--radius-md)', color: 'var(--text-strong)', background: 'var(--surface)' };

// ---- lab order composer (urgency + notes; feeds the lab queue as a consented order) ----
function LabOrderPanel({ selected, onToggle, urgency, onUrgency, note, onNote }) {
  return (
    <Card asArticle>
      <SectionHeader title="Lab order" hint="Goes to the lab as a consented order" />
      <div style={{ marginTop: 'var(--space-300)', display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 6 }}>
        {LAB_TESTS.map((t) => {
          const on = selected.includes(t.id);
          return (
            <button key={t.id} onClick={() => onToggle(t.id)} aria-pressed={on} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', textAlign: 'left', border: `1.5px solid ${on ? 'var(--accent)' : 'var(--border-subtle)'}`, borderRadius: 'var(--radius-md)', background: on ? 'var(--primary-50)' : 'var(--surface)' }}>
              <span style={{ width: 18, height: 18, borderRadius: 'var(--radius-sm)', flexShrink: 0, border: `2px solid ${on ? 'var(--accent)' : 'var(--border-control)'}`, background: on ? 'var(--accent)' : 'transparent', display: 'grid', placeItems: 'center' }}>{on && <Icon name="check" size={11} strokeWidth={3} style={{ color: 'var(--text-on-accent)' }} />}</span>
              <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 'var(--fw-medium)', color: 'var(--text-strong)' }}>{t.name}</span>
            </button>
          );
        })}
      </div>
      {selected.length > 0 && (
        <div style={{ marginTop: 'var(--space-300)' }}>
          <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 'var(--fw-semibold)', color: 'var(--text-strong)', marginBottom: 6 }}>Urgency</div>
          <div style={{ display: 'flex', gap: 6 }}>
            {LAB_URGENCY.map((u) => {
              const on = urgency === u.id;
              return <button key={u.id} onClick={() => onUrgency(u.id)} aria-pressed={on} style={{ flex: 1, padding: '8px', minHeight: 40, borderRadius: 'var(--radius-md)', border: `1.5px solid ${on ? 'var(--accent)' : 'var(--border-default)'}`, background: on ? 'var(--primary-50)' : 'var(--surface)', color: on ? 'var(--accent-hover)' : 'var(--text-strong)', fontWeight: 'var(--fw-semibold)', fontSize: 'var(--fs-sm)' }}>{u.label}</button>;
            })}
          </div>
          <textarea value={note} onChange={(e) => onNote(e.target.value)} rows={2} placeholder="Clinical notes for the lab (optional)…"
            style={{ width: '100%', marginTop: 8, padding: '10px 12px', fontSize: 'var(--fs-sm)', border: '1px solid var(--border-control)', borderRadius: 'var(--radius-md)', color: 'var(--text-strong)', resize: 'vertical', fontFamily: 'inherit' }} />
        </div>
      )}
    </Card>
  );
}

Object.assign(window, {
  AllergyPanel, MedsPanel, VitalsPanel, ResultsPanel, NotePanel, PrescribePanel, LabOrderPanel,
  ConsultWorkspace, ResultLine,
});

// ============================================================================
//  Consultation workspace — record (under grant) + composers + history link.
//  Shared by the standalone hospital portal AND the enterprise EMR.
// ============================================================================
function ResultLine({ icon, text }) {
  return <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'var(--surface-muted)', borderRadius: 'var(--radius-md)', fontSize: 'var(--fs-sm)', color: 'var(--text-body)', textAlign: 'left' }}><Icon name={icon} size={16} style={{ flexShrink: 0, color: 'var(--text-secondary)' }} /> {text}</div>;
}
function ConsultWorkspace({ expiresAt, onBack, onFinish, onHistory }) {
  const [note, setNote] = useConsult('');
  const [dx, setDx] = useConsult('');
  const [rx, setRx] = useConsult([]);
  const [labs, setLabs] = useConsult([]);
  const [urgency, setUrgency] = useConsult('routine');
  const [labNote, setLabNote] = useConsult('');
  const [saved, setSaved] = useConsult(false);
  function addDrug(d) { setRx((s) => s.find((x) => x.sku === d.sku) ? s : [...s, { ...d }]); }
  function removeDrug(sku) { setRx((s) => s.filter((x) => x.sku !== sku)); }
  function setDose(sku, key, val) { setRx((s) => s.map((x) => x.sku === sku ? { ...x, [key]: val } : x)); }
  function toggleLab(id) { setLabs((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id]); }

  if (saved) {
    return (
      <div style={{ maxWidth: 540, margin: '0 auto', padding: 'var(--space-800) var(--space-500)', textAlign: 'center' }}>
        <div style={{ width: 60, height: 60, borderRadius: 'var(--radius-pill)', background: 'var(--success-50)', color: 'var(--success-600)', display: 'grid', placeItems: 'center', margin: '0 auto var(--space-400)' }}><Icon name="check" size={30} strokeWidth={2.4} /></div>
        <h2 style={{ fontSize: 'var(--fs-h-sm)', fontWeight: 'var(--fw-bold)', color: 'var(--text-heading)' }}>Consultation saved</h2>
        <div style={{ fontSize: 'var(--fs-md)', color: 'var(--text-secondary)', marginTop: 8 }}>{PATIENT.name}'s record has been updated.</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-200)', maxWidth: 360, margin: 'var(--space-500) auto 0' }}>
          {rx.length > 0 && <ResultLine icon="pill" text={`Prescription sent — ${rx.length} item${rx.length > 1 ? 's' : ''}. Patient presents it at any pharmacy.`} />}
          {labs.length > 0 && <ResultLine icon="flask" text={`${labs.length} lab test${labs.length > 1 ? 's' : ''} ordered (${urgency}) — sent to the lab queue.`} />}
          <ResultLine icon="bell" text="Patient timeline updated and notified." />
          <ResultLine icon="history" text="Your actions are recorded in the activity log." />
        </div>
        <Button variant="primary" icon="home" onClick={onFinish} style={{ marginTop: 'var(--space-500)' }}>Back to dashboard</Button>
      </div>
    );
  }
  return (
    <div>
      <PatientHeader expiresAt={expiresAt} />
      <div style={{ maxWidth: 1080, margin: '0 auto', padding: 'var(--space-500) 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-300)', marginBottom: 'var(--space-400)' }}>
          <button onClick={onBack} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: 'var(--fs-sm)', fontWeight: 'var(--fw-semibold)' }}><Icon name="arrowLeft" size={16} /> Back</button>
          <Button variant="secondary" size="sm" icon="history" onClick={onHistory}>View clinical history</Button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.2fr)', gap: 'var(--space-400)', alignItems: 'start' }} className="hosp-cols emr-cols">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-300)' }}>
            <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 'var(--fw-semibold)', color: 'var(--text-secondary)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>Patient record</div>
            <AllergyPanel /><VitalsPanel /><MedsPanel /><ResultsPanel />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-300)' }}>
            <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 'var(--fw-semibold)', color: 'var(--text-secondary)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>This visit</div>
            <NotePanel note={note} onNote={setNote} dx={dx} onDx={setDx} />
            <PrescribePanel items={rx} onAdd={addDrug} onRemove={removeDrug} onDose={setDose} />
            <LabOrderPanel selected={labs} onToggle={toggleLab} urgency={urgency} onUrgency={setUrgency} note={labNote} onNote={setLabNote} />
            <Button variant="primary" size="lg" icon="check" onClick={() => setSaved(true)}>Save consultation</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
