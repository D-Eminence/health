// hospital-dashboard.jsx — operation center + break-glass emergency view
const { useState: useDash } = React;

// ============================================================================
//  Dashboard (operation center) — daily queue, pending results, alerts.
//  Shows ONLY clinic-scheduled info (name + appt reason). No HID records here;
//  opening a patient initiates the consent door. [D2 — UX gate only, backend enforces]
// ============================================================================
function HospDashboard({ onOpenPatient, onFind, onReviewResult }) {
  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', padding: 'var(--space-600) var(--space-500)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 'var(--space-400)', flexWrap: 'wrap', marginBottom: 'var(--space-500)' }}>
        <div>
          <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)', fontWeight: 'var(--fw-semibold)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>{HOSP_NODE.dept}</div>
          <h1 style={{ fontSize: 'var(--fs-h-md)', fontWeight: 'var(--fw-bold)', color: 'var(--text-heading)', marginTop: 2 }}>Good morning, {CLINICIAN.name.split(' ')[1] ? 'Dr. ' + CLINICIAN.name.split(' ')[1] : CLINICIAN.name}</h1>
        </div>
        <Button variant="primary" size="lg" icon="search" onClick={onFind}>Find a patient</Button>
      </div>

      {/* stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 'var(--space-300)', marginBottom: 'var(--space-500)' }}>
        {DASH_STATS.map((s) => (
          <Card key={s.k} padding="var(--space-400)">
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-300)' }}>
              <div style={{ width: 40, height: 40, borderRadius: 'var(--radius-md)', background: 'var(--primary-50)', color: 'var(--accent-hover)', display: 'grid', placeItems: 'center', flexShrink: 0 }}><Icon name={s.icon} size={20} /></div>
              <div>
                <div style={{ fontSize: 'var(--fs-h-sm)', fontWeight: 'var(--fw-bold)', color: 'var(--text-heading)', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{s.value}</div>
                <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)', marginTop: 3 }}>{s.label}</div>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.6fr) minmax(0,1fr)', gap: 'var(--space-400)', alignItems: 'start' }} className="hosp-cols">
        {/* today's queue */}
        <Card asArticle padding="var(--space-500)">
          <SectionHeader title="Today's clinic" hint="Tap a patient to begin — they approve access first" />
          <div style={{ marginTop: 'var(--space-400)', display: 'flex', flexDirection: 'column', gap: 'var(--space-200)' }}>
            {QUEUE.map((q) => {
              const done = q.status === 'done';
              return (
                <button key={q.id} onClick={() => !done && onOpenPatient(q)} disabled={done} style={{
                  display: 'flex', alignItems: 'center', gap: 'var(--space-300)', padding: 'var(--space-300) var(--space-400)', textAlign: 'left',
                  border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', background: done ? 'var(--surface-muted)' : 'var(--surface)',
                  opacity: done ? 0.66 : 1, cursor: done ? 'default' : 'pointer',
                }}>
                  <div style={{ width: 42, height: 42, borderRadius: 'var(--radius-pill)', background: done ? 'var(--neutral-200)' : 'var(--primary-50)', color: done ? 'var(--text-secondary)' : 'var(--accent-hover)', display: 'grid', placeItems: 'center', fontWeight: 'var(--fw-bold)', fontSize: 13, flexShrink: 0 }}>{q.time}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 'var(--fs-md)', fontWeight: 'var(--fw-semibold)', color: 'var(--text-strong)' }}>{q.name}</span>
                      {q.flag && <Badge tone="warning" icon="activity">{q.flag}</Badge>}
                    </div>
                    <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)' }}>{q.reason}</div>
                  </div>
                  {done ? <Badge tone="gray" icon="check">Seen</Badge>
                    : <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 'var(--fs-sm)', fontWeight: 'var(--fw-semibold)', color: 'var(--text-link)' }}>Open <Icon name="chevron" size={15} /></span>}
                </button>
              );
            })}
          </div>
        </Card>

        {/* right rail: alerts + pending results */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-400)' }}>
          <Card asArticle padding="var(--space-500)">
            <SectionHeader title="Needs attention" />
            <div style={{ marginTop: 'var(--space-300)', display: 'flex', flexDirection: 'column', gap: 'var(--space-200)' }}>
              {ALERTS.map((a) => (
                <div key={a.id} style={{ display: 'flex', gap: 10, padding: 'var(--space-300)', borderRadius: 'var(--radius-md)', background: a.tone === 'danger' ? 'var(--danger-50)' : 'var(--surface-info)' }}>
                  <span style={{ color: a.tone === 'danger' ? 'var(--danger-500)' : 'var(--accent)', flexShrink: 0, marginTop: 1 }}><Icon name={a.icon} size={16} /></span>
                  <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-body)', lineHeight: 1.4 }}>{a.text}</span>
                </div>
              ))}
            </div>
          </Card>

          <Card asArticle padding="var(--space-500)">
            <SectionHeader title="Results to review" hint="Open the patient to view in context" />
            <div style={{ marginTop: 'var(--space-300)', display: 'flex', flexDirection: 'column', gap: 'var(--space-200)' }}>
              {PENDING_RESULTS.map((r) => (
                <button key={r.id} onClick={onReviewResult} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-300)', padding: 'var(--space-300)', textAlign: 'left', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', background: 'var(--surface)' }}>
                  <div style={{ width: 34, height: 34, borderRadius: 'var(--radius-md)', background: r.flag ? 'var(--warning-50)' : 'var(--surface-muted)', color: r.flag ? 'var(--warning-600)' : 'var(--text-secondary)', display: 'grid', placeItems: 'center', flexShrink: 0 }}><Icon name="flask" size={17} /></div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 'var(--fw-semibold)', color: 'var(--text-strong)' }}>{r.test}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{r.patient} · {r.when}</div>
                  </div>
                  {r.urgency === 'urgent' && <Badge tone="danger">Urgent</Badge>}
                </button>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
