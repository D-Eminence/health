// primitives.jsx
// Mirrors src/components/ui.tsx (per INTERFACE_CONTRACT — reuse, don't redefine).
// Tokens-only; no raw hex anywhere. WCAG 2.2 AA pairings (see design.md §7).

// ---------- Icon set (inline SVG, currentColor) ----------
const Icon = ({ name, size = 20, strokeWidth = 1.75, style }) => {
  const s = { width: size, height: size, flexShrink: 0, ...style };
  const p = { fill: 'none', stroke: 'currentColor', strokeWidth, strokeLinecap: 'round', strokeLinejoin: 'round' };
  const paths = {
    wifi:        <><path {...p} d="M2 8.5a15 15 0 0 1 20 0"/><path {...p} d="M5 12a10 10 0 0 1 14 0"/><path {...p} d="M8.5 15.5a5 5 0 0 1 7 0"/><circle cx="12" cy="19" r="1" fill="currentColor"/></>,
    'wifi-off':  <><path {...p} d="m2 2 20 20"/><path {...p} d="M8.5 16.5a5 5 0 0 1 6.84-.18"/><path {...p} d="M5 12a10 10 0 0 1 4-2.4"/><path {...p} d="M19 12a10 10 0 0 0-3-2.05"/><path {...p} d="M2 8.5a15 15 0 0 1 6-3.5"/><path {...p} d="M14 4.7a15 15 0 0 1 8 3.8"/><circle cx="12" cy="19" r="1" fill="currentColor"/></>,
    sync:        <><path {...p} d="M21 12a9 9 0 0 1-15.4 6.4L3 16"/><path {...p} d="M3 12a9 9 0 0 1 15.4-6.4L21 8"/><path {...p} d="M21 3v5h-5"/><path {...p} d="M3 21v-5h5"/></>,
    'user-plus': <><circle {...p} cx="9" cy="8" r="4"/><path {...p} d="M2 21a7 7 0 0 1 14 0"/><path {...p} d="M19 8v6M16 11h6"/></>,
    user:        <><circle {...p} cx="12" cy="8" r="4"/><path {...p} d="M4 21a8 8 0 0 1 16 0"/></>,
    stethoscope: <><path {...p} d="M6 3v6a4 4 0 0 0 8 0V3"/><path {...p} d="M6 3h2M12 3h2"/><path {...p} d="M10 13v3a5 5 0 0 0 10 0v-2"/><circle {...p} cx="20" cy="11" r="2"/></>,
    syringe:     <><path {...p} d="m18 2 4 4"/><path {...p} d="m15 5 6 6"/><path {...p} d="m4.5 19.5 2.5-2.5"/><path {...p} d="M18.5 8.5 8 19 5 16 15.5 5.5z"/><path {...p} d="m2 22 2.5-2.5"/></>,
    share:       <><circle {...p} cx="18" cy="5" r="3"/><circle {...p} cx="6" cy="12" r="3"/><circle {...p} cx="18" cy="19" r="3"/><path {...p} d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/></>,
    bell:        <><path {...p} d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path {...p} d="M13.7 21a2 2 0 0 1-3.4 0"/></>,
    mail:        <><rect {...p} x="3" y="5" width="18" height="14" rx="2"/><path {...p} d="m3 7 9 6 9-6"/></>,
    chevron:     <path {...p} d="m9 6 6 6-6 6"/>,
    check:       <path {...p} d="M5 12.5 10 17 19 7"/>,
    alert:       <><path {...p} d="M12 3 1.5 21h21z"/><path {...p} d="M12 10v5"/><circle cx="12" cy="18" r="1" fill="currentColor"/></>,
    x:           <path {...p} d="M6 6 18 18M18 6 6 18"/>,
    clock:       <><circle {...p} cx="12" cy="12" r="9"/><path {...p} d="M12 7v5l3 2"/></>,
    pin:         <><path {...p} d="M12 22s7-7.5 7-13a7 7 0 0 0-14 0c0 5.5 7 13 7 13z"/><circle {...p} cx="12" cy="9" r="2.5"/></>,
    calendar:    <><rect {...p} x="3" y="5" width="18" height="16" rx="2"/><path {...p} d="M3 10h18M8 3v4M16 3v4"/></>,
    dots:        <><circle cx="12" cy="5" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="12" cy="19" r="1.5" fill="currentColor"/></>,
    search:      <><circle {...p} cx="11" cy="11" r="7"/><path {...p} d="m20 20-4-4"/></>,
    home:        <path {...p} d="M3 11 12 3l9 8v9a2 2 0 0 1-2 2h-4v-7H9v7H5a2 2 0 0 1-2-2z"/>,
    map:         <><path {...p} d="M2 6v15l7-3 6 3 7-3V3l-7 3-6-3z"/><path {...p} d="M9 3v15M15 6v15"/></>,
    chart:       <><path {...p} d="M3 3v18h18"/><path {...p} d="m7 14 4-4 3 3 5-6"/></>,
    arrow:       <path {...p} d="M5 12h14M13 6l6 6-6 6"/>,
    plus:        <path {...p} d="M12 5v14M5 12h14"/>,
    cloud:       <><path {...p} d="M7 18a5 5 0 1 1 .7-9.96A6 6 0 0 1 19 11a4 4 0 0 1 0 8z"/></>,
    cloudOff:    <><path {...p} d="M19.6 16.4A4 4 0 0 0 19 11a6 6 0 0 0-7.6-4.4"/><path {...p} d="M7.7 7.7A6 6 0 0 0 7 18h11.3"/><path {...p} d="m2 2 20 20"/></>,
    flag:        <><path {...p} d="M4 21V4h13l-2 4 2 4H4"/></>,
    list:        <><path {...p} d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r="1.2" fill="currentColor"/><circle cx="4" cy="12" r="1.2" fill="currentColor"/><circle cx="4" cy="18" r="1.2" fill="currentColor"/></>,
    merge:       <><path {...p} d="M8 18V10a4 4 0 0 1 4-4 4 4 0 0 1 4 4v8"/><path {...p} d="m5 15 3 3 3-3M13 15l3 3 3-3"/></>,
    eye:         <><path {...p} d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle {...p} cx="12" cy="12" r="3"/></>,
    edit:        <><path {...p} d="M12 20h9"/><path {...p} d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></>,
    shield:      <><path {...p} d="M12 3 5 6v6c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6z"/><path {...p} d="m9 12 2 2 4-4"/></>,
    lock:        <><rect {...p} x="4" y="10" width="16" height="11" rx="2"/><path {...p} d="M8 10V7a4 4 0 0 1 8 0v3"/></>,
    revoke:      <><circle {...p} cx="12" cy="12" r="9"/><path {...p} d="m8 8 8 8"/></>,
    history:     <><path {...p} d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path {...p} d="M3 4v4h4"/><path {...p} d="M12 8v4l3 2"/></>,
    qr:          <><rect {...p} x="3" y="3" width="7" height="7" rx="1"/><rect {...p} x="14" y="3" width="7" height="7" rx="1"/><rect {...p} x="3" y="14" width="7" height="7" rx="1"/><path {...p} d="M14 14h3v3M21 14v7h-7v-3"/></>,
    flask:       <><path {...p} d="M9 3h6M10 3v6l-5.5 9.5A2 2 0 0 0 6.2 21h11.6a2 2 0 0 0 1.7-3.5L14 9V3"/><path {...p} d="M7.5 15h9"/></>,
    droplet:     <path {...p} d="M12 3s6 5.7 6 10a6 6 0 0 1-12 0c0-4.3 6-10 6-10z"/>,
    upload:      <><path {...p} d="M12 16V4M7 9l5-5 5 5"/><path {...p} d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></>,
    file:        <><path {...p} d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path {...p} d="M14 3v5h5"/></>,
    send:        <><path {...p} d="M22 2 11 13"/><path {...p} d="M22 2 15 22l-4-9-9-4z"/></>,
    sparkle:     <><path {...p} d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path {...p} d="M19 15l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z"/></>,
    pill:        <><path {...p} d="M10.5 20.5a4.95 4.95 0 0 1-7-7l6-6a4.95 4.95 0 0 1 7 7l-6 6z"/><path {...p} d="m8.5 8.5 7 7"/></>,
    notes:       <><rect {...p} x="4" y="3" width="16" height="18" rx="2"/><path {...p} d="M8 8h8M8 12h8M8 16h5"/></>,
    activity:    <path {...p} d="M3 12h4l3 8 4-16 3 8h4"/>,
    arrowLeft:   <path {...p} d="M19 12H5M11 18l-6-6 6-6"/>,
    camera:      <><path {...p} d="M3 8a2 2 0 0 1 2-2h2l1.5-2h7L19 6h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2z" transform="translate(0 0)"/><circle {...p} cx="12" cy="13" r="3.5"/></>,
    download:    <><path {...p} d="M12 3v12M7 11l5 5 5-5"/><path {...p} d="M4 19h16"/></>,
    logout:      <><path {...p} d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"/><path {...p} d="M10 16l-4-4 4-4M6 12h11"/></>,
    bed:         <><path {...p} d="M3 7v12M3 13h18a2 2 0 0 1 2 2v4M23 19v-4"/><path {...p} d="M3 13v-2a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v2"/><circle {...p} cx="7.5" cy="11" r="0.5"/></>,
    heart:       <path {...p} d="M12 20s-7-4.5-9.5-9A5 5 0 0 1 12 6a5 5 0 0 1 9.5 5c-2.5 4.5-9.5 9-9.5 9z"/>,
    scissors:    <><circle {...p} cx="6" cy="6" r="3"/><circle {...p} cx="6" cy="18" r="3"/><path {...p} d="M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12"/></>,
    scan:        <><path {...p} d="M4 7V5a1 1 0 0 1 1-1h2M17 4h2a1 1 0 0 1 1 1v2M20 17v2a1 1 0 0 1-1 1h-2M7 20H5a1 1 0 0 1-1-1v-2"/><path {...p} d="M4 12h16"/></>,
    receipt:     <><path {...p} d="M5 3v18l2-1.2 2 1.2 2-1.2 2 1.2 2-1.2 2 1.2V3l-2 1.2L15 3l-2 1.2L11 3 9 4.2 7 3z"/><path {...p} d="M8 8h8M8 12h8"/></>,
    building:    <><rect {...p} x="4" y="3" width="16" height="18" rx="1"/><path {...p} d="M9 7h.01M15 7h.01M9 11h.01M15 11h.01M9 15h.01M15 15h.01M10 21v-3h4v3"/></>,
    users:       <><circle {...p} cx="9" cy="8" r="3.5"/><path {...p} d="M2.5 21a6.5 6.5 0 0 1 13 0"/><path {...p} d="M16 5.5a3.5 3.5 0 0 1 0 6.8M17 14.5a6.5 6.5 0 0 1 4.5 6.5"/></>,
    route:       <><circle {...p} cx="6" cy="19" r="2.5"/><circle {...p} cx="18" cy="5" r="2.5"/><path {...p} d="M8.5 19H14a4 4 0 0 0 0-8H10a4 4 0 0 1 0-8h5.5"/></>,
    box:         <><path {...p} d="M21 8 12 3 3 8v8l9 5 9-5z"/><path {...p} d="m3 8 9 5 9-5M12 13v8"/></>,
    truck:       <><path {...p} d="M2 6h11v10H2zM13 9h4l4 3v4h-8z"/><circle {...p} cx="6.5" cy="18" r="1.8"/><circle {...p} cx="17.5" cy="18" r="1.8"/></>,
    video:       <><rect {...p} x="2" y="6" width="13" height="12" rx="2"/><path {...p} d="m22 8-5 4 5 4z"/></>,
    badge:       <><path {...p} d="M12 2 4 5v6c0 5 3.5 8 8 11 4.5-3 8-6 8-11V5z"/><path {...p} d="m9 12 2 2 4-4"/></>,
    'shield-check': <><path {...p} d="M12 2 4 5v6c0 5 3.5 8 8 11 4.5-3 8-6 8-11V5z"/><path {...p} d="m9 12 2 2 4-4"/></>,
    plug:        <><path {...p} d="M9 2v6M15 2v6M7 8h10v3a5 5 0 0 1-10 0zM12 16v6"/></>,
    cart:        <><circle {...p} cx="9" cy="20" r="1.5"/><circle {...p} cx="18" cy="20" r="1.5"/><path {...p} d="M2 3h2.5l2.2 12.2a1.5 1.5 0 0 0 1.5 1.3h8.4a1.5 1.5 0 0 0 1.5-1.2L21 7H5"/></>,
    tag:         <><path {...p} d="M3 11.5V4a1 1 0 0 1 1-1h7.5a1 1 0 0 1 .7.3l8 8a1 1 0 0 1 0 1.4l-6.5 6.5a1 1 0 0 1-1.4 0l-8-8a1 1 0 0 1-.3-.7z"/><circle cx="7.5" cy="7.5" r="1.3" fill="currentColor"/></>,
    trash:       <><path {...p} d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/></>,
    percent:     <><path {...p} d="M19 5 5 19"/><circle {...p} cx="7.5" cy="7.5" r="2.5"/><circle {...p} cx="16.5" cy="16.5" r="2.5"/></>,
    store:       <><path {...p} d="M3 9 4.5 4h15L21 9M4 9v10a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9M3 9h18"/><path {...p} d="M9 20v-5h6v5"/></>,
    'trend-up':   <><path {...p} d="M3 17 10 10l4 4 7-7"/><path {...p} d="M16 7h5v5"/></>,
    'trend-down': <><path {...p} d="M3 7 10 14l4-4 7 7"/><path {...p} d="M16 17h5v-5"/></>,
  };
  return <svg viewBox="0 0 24 24" style={s} aria-hidden="true">{paths[name] || null}</svg>;
};

