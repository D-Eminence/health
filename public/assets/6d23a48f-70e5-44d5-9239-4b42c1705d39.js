// emr-auth.jsx — HID EMR authentication, rebuilt to match the real HID design:
// split-screen (form left · image right), brand blue, real logo, simple email+password,
// Forgotten Password → Reset (Send OTP). No 6-digit-box / institution-picker screens.
const { useState: useAuthX } = React;

const AUTH_INPUT_X = {
  width: '100%', padding: '13px 14px 13px 42px', fontSize: 'var(--fs-md)',
  border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)',
  color: 'var(--text-strong)', background: 'var(--surface)',
};

function AuthFooter() {
  return (
    <div style={{ display: 'flex', gap: 'var(--space-600)', flexWrap: 'wrap' }}>
      {['HIPAA + NDPR compliant', 'Secure OTP verification'].map((t) => (
        <span key={t} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)' }}>
          <span style={{ width: 18, height: 18, borderRadius: 'var(--radius-sm)', border: '1.5px solid var(--accent)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
            <Icon name="check" size={12} strokeWidth={3} style={{ color: 'var(--accent)' }} />
          </span>{t}
        </span>
      ))}
    </div>
  );
}

function Logo({ height = 30 }) {
  return <img src={(window.__resources && window.__resources.hidLogo) || 'assets/hid-logo.png'} alt="HID — Health Identity Directory" style={{ height, width: 'auto', display: 'block', alignSelf: 'flex-start', flexShrink: 0, objectFit: 'contain' }} />;
}

// shared split shell: left form column, right visual column
function SplitShell({ children, right }) {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--surface-muted)', display: 'grid', placeItems: 'center', padding: 'var(--space-600)' }}>
      <div style={{ width: '100%', maxWidth: 1160, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-600)', alignItems: 'stretch' }} className="auth-split">
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-2xl)', padding: 'var(--space-800)', display: 'flex', flexDirection: 'column', minHeight: 600 }}>
          {children}
        </div>
        <div className="auth-visual" style={{ borderRadius: 'var(--radius-2xl)', overflow: 'hidden', minHeight: 600, position: 'relative', background: 'linear-gradient(150deg, var(--primary-600), var(--primary-800))' }}>
          {right}
        </div>
      </div>
    </div>
  );
}

// ---- Sign in ----
function EmrLogin({ onNext, onForgot }) {
  const [email, setEmail] = useAuthX('admin@hospital.com');
  const [pw, setPw] = useAuthX('');
  return (
    <SplitShell right={<img src={(window.__resources && window.__resources.loginPhoto) || 'assets/login-photo.png'} alt="Clinician using HID" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />}>
      <Logo />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', maxWidth: 380, width: '100%', margin: '0 auto' }}>
        <h1 style={{ fontSize: 'var(--fs-h-sm)', fontWeight: 'var(--fw-bold)', color: 'var(--text-heading)', textAlign: 'center' }}>Healthcare provider</h1>
        <p style={{ fontSize: 'var(--fs-md)', color: 'var(--text-secondary)', textAlign: 'center', marginTop: 6 }}>Secure access to patient medical records</p>
        <form onSubmit={(e) => { e.preventDefault(); onNext(); }} style={{ marginTop: 'var(--space-600)', display: 'flex', flexDirection: 'column', gap: 'var(--space-300)' }}>
          <div style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }}><Icon name="mail" size={17} /></span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@hospital.com" style={AUTH_INPUT_X} />
          </div>
          <div style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }}><Icon name="lock" size={17} /></span>
            <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Password" style={AUTH_INPUT_X} />
          </div>
          <Button variant="primary" size="lg" fullWidth type="submit" onClick={onNext} style={{ marginTop: 'var(--space-200)' }}>Sign in</Button>
        </form>
        <div style={{ textAlign: 'center', marginTop: 'var(--space-400)', fontSize: 'var(--fs-md)', color: 'var(--text-secondary)' }}>
          Forgotten <button onClick={onForgot} style={{ background: 'none', border: 'none', color: 'var(--text-link)', fontWeight: 'var(--fw-semibold)', fontSize: 'var(--fs-md)', cursor: 'pointer' }}>Password</button>
        </div>
      </div>
      <AuthFooter />
    </SplitShell>
  );
}

// ---- Reset password ----
function EmrForgot({ onBack, onSent }) {
  const [email, setEmail] = useAuthX('');
  return (
    <SplitShell right={
      <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
        <div style={{ width: 200, height: 230, position: 'relative', display: 'grid', placeItems: 'center' }}>
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.14)', borderRadius: '50% 50% 46% 46% / 60% 60% 40% 40%', clipPath: 'polygon(50% 0, 100% 22%, 100% 64%, 50% 100%, 0 64%, 0 22%)' }} />
          <Icon name="lock" size={84} strokeWidth={1.3} style={{ color: '#fff', position: 'relative' }} />
        </div>
      </div>
    }>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--space-400)' }}>
        <Logo />
        <div style={{ textAlign: 'right', fontSize: 'var(--fs-sm)' }}>
          <div style={{ color: 'var(--text-secondary)', fontStyle: 'italic', fontWeight: 'var(--fw-semibold)' }}>Medical Provider?</div>
          <button onClick={onBack} style={{ background: 'none', border: 'none', color: 'var(--text-link)', fontWeight: 'var(--fw-semibold)', textDecoration: 'underline', fontSize: 'var(--fs-sm)', cursor: 'pointer', padding: 0 }}>Register here.</button>
        </div>
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', maxWidth: 380, width: '100%', margin: '0 auto' }}>
        <h1 style={{ fontSize: 'var(--fs-h-sm)', fontWeight: 'var(--fw-bold)', color: 'var(--text-heading)', textAlign: 'center' }}>Reset your password</h1>
        <p style={{ fontSize: 'var(--fs-md)', color: 'var(--text-secondary)', textAlign: 'center', marginTop: 6 }}>Enter the email linked to your Health ID. We'll send you an OTP code</p>
        <form onSubmit={(e) => { e.preventDefault(); onSent(); }} style={{ marginTop: 'var(--space-600)', display: 'flex', flexDirection: 'column', gap: 'var(--space-300)' }}>
          <div style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }}><Icon name="mail" size={17} /></span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email address" style={AUTH_INPUT_X} />
          </div>
          <Button variant="primary" size="lg" fullWidth type="submit" onClick={onSent} style={{ marginTop: 'var(--space-200)' }}>Send OTP</Button>
          <button type="button" onClick={onBack} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: 'var(--fs-sm)', fontWeight: 'var(--fw-semibold)', cursor: 'pointer', marginTop: 4 }}>Back to sign in</button>
        </form>
      </div>
      <AuthFooter />
    </SplitShell>
  );
}

Object.assign(window, { EmrLogin, EmrForgot, AuthLogo: Logo });