//  Break-glass emergency view (D3/D4) — the unlocked emergency-relevant set.
//  Red frame is licensed ONLY here. Tabs: each opened tab is its own view event
//  (audited). Reason shown on the view; expiry countdown; "patient notified".
// ============================================================================
const BG_TABS = [
  { id: 'overview', label: 'Overview', icon: 'activity' },
  { id: 'medicine', label: 'Medicine', icon: 'pill' },
  { id: 'labs', label: 'Labs', icon: 'flask' },
  { id: 'imaging', label: 'Imaging', icon: 'eye' },
];

function BreakGlassView({ reason, note, expiresAt, viewed, onView, onClose }) {
  const [tab, setTab] = useDash('overview');
  function go(id) { setTab(id); onView(id); }
  return (
    <div>
      <PatientHeader emergency expiresAt={expiresAt} />
      {/* reason banner — shown on the unlocked view per D4 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-300)', padding: 'var(--space-300) var(--space-500)', background: 'var(--danger-50)', borderBottom: '1px solid var(--danger-300)' }}>
        <Icon name="alert" size={16} style={{ color: 'var(--danger-500)', flexShrink: 0 }} />
        <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--danger-badge-text)' }}><strong>Reason:</strong> {reason}{note ? ` — ${note}` : ''}</span>
      </div>

      <div style={{ maxWidth: 920, margin: '0 auto', padding: 'var(--space-500)' }}>
        {/* tabs */}
        <div role="tablist" style={{ display: 'flex', gap: 4, padding: 4, background: 'var(--neutral-100)', borderRadius: 'var(--radius-md)', marginBottom: 'var(--space-400)' }}>
          {BG_TABS.map((tb) => {
            const on = tab === tb.id;
            return (
              <button key={tb.id} role="tab" aria-selected={on} onClick={() => go(tb.id)} style={{
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '10px', minHeight: 44,
                border: 'none', borderRadius: 'var(--radius-sm)', background: on ? 'var(--surface)' : 'transparent',
                color: on ? 'var(--text-strong)' : 'var(--text-secondary)', fontWeight: 'var(--fw-semibold)', fontSize: 'var(--fs-sm)',
                boxShadow: on ? 'var(--shadow-xs)' : 'none',
              }}>
                <Icon name={tb.icon} size={16} />{tb.label}
                {viewed.includes(tb.id) && <span title="Viewed — logged" style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--danger-500)' }} />}
              </button>
            );
          })}
        </div>

        {/* tab body */}
        {tab === 'overview' && <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-300)' }}><AllergyPanel /><VitalsPanel /></div>}
        {tab === 'medicine' && <MedsPanel />}
        {tab === 'labs' && <ResultsPanel />}
        {tab === 'imaging' && <EmptyState icon="eye" title="No imaging on file" body="This patient has no imaging studies recorded." />}

        <div style={{ marginTop: 'var(--space-500)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-300)', flexWrap: 'wrap' }}>
          <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="eye" size={15} /> {viewed.length} of {BG_TABS.length} sections opened — each is recorded.
          </div>
          <Button variant="secondary" icon="logout" onClick={onClose}>End emergency access</Button>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { HospDashboard, BreakGlassView, BG_TABS });