// ---------- Button ----------
// variants: primary | secondary | danger | ghost | outline · sizes: sm | md | lg
const Button = ({ variant = 'primary', size = 'md', icon, children, fullWidth, loading, onClick, ariaLabel, style }) => {
  const pad = { sm: '6px 10px', md: '10px 16px', lg: '14px 20px' }[size];
  const fs  = { sm: 'var(--fs-sm)', md: 'var(--fs-md)', lg: 'var(--fs-md)' }[size];
  const minH = { sm: 36, md: 44, lg: 52 }[size]; // ≥44 for primary touch (design.md §7)
  const palettes = {
    primary:  { bg: 'var(--btn-primary-bg, var(--accent))', color: 'var(--text-on-accent)', bd: 'var(--btn-primary-bd, var(--accent))' },
    success:  { bg: 'var(--accent-hover)', color: 'var(--text-on-accent)', bd: 'var(--accent-hover)' },
    secondary:{ bg: 'var(--surface)',      color: 'var(--text-strong)',    bd: 'var(--border-default)' },
    danger:   { bg: 'var(--danger-500)',   color: 'var(--text-on-accent)', bd: 'var(--danger-500)' },
    ghost:    { bg: 'transparent',         color: 'var(--text-strong)',    bd: 'transparent' },
    outline:  { bg: 'transparent',         color: 'var(--accent-hover)',   bd: 'var(--accent)' },
  };
  const p = palettes[variant];
  return (
    <button
      className="hid-button"
      onClick={onClick}
      aria-label={ariaLabel}
      aria-busy={loading || undefined}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        gap: 'var(--space-200)', padding: pad, minHeight: minH,
        background: p.bg, color: p.color, border: `1px solid ${p.bd}`,
        borderRadius: 'var(--radius-md)', fontSize: fs, fontWeight: 'var(--fw-semibold)',
        width: fullWidth ? '100%' : undefined, whiteSpace: 'nowrap', transition: 'background var(--dur-fast) var(--ease-standard)',
        ...style,
      }}
    >
      {loading && <Spinner size={14} />}
      {!loading && icon && <Icon name={icon} size={size === 'sm' ? 14 : 18} />}
      {children}
    </button>
  );
};

