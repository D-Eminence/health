// hospital-auth.jsx — staff auth: login → MFA → institution selector (§4.3)
// UX only; backend enforces identity/MFA/membership (DECISIONS §10). Online-required.
const { useState: useAuth, useRef: useAuthRef, useEffect: useAuthFx } = React;

function AuthShell({ children }) {
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--surface-muted)', padding: 'var(--space-500)' }}>
      <div style={{ width: '100%', maxWidth: 420 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-300)', justifyContent: 'center', marginBottom: 'var(--space-500)' }}>
          <div style={{ width: 40, height: 40, borderRadius: 'var(--radius-md)', background: 'var(--accent)', color: 'var(--text-on-accent)', display: 'grid', placeItems: 'center', fontWeight: 'var(--fw-bold)', fontSize: 14 }}>Health ID</div>
          <div style={{ fontSize: 'var(--fs-lg)', fontWeight: 'var(--fw-bold)', color: 'var(--text-heading)' }}>Clinical Portal</div>
        </div>
        {children}
      </div>
    </div>
  );
}

// ---- step 1: credentials ----
function HospLogin({ onNext }) {
  const [email, setEmail] = useAuth('a.eze@livingword.hosp.ng');
  const [pw, setPw] = useAuth('••••••••');
  return (
    <AuthShell>
      <Card padding="var(--space-600)">
        <h1 style={{ fontSize: 'var(--fs-h-sm)', fontWeight: 'var(--fw-bold)', color: 'var(--text-heading)', textAlign: 'center' }}>Staff sign in</h1>
        <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)', textAlign: 'center', marginTop: 6 }}>Use your registered clinical credentials.</p>
        <form onSubmit={(e) => { e.preventDefault(); onNext(); }} style={{ marginTop: 'var(--space-500)', display: 'flex', flexDirection: 'column', gap: 'var(--space-400)' }}>
          <AuthField label="Work email"><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} style={AUTH_INPUT} /></AuthField>
          <AuthField label="Password"><input type="password" value={pw} onChange={(e) => setPw(e.target.value)} style={AUTH_INPUT} /></AuthField>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 'var(--space-300)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', background: 'var(--surface-muted)' }}>
            <span style={{ width: 18, height: 18, borderRadius: 'var(--radius-sm)', background: 'var(--success-500)', display: 'grid', placeItems: 'center', flexShrink: 0 }}><Icon name="check" size={12} strokeWidth={3} style={{ color: '#fff' }} /></span>
            <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-body)' }}>Verified human · Cloudflare Turnstile</span>
          </div>
          <Button variant="primary" size="lg" fullWidth type="submit" onClick={onNext}>Continue</Button>
        </form>
        <div style={{ textAlign: 'center', marginTop: 'var(--space-400)' }}><a href="#" onClick={(e) => e.preventDefault()} style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-link)', fontWeight: 'var(--fw-semibold)' }}>Forgot password?</a></div>
      </Card>
      <p style={{ fontSize: 11, color: 'var(--text-secondary)', textAlign: 'center', marginTop: 'var(--space-400)' }}>Need connection — sign-in, MFA and consent are online-only (D15).</p>
    </AuthShell>
  );
}

