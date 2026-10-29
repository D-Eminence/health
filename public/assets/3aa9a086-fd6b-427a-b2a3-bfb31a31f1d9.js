// hospital-history-audit.jsx — patient history (audited) + staff activity/audit log (§4.3)
const { useState: useHA } = React;

// ============================================================================
//  Patient history — unified clinical timeline. Visible ONLY under an active
//  grant; opening it is itself an audited view event. [§4.3 patient history, D2]
// ============================================================================
const HIST_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'visit', label: 'Visits' },
  { id: 'rx', label: 'Prescriptions' },
  { id: 'lab', label: 'Labs' },
  { id: 'vaccine', label: 'Vaccines' },
];

function PatientHistory({ expiresAt, onBack }) {
  const [f, setF] = useHA('all');
  const rows = HISTORY.filter((h) => f === 'all' || h.kind === f);
  return (
    <div>
      <PatientHeader expiresAt={expiresAt} />
      <div style={{ maxWidth: 760, margin: '0 auto', padding: 'var(--space-500)' }}>
        <button onClick={onBack} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: 'var(--fs-sm)', fontWeight: 'var(--fw-semibold)', marginBottom: 'var(--space-400)' }}><Icon name="arrowLeft" size={16} /> Back to consultation</button>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-300)', flexWrap: 'wrap', marginBottom: 'var(--space-400)' }}>
          <h1 style={{ fontSize: 'var(--fs-h-sm)', fontWeight: 'var(--fw-bold)', color: 'var(--text-heading)' }}>Clinical history</h1>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-secondary)' }}><Icon name="eye" size={13} /> This view is recorded in the audit log.</span>
        </div>

        {/* filters */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 'var(--space-400)' }}>
          {HIST_FILTERS.map((flt) => {
            const on = f === flt.id;
            return <button key={flt.id} onClick={() => setF(flt.id)} aria-pressed={on} style={{ padding: '6px 14px', minHeight: 36, borderRadius: 'var(--radius-pill)', border: `1px solid ${on ? 'var(--accent)' : 'var(--border-default)'}`, background: on ? 'var(--accent)' : 'var(--surface)', color: on ? 'var(--text-on-accent)' : 'var(--text-strong)', fontWeight: 'var(--fw-semibold)', fontSize: 'var(--fs-sm)' }}>{flt.label}</button>;
          })}
        </div>

        {/* timeline */}
        {rows.length === 0 ? <EmptyState icon="history" title="Nothing here yet" body="No events of this type on file." /> : (
          <div style={{ position: 'relative', paddingLeft: 28 }}>
            <div aria-hidden="true" style={{ position: 'absolute', left: 11, top: 8, bottom: 8, width: 2, background: 'var(--border-default)' }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-300)' }}>
              {rows.map((h) => (
                <div key={h.id} style={{ position: 'relative' }}>
                  <div aria-hidden="true" style={{ position: 'absolute', left: -28, top: 4, width: 24, height: 24, borderRadius: 'var(--radius-pill)', background: 'var(--surface)', border: '2px solid var(--border-default)', color: 'var(--text-secondary)', display: 'grid', placeItems: 'center' }}><Icon name={h.icon} size={13} /></div>
                  <Card asArticle padding="var(--space-300) var(--space-400)">
                    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                      <span style={{ fontSize: 'var(--fs-md)', fontWeight: 'var(--fw-semibold)', color: 'var(--text-strong)' }}>{h.title}</span>
                      <span style={{ fontSize: 11, color: 'var(--text-secondary)', flexShrink: 0 }}>{h.when}</span>
                    </div>
                    <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-body)', marginTop: 4, lineHeight: 1.45 }}>{h.detail}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                      <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{h.node} · {h.who}</span>
                      {h.flag === 'high' && <Badge tone="warning">High</Badge>}
                      {h.flag === 'low' && <Badge tone="warning">Low</Badge>}
                    </div>
                  </Card>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
//  Activity / audit log — read-only staff action trail. Surfaces break-glass,
//  consent grants/denials, prescriptions, lab orders. [§4.3 activity log, D4]
// ============================================================================
const AUDIT_FILTERS = [
  { id: 'all', label: 'All activity' },
  { id: 'break_glass', label: 'Break-glass' },
  { id: 'access', label: 'Access' },
  { id: 'rx', label: 'Prescriptions' },
  { id: 'lab', label: 'Lab orders' },
];

function ActivityLog() {
  const [f, setF] = useHA('all');
  const rows = AUDIT.filter((a) => f === 'all' || a.kind === f);
  const toneBg = { danger: 'var(--danger-50)', success: 'var(--success-50)', info: 'var(--surface-info)', gray: 'var(--surface-muted)' };
  const toneFg = { danger: 'var(--danger-500)', success: 'var(--success-600)', info: 'var(--accent)', gray: 'var(--text-secondary)' };
  return (
    <div style={{ maxWidth: 860, margin: '0 auto', padding: 'var(--space-600) var(--space-500)' }}>
      <h1 style={{ fontSize: 'var(--fs-h-md)', fontWeight: 'var(--fw-bold)', color: 'var(--text-heading)' }}>Activity log</h1>
      <p style={{ fontSize: 'var(--fs-md)', color: 'var(--text-secondary)', marginTop: 4 }}>A read-only record of your clinical actions. Break-glass events are reviewed by an administrator.</p>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: 'var(--space-500) 0 var(--space-400)' }}>
        {AUDIT_FILTERS.map((flt) => {
          const on = f === flt.id;
          return <button key={flt.id} onClick={() => setF(flt.id)} aria-pressed={on} style={{ padding: '6px 14px', minHeight: 36, borderRadius: 'var(--radius-pill)', border: `1px solid ${on ? 'var(--accent)' : 'var(--border-default)'}`, background: on ? 'var(--accent)' : 'var(--surface)', color: on ? 'var(--text-on-accent)' : 'var(--text-strong)', fontWeight: 'var(--fw-semibold)', fontSize: 'var(--fs-sm)' }}>{flt.label}</button>;
        })}
      </div>

      {rows.length === 0 ? <EmptyState icon="history" title="No matching activity" /> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-200)' }}>
          {rows.map((a) => (
            <Card key={a.id} asArticle padding="var(--space-300) var(--space-400)" style={a.kind === 'break_glass' ? { borderColor: 'var(--danger-300)' } : undefined}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-300)' }}>
                <div style={{ width: 36, height: 36, borderRadius: 'var(--radius-pill)', background: toneBg[a.tone], color: toneFg[a.tone], display: 'grid', placeItems: 'center', flexShrink: 0 }}><Icon name={a.icon} size={17} /></div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ fontSize: 'var(--fs-md)', fontWeight: 'var(--fw-semibold)', color: 'var(--text-strong)' }}>{a.action}</span>
                    <span style={{ fontSize: 11, color: 'var(--text-secondary)', flexShrink: 0 }}>{a.when}</span>
                  </div>
                  <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-body)', marginTop: 2 }}>{a.target}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
                    <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{a.reason}</span>
                    {a.dur && <Badge tone={a.kind === 'break_glass' ? 'danger' : 'gray'}>{a.dur}</Badge>}
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

Object.assign(window, { PatientHistory, ActivityLog });