// ---------- Card ----------
const Card = ({ padding = 'var(--space-400)', onClick, children, style, asArticle }) => {
  const Tag = asArticle ? 'article' : (onClick ? 'button' : 'div');
  return (
    <Tag className="hid-card"
      onClick={onClick}
      style={{
        background: 'var(--surface)', border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-2xl)', padding, width: '100%',
        textAlign: 'left', cursor: onClick ? 'pointer' : 'default',
        boxShadow: 'var(--shadow-sm)', display: 'block',
        ...style,
      }}
    >
      {children}
    </Tag>
  );
};

// ---------- Badge ----------
// tone: info | success | warning | danger | gray
const Badge = ({ tone = 'gray', icon, children, style }) => {
  const palettes = {
    info:    { bg: 'var(--primary-50)', color: 'var(--primary-600)' },
    success: { bg: 'var(--success-50)', color: 'var(--success-600)' },
    warning: { bg: 'var(--warning-50)', color: 'var(--warning-600)' },
    danger:  { bg: 'var(--danger-50)',  color: 'var(--danger-badge-text)' },
    gray:    { bg: 'var(--neutral-50)', color: 'var(--text-body)' },
  };
  const p = palettes[tone];
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '3px 8px', background: p.bg, color: p.color,
      fontSize: 'var(--fs-sm)', fontWeight: 'var(--fw-semibold)',
      borderRadius: 'var(--radius-lg)', whiteSpace: 'nowrap',
      ...style,
    }}>
      {icon && <Icon name={icon} size={12} strokeWidth={2.2} />}
      {children}
    </span>
  );
};

