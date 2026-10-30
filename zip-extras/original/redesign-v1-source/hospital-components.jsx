// hospital-components.jsx — Hospital clinical workflow building blocks
const { useState: useHospState, useEffect: useHospFx } = React;

// ============================================================================
//  Top bar
// ============================================================================
function HospTopBar({ emergency }) {
  return (
    <header style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: 'var(--space-300) var(--space-500)', background: 'var(--surface)', borderBottom: '1px solid var(--border-default)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-300)' }}>
        <div aria-hidden="true" style={{ width: 34, height: 34, borderRadius: 'var(--radius-md)', background: 'var(--primary-500)', color: 'var(--text-on-accent)', display: 'grid', placeItems: 'center', fontWeight: 'var(--fw-bold)', fontSize: 13 }}>Health ID</div>
        <div>
          <div style={{ fontSize: 'var(--fs-md)', fontWeight: 'var(--fw-semibold)', color: 'var(--text-strong)', lineHeight: 1.1 }}>{HOSP_NODE.name}</div>
          <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)' }}>{HOSP_NODE.dept}</div>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 10px 4px 4px', background: 'var(--neutral-50)', borderRadius: 'var(--radius-pill)' }}>
        <div style={{ width: 28, height: 28, borderRadius: 'var(--radius-pill)', background: 'var(--primary-500)', color: 'var(--text-on-accent)', display: 'grid', placeItems: 'center', fontWeight: 'var(--fw-bold)', fontSize: 12 }}>AE</div>
        <div style={{ lineHeight: 1.15 }}>
          <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 'var(--fw-semibold)', color: 'var(--text-strong)' }}>{CLINICIAN.name}</div>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{CLINICIAN.role} · {CLINICIAN.reg}</div>
        </div>
      </div>
    </header>
  );
}

// ============================================================================
//  Access gate — find patient. Typing an Health ID does NOT reveal data (D2); it
//  initiates a consent request. Break-glass is the separate emergency door (D3).
// ============================================================================
function AccessGate({ onRequest, onBreakGlass }) {
  const [hid, setHid] = useHospState('HID-71-2204');
  return (
    <div style={{ maxWidth: 560, margin: '0 auto', padding: 'var(--space-1000) var(--space-500)' }}>
      <div style={{ textAlign: 'center', marginBottom: 'var(--space-600)' }}>
        <div style={{ width: 56, height: 56, borderRadius: 'var(--radius-pill)', background: 'var(--primary-50)', color: 'var(--accent-hover)', display: 'grid', placeItems: 'center', margin: '0 auto var(--space-400)' }}><Icon name="lock" size={26} /></div>
        <div style={{ fontSize: 'var(--fs-h-sm)', fontWeight: 'var(--fw-bold)', color: 'var(--text-heading)' }}>Open a patient record</div>
        <div style={{ fontSize: 'var(--fs-md)', color: 'var(--text-secondary)', marginTop: 8, lineHeight: 1.45 }}>
          You can't browse records. Enter the patient's Health ID and ask them to approve — nothing shows until they do.
        </div>
      </div>
      <Card>
        <label style={{ fontSize: 'var(--fs-sm)', fontWeight: 'var(--fw-semibold)', color: 'var(--text-strong)' }}>Patient Health ID number</label>
        <input value={hid} onChange={(e) => setHid(e.target.value)} placeholder="HID-00-0000"
          style={{ width: '100%', marginTop: 8, padding: '12px 14px', fontSize: 'var(--fs-md)', border: '1px solid var(--border-control)', borderRadius: 'var(--radius-md)', color: 'var(--text-strong)' }} />
        <Button variant="primary" size="lg" fullWidth icon="share" onClick={() => onRequest(hid)} style={{ marginTop: 'var(--space-400)' }}>
          Request access
        </Button>
        <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)', textAlign: 'center', marginTop: 10 }}>
          The patient approves on their phone or with their PIN.
        </div>
      </Card>

      <div style={{ marginTop: 'var(--space-600)', padding: 'var(--space-400)', border: '1px solid var(--danger-300)', borderRadius: 'var(--radius-lg)', background: 'var(--surface)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--danger-badge-text)', fontWeight: 'var(--fw-semibold)' }}>
          <Icon name="alert" size={18} strokeWidth={2.2} /> Emergency: patient can't consent?
        </div>
        <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)', marginTop: 6, lineHeight: 1.45 }}>
          If the patient is unconscious or incapacitated, you can break the glass. It's logged, time-limited, and reviewed — use it only in a real emergency.
        </div>
        <Button variant="outline" size="sm" icon="alert" onClick={onBreakGlass} style={{ marginTop: 'var(--space-300)', color: 'var(--danger-500)', borderColor: 'var(--danger-300)' }}>
          Break the glass
        </Button>
      </div>
    </div>
  );
}