// ---- step 2: MFA ----
function HospMFA({ onBack, onNext }) {
  const [code, setCode] = useAuth(['', '', '', '', '', '']);
  const refs = useAuthRef([]);
  const full = code.every((c) => c !== '');
  function setDigit(i, v) {
    if (!/^\d?$/.test(v)) return;
    const next = [...code]; next[i] = v; setCode(next);
    if (v && i < 5) refs.current[i + 1]?.focus();
  }
  function onKey(i, e) { if (e.key === 'Backspace' && !code[i] && i > 0) refs.current[i - 1]?.focus(); }
  useAuthFx(() => { refs.current[0]?.focus(); }, []);
  return (
    <AuthShell>
      <Card padding="var(--space-600)">
        <div style={{ width: 48, height: 48, borderRadius: 'var(--radius-pill)', background: 'var(--primary-50)', color: 'var(--accent-hover)', display: 'grid', placeItems: 'center', margin: '0 auto var(--space-400)' }}><Icon name="shield" size={24} /></div>
        <h1 style={{ fontSize: 'var(--fs-h-sm)', fontWeight: 'var(--fw-bold)', color: 'var(--text-heading)', textAlign: 'center' }}>Two-factor check</h1>
        <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)', textAlign: 'center', marginTop: 6 }}>Enter the 6-digit code from your authenticator app.</p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 'var(--space-500)' }}>
          {code.map((d, i) => (
            <input key={i} ref={(el) => (refs.current[i] = el)} value={d} onChange={(e) => setDigit(i, e.target.value)} onKeyDown={(e) => onKey(i, e)}
              inputMode="numeric" maxLength={1} aria-label={`Digit ${i + 1}`}
              style={{ width: 48, height: 56, textAlign: 'center', fontSize: 'var(--fs-h-sm)', fontWeight: 'var(--fw-bold)', border: `1.5px solid ${d ? 'var(--accent)' : 'var(--border-control)'}`, borderRadius: 'var(--radius-md)', color: 'var(--text-strong)' }} />
          ))}
        </div>
        <Button variant="primary" size="lg" fullWidth onClick={onNext} disabled={!full} style={{ marginTop: 'var(--space-500)', opacity: full ? 1 : 0.5, pointerEvents: full ? 'auto' : 'none' }}>Verify</Button>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 'var(--space-400)' }}>
          <button onClick={onBack} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: 'var(--fs-sm)', fontWeight: 'var(--fw-semibold)' }}>Back</button>
          <button onClick={() => {}} style={{ background: 'none', border: 'none', color: 'var(--text-link)', fontSize: 'var(--fs-sm)', fontWeight: 'var(--fw-semibold)' }}>Resend code</button>
        </div>
      </Card>
    </AuthShell>
  );
}

// ---- step 3: institution selector (multi-membership) ----
function InstitutionSelector({ onPick }) {
  return (
    <AuthShell>
      <Card padding="var(--space-600)">
        <h1 style={{ fontSize: 'var(--fs-h-sm)', fontWeight: 'var(--fw-bold)', color: 'var(--text-heading)', textAlign: 'center' }}>Where are you working today?</h1>
        <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)', textAlign: 'center', marginTop: 6 }}>Your choice scopes everything you do this session.</p>
        <div style={{ marginTop: 'var(--space-500)', display: 'flex', flexDirection: 'column', gap: 'var(--space-200)' }}>
          {INSTITUTIONS.map((inst) => (
            <button key={inst.id} onClick={() => onPick(inst)} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-300)', padding: 'var(--space-400)', textAlign: 'left', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-lg)', background: 'var(--surface)' }}>
              <div style={{ width: 40, height: 40, borderRadius: 'var(--radius-md)', background: 'var(--primary-50)', color: 'var(--accent-hover)', display: 'grid', placeItems: 'center', flexShrink: 0 }}><Icon name={inst.type === 'CLINIC' ? 'home' : 'stethoscope'} size={20} /></div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 'var(--fs-md)', fontWeight: 'var(--fw-semibold)', color: 'var(--text-strong)' }}>{inst.name}</div>
                <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)' }}>{inst.dept} · {inst.role} · {inst.city}</div>
              </div>
              <Icon name="chevron" size={18} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
            </button>
          ))}
        </div>
      </Card>
    </AuthShell>
  );
}

const AUTH_INPUT = { width: '100%', padding: '12px 14px', fontSize: 'var(--fs-md)', border: '1px solid var(--border-control)', borderRadius: 'var(--radius-md)', color: 'var(--text-strong)', background: 'var(--surface)' };
function AuthField({ label, children }) {
  return <label style={{ display: 'block' }}><span style={{ display: 'block', fontSize: 'var(--fs-sm)', fontWeight: 'var(--fw-semibold)', color: 'var(--text-strong)', marginBottom: 6 }}>{label}</span>{children}</label>;
}

Object.assign(window, { HospLogin, HospMFA, InstitutionSelector });