// ---------- Spinner ----------
const Spinner = ({ size = 20, color = 'currentColor' }) => (
  <span
    role="status" aria-label="Loading"
    style={{
      display: 'inline-block', width: size, height: size,
      border: `2px solid color-mix(in srgb, ${color} 20%, transparent)`,
      borderTopColor: color, borderRadius: '50%',
      animation: 'spin 800ms linear infinite',
    }}
  />
);

// ---------- PageLoader (mandated loading state) ----------
const PageLoader = ({ label = 'Loading…' }) => (
  <div style={{
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    gap: 'var(--space-300)', padding: 'var(--space-1000) var(--space-400)',
    color: 'var(--text-secondary)',
  }}>
    <Spinner size={28} color="var(--accent)" />
    <div style={{ fontSize: 'var(--fs-sm)' }}>{label}</div>
  </div>
);

// ---------- Skeleton ----------
const Skeleton = ({ w = '100%', h = 12, r = 4, style }) => (
  <div style={{
    width: w, height: h, borderRadius: r,
    background: 'linear-gradient(90deg, var(--neutral-50) 0%, var(--neutral-100) 50%, var(--neutral-50) 100%)',
    backgroundSize: '200% 100%', animation: 'shimmer 1400ms ease-in-out infinite',
    ...style,
  }} />
);