// ---- awaiting consent (door 1 pending) ----
function AwaitingConsent({ hid, onApproved, onCancel }) {
  return (
    <div style={{ maxWidth: 480, margin: '0 auto', padding: 'var(--space-1000) var(--space-500)', textAlign: 'center' }}>
      <Spinner size={32} color="var(--accent)" />
      <div style={{ fontSize: 'var(--fs-lg)', fontWeight: 'var(--fw-bold)', color: 'var(--text-heading)', marginTop: 'var(--space-400)' }}>Waiting for the patient</div>
      <div style={{ fontSize: 'var(--fs-md)', color: 'var(--text-secondary)', marginTop: 8, lineHeight: 1.45 }}>
        We've asked <strong style={{ color: 'var(--text-strong)' }}>{hid}</strong> to approve. Their record stays hidden until they tap approve or enter their PIN.
      </div>
      <div style={{ display: 'flex', gap: 'var(--space-200)', justifyContent: 'center', marginTop: 'var(--space-500)' }}>
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        <button onClick={onApproved} style={{ padding: '8px 14px', borderRadius: 'var(--radius-md)', border: '1px dashed var(--border-default)', background: 'var(--neutral-50)', color: 'var(--text-secondary)', fontSize: 'var(--fs-sm)' }}>▶ Simulate: patient approves</button>
      </div>
    </div>
  );
}

// ============================================================================
//  Break-glass modal — the mandatory four-part contract (D3). Cannot proceed
//  without a stated reason; the guarantees are shown verbatim.
// ============================================================================
function BreakGlassModal({ open, onClose, onConfirm }) {
  const [reason, setReason] = useHospState(null);
  const [note, setNote] = useHospState('');
  useHospFx(() => { if (open) { setReason(null); setNote(''); } }, [open]);
  if (!open) return null;
  return (
    <div onClick={onClose} style={{ position: 'absolute', inset: 0, zIndex: 'var(--z-overlay)', background: 'rgba(93,0,18,0.45)', display: 'grid', placeItems: 'center', padding: 'var(--space-500)' }}>
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Break the glass"
        style={{ width: '100%', maxWidth: 520, background: 'var(--surface)', borderRadius: 'var(--radius-2xl)', overflow: 'hidden', boxShadow: 'var(--shadow-lg)', border: '1.5px solid var(--danger-300)' }}>
        <div style={{ padding: 'var(--space-400) var(--space-500)', background: 'var(--danger-50)', borderBottom: '1px solid var(--danger-300)', display: 'flex', alignItems: 'center', gap: 'var(--space-300)' }}>
          <div style={{ width: 40, height: 40, borderRadius: 'var(--radius-pill)', background: 'var(--danger-500)', color: 'var(--text-on-accent)', display: 'grid', placeItems: 'center', flexShrink: 0 }}><Icon name="alert" size={22} strokeWidth={2.4} /></div>
          <div>
            <div style={{ fontSize: 'var(--fs-lg)', fontWeight: 'var(--fw-bold)', color: 'var(--danger-badge-text)' }}>Break the glass</div>
            <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-body)' }}>Emergency access without the patient's consent</div>
          </div>
        </div>
        <div style={{ padding: 'var(--space-500)' }}>
          <div style={{ fontSize: 'var(--fs-md)', fontWeight: 'var(--fw-semibold)', color: 'var(--text-strong)', marginBottom: 'var(--space-300)' }}>Why are you breaking the glass?</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-200)' }}>
            {BG_REASONS.map((r) => {
              const on = reason === r;
              return <button key={r} onClick={() => setReason(r)} aria-pressed={on} style={{
                display: 'flex', alignItems: 'center', gap: 'var(--space-300)', padding: '12px var(--space-300)', minHeight: 48, borderRadius: 'var(--radius-md)',
                border: `1.5px solid ${on ? 'var(--danger-500)' : 'var(--border-default)'}`, background: on ? 'var(--danger-50)' : 'var(--surface)',
                color: 'var(--text-strong)', fontSize: 'var(--fs-md)', fontWeight: 'var(--fw-medium)', textAlign: 'left',
              }}>
                <span style={{ width: 18, height: 18, borderRadius: 'var(--radius-pill)', flexShrink: 0, border: `2px solid ${on ? 'var(--danger-500)' : 'var(--border-control)'}`, background: on ? 'var(--danger-500)' : 'transparent', display: 'grid', placeItems: 'center' }}>{on && <Icon name="check" size={11} strokeWidth={3} style={{ color: 'var(--text-on-accent)' }} />}</span>
                {r}
              </button>;
            })}
          </div>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add any detail (optional)…" rows={2}
            style={{ width: '100%', marginTop: 'var(--space-300)', padding: '10px 12px', fontSize: 'var(--fs-md)', border: '1px solid var(--border-control)', borderRadius: 'var(--radius-md)', color: 'var(--text-strong)', resize: 'none', fontFamily: 'inherit' }} />

          <div style={{ marginTop: 'var(--space-400)', padding: 'var(--space-400)', background: 'var(--surface-muted)', borderRadius: 'var(--radius-lg)' }}>
            <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 'var(--fw-semibold)', color: 'var(--text-strong)', marginBottom: 'var(--space-300)' }}>By continuing, you accept that:</div>
            <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10, padding: 0, margin: 0 }}>
              {BG_CONTRACT.map((c) => (
                <li key={c.text} style={{ display: 'flex', gap: 10, fontSize: 'var(--fs-sm)', color: 'var(--text-body)', lineHeight: 1.4 }}>
                  <span style={{ color: 'var(--danger-500)', flexShrink: 0, marginTop: 1 }}><Icon name={c.icon} size={16} /></span>{c.text}
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div style={{ padding: '0 var(--space-500) var(--space-500)', display: 'flex', gap: 'var(--space-200)' }}>
          <Button variant="secondary" size="lg" onClick={onClose} style={{ flex: 1 }}>Cancel</Button>
          <Button variant="danger" size="lg" icon="alert" onClick={() => onConfirm(reason, note)} style={{ flex: 1.5, opacity: reason ? 1 : 0.5, pointerEvents: reason ? 'auto' : 'none' }}>
            Break the glass
          </Button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
//  Patient header — access status (grant countdown OR emergency banner)
// ============================================================================
function useTick(active) {
  const [, set] = useHospState(0);
  useHospFx(() => { if (!active) return; const id = setInterval(() => set((n) => n + 1), 1000); return () => clearInterval(id); }, [active]);
}
function fmt(secs) { const m = Math.floor(secs / 60); const s = secs % 60; return `${m}:${String(s).padStart(2, '0')}`; }

function PatientHeader({ emergency, expiresAt }) {
  useTick(true);
  const left = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
  return (
    <div>
      {emergency && (
        <div role="alert" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-300)', padding: 'var(--space-300) var(--space-500)', background: 'var(--danger-500)', color: 'var(--text-on-accent)' }}>
          <Icon name="alert" size={18} strokeWidth={2.4} />
          <span style={{ fontWeight: 'var(--fw-bold)', letterSpacing: '0.02em' }}>EMERGENCY ACCESS</span>
          <span style={{ opacity: 0.92, fontSize: 'var(--fs-sm)' }}>· Patient notified · Everything you open is logged · Expires in {fmt(left)}</span>
          <button style={{ marginLeft: 'auto', background: 'rgba(255,255,255,0.16)', border: 'none', color: 'var(--text-on-accent)', padding: '4px 10px', borderRadius: 'var(--radius-md)', fontSize: 'var(--fs-sm)', fontWeight: 'var(--fw-semibold)' }}>View access log</button>
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-400)', padding: 'var(--space-400) var(--space-500)', background: 'var(--surface)', borderBottom: '1px solid var(--border-default)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-400)' }}>
          <div style={{ width: 48, height: 48, borderRadius: 'var(--radius-pill)', background: emergency ? 'var(--danger-50)' : 'var(--primary-50)', color: emergency ? 'var(--danger-500)' : 'var(--accent-hover)', display: 'grid', placeItems: 'center', fontWeight: 'var(--fw-bold)', fontSize: 16 }}>NB</div>
          <div>
            <div style={{ fontSize: 'var(--fs-lg)', fontWeight: 'var(--fw-bold)', color: 'var(--text-heading)' }}>{PATIENT.name}</div>
            <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)' }}>{PATIENT.age} · {PATIENT.sex} · {PATIENT.hid}</div>
          </div>
        </div>
        {!emergency && (
          <Badge tone="success" icon="shield">Consented · {fmt(left)} left</Badge>
        )}
      </div>
    </div>
  );
}

Object.assign(window, {
  HospTopBar, AccessGate, AwaitingConsent, BreakGlassModal, PatientHeader,
});