// ---------- EmptyState (mandated empty state) ----------
const EmptyState = ({ icon = 'calendar', title, body, action }) => (
  <div style={{
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    gap: 'var(--space-300)', padding: 'var(--space-800) var(--space-400)',
    textAlign: 'center',
  }}>
    <div style={{
      width: 56, height: 56, borderRadius: 'var(--radius-pill)',
      background: 'var(--surface-info)', color: 'var(--accent-hover)',
      display: 'grid', placeItems: 'center',
    }}>
      <Icon name={icon} size={26} />
    </div>
    <div style={{ fontWeight: 'var(--fw-semibold)', color: 'var(--text-strong)' }}>{title}</div>
    {body && <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)', maxWidth: 240 }}>{body}</div>}
    {action}
  </div>
);

// ---------- SectionHeader ----------
const SectionHeader = ({ title, action, hint }) => (
  <div className="section-heading" style={{
    display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
    gap: 'var(--space-300)', padding: '0 var(--space-100)',
  }}>
    <div>
      <div style={{
        fontSize: 'var(--fs-md)', fontWeight: 'var(--fw-semibold)',
        color: 'var(--text-strong)', letterSpacing: 'var(--tracking-tight)',
      }}>{title}</div>
      {hint && <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)', marginTop: 2 }}>{hint}</div>}
    </div>
    {action}
  </div>
);

// ---------- ErrorState (inline error + recovery) ----------
const ErrorState = ({ title = "Couldn't load", message, onRetry }) => (
  <div style={{
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-300)',
    padding: 'var(--space-800) var(--space-400)', textAlign: 'center',
  }}>
    <div style={{
      width: 56, height: 56, borderRadius: 'var(--radius-pill)',
      background: 'var(--danger-50)', color: 'var(--danger-500)',
      display: 'grid', placeItems: 'center',
    }}>
      <Icon name="alert" size={26} />
    </div>
    <div style={{ fontWeight: 'var(--fw-semibold)', color: 'var(--text-strong)' }}>{title}</div>
    {message && <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--danger-500)', maxWidth: 260 }}>{message}</div>}
    {onRetry && <Button variant="outline" size="sm" icon="sync" onClick={onRetry}>Try again</Button>}
  </div>
);

Object.assign(window, {
  Icon, Button, Card, Badge, Spinner, PageLoader, Skeleton,
  EmptyState, SectionHeader, ErrorState,
});