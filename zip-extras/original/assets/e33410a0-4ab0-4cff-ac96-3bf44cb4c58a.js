// emr-shell.jsx — enterprise shell (sidebar + topbar) + dashboard + shared page chrome
const { useState: useShell } = React;

// shared module page header (title + optional action + breadcrumb-style sub)
function PageHead({ title, sub, action }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 'var(--space-400)', flexWrap: 'wrap', marginBottom: 'var(--space-600)' }}>
      <div style={{ minWidth: 0 }}>
        {sub && <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)', fontWeight: 'var(--fw-semibold)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>{sub}</div>}
        <h1 style={{ fontSize: 'var(--fs-h-md)', fontWeight: 'var(--fw-bold)', color: 'var(--text-heading)', marginTop: 2, lineHeight: 1.2, whiteSpace: 'nowrap' }}>{title}</h1>
      </div>
      {action && <div style={{ flexShrink: 0 }}>{action}</div>}
    </div>
  );
}
// status pill used across queues
function Pill({ tone = 'gray', children, icon }) { return <Badge tone={tone} icon={icon}>{children}</Badge>; }
const TONE_BY_STAGE = { collected: 'info', processing: 'warning', verify: 'warning', completed: 'success', new: 'info', dispensed: 'success', requested: 'info', acquired: 'warning', reporting: 'warning' };

// ============================================================================
//  Sidebar
// ============================================================================
function Sidebar({ active, onNav, collapsed, role }) {
  const allowed = role && role.nav ? role.nav : null;
  const groups = NAV
    .map((g) => ({ ...g, items: g.items.filter((it) => !allowed || allowed.includes(it.id)) }))
    .filter((g) => g.items.length);
  return (
    <aside style={{ width: collapsed ? 64 : 244, flexShrink: 0, background: 'var(--neutral-900)', color: 'var(--text-on-accent)', display: 'flex', flexDirection: 'column', position: 'sticky', top: 0, height: '100vh', transition: 'width .15s', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 12px', height: 60, flexShrink: 0 }}>
        <div style={{ background: '#fff', borderRadius: 'var(--radius-md)', padding: collapsed ? '5px' : '6px 10px', display: 'flex', alignItems: 'center', justifyContent: collapsed ? 'center' : 'flex-start', width: collapsed ? 40 : '100%', height: 36, overflow: 'hidden' }}>
          <img src={(window.__resources && window.__resources.hidLogo) || 'assets/hid-logo.png'} alt="HID" style={{ height: 22, width: 'auto', objectFit: 'contain', objectPosition: 'left center', maxWidth: collapsed ? 28 : '100%' }} />
        </div>
      </div>
      <nav style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
        {groups.map((grp) => (
          <div key={grp.section} style={{ marginBottom: 'var(--space-300)' }}>
            {!collapsed && <div style={{ fontSize: 10, fontWeight: 'var(--fw-bold)', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)', padding: '6px 12px' }}>{grp.section}</div>}
            {grp.items.map((it) => {
              const on = active === it.id;
              return (
                <button key={it.id} onClick={() => onNav(it.id)} title={it.label} aria-current={on ? 'page' : undefined} style={{
                  display: 'flex', alignItems: 'center', gap: 11, width: '100%', padding: collapsed ? '10px' : '9px 12px', justifyContent: collapsed ? 'center' : 'flex-start',
                  border: 'none', borderRadius: 'var(--radius-md)', marginBottom: 2, cursor: 'pointer',
                  background: on ? 'var(--accent)' : 'transparent', color: on ? '#fff' : 'rgba(255,255,255,0.72)',
                  fontSize: 'var(--fs-sm)', fontWeight: on ? 'var(--fw-semibold)' : 'var(--fw-medium)', textAlign: 'left',
                }}>
                  <Icon name={it.icon} size={18} style={{ flexShrink: 0 }} />{!collapsed && it.label}
                </button>
              );
            })}
          </div>
        ))}
      </nav>
    </aside>
  );
}

// ============================================================================
//  Top tab navigation (horizontal, role-filtered, underline-active)
// ============================================================================
function TopNav({ active, onNav, role, mods }) {
  const allowed = role && role.nav ? role.nav : null;
  const items = NAV.flatMap((g) => g.items).filter((it) => (!allowed || allowed.includes(it.id)) && (!mods || mods.has(it.id)));
  if (!items.length) return null;
  return (
    <nav className="emr-topnav" style={{ position: 'sticky', top: 60, zIndex: 'calc(var(--z-sticky) - 1)', background: 'var(--surface)', borderBottom: '1px solid var(--border-default)', overflowX: 'auto' }}>
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '0 var(--space-600)', display: 'flex', gap: 2 }}>
      {items.map((it) => {
        const on = active === it.id;
        return (
          <button key={it.id} onClick={() => onNav(it.id)} aria-current={on ? 'page' : undefined} title={it.label} style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '0 14px', height: 48, flexShrink: 0,
            border: 'none', borderBottom: `2px solid ${on ? 'var(--accent)' : 'transparent'}`, background: 'none',
            color: on ? 'var(--accent-hover)' : 'var(--text-secondary)', fontWeight: on ? 'var(--fw-semibold)' : 'var(--fw-medium)',
            fontSize: 'var(--fs-sm)', whiteSpace: 'nowrap', marginBottom: -1, cursor: 'pointer',
          }}>
            <Icon name={it.icon} size={17} style={{ flexShrink: 0 }} />{it.label}
          </button>
        );
      })}
      </div>
    </nav>
  );
}

// ============================================================================
//  Top bar — logo · branch selector · universal patient search · notifications · profile
// ============================================================================
function TopBar({ branch, onBranch, onOpenPatient, onSignOut, role, onRole, roles, config }) {
  const [q, setQ] = useShell('');
  const [openSearch, setOpenSearch] = useShell(false);
  const [openNotif, setOpenNotif] = useShell(false);
  const [openBranch, setOpenBranch] = useShell(false);
  const [openMenu, setOpenMenu] = useShell(false);
  const [openRole, setOpenRole] = useShell(false);
  const who = role ? role.who : STAFF_USER.name;
  const initials = role ? role.initials : STAFF_USER.initials;
  const roleLabel = role ? role.label : STAFF_USER.role;
  const matches = q ? PATIENTS.filter((p) => (p.name + p.hid + p.phone).toLowerCase().includes(q.toLowerCase())) : PATIENTS.slice(0, 4);
  return (
    <header style={{ position: 'sticky', top: 0, zIndex: 'var(--z-sticky)', background: 'var(--surface)', borderBottom: '1px solid var(--border-default)', height: 60, display: 'flex', alignItems: 'center', gap: 'var(--space-300)', padding: '0 var(--space-500)' }}>
      <img src={(window.__resources && window.__resources.hidLogo) || 'assets/hid-logo.png'} alt="HID" style={{ height: 26, width: 'auto', flexShrink: 0, marginRight: 'var(--space-200)' }} />

      {/* branch */}
      <div style={{ position: 'relative', flexShrink: 0 }}>
        <button onClick={() => setOpenBranch((o) => !o)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', minHeight: 38, border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', background: 'var(--surface)', color: 'var(--text-strong)', fontSize: 'var(--fs-sm)', fontWeight: 'var(--fw-semibold)' }}>
          <Icon name="building" size={16} style={{ color: 'var(--text-secondary)' }} /><span className="hide-sm">{branch.name.replace('Living Word ', '').replace('Living Word', 'Main')}</span><Icon name="chevron" size={14} style={{ color: 'var(--text-secondary)' }} />
        </button>
        {openBranch && (
          <Dropdown onClose={() => setOpenBranch(false)}>
            {BRANCHES.map((b) => <DropItem key={b.id} active={b.id === branch.id} onClick={() => { onBranch(b); setOpenBranch(false); }}>{b.name}<span style={{ display: 'block', fontSize: 11, color: 'var(--text-secondary)' }}>{b.city}</span></DropItem>)}
          </Dropdown>
        )}
      </div>

      {/* universal search */}
      <div style={{ position: 'relative', flex: 1, maxWidth: 520 }}>
        <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }}><Icon name="search" size={17} /></span>
        <input value={q} onChange={(e) => { setQ(e.target.value); setOpenSearch(true); }} onFocus={() => setOpenSearch(true)} placeholder="Search patients by name, HID or phone…"
          style={{ width: '100%', padding: '9px 12px 9px 38px', minHeight: 38, fontSize: 'var(--fs-sm)', border: '1px solid var(--border-control)', borderRadius: 'var(--radius-md)', color: 'var(--text-strong)', background: 'var(--surface-muted)' }} />
        {openSearch && (
          <Dropdown wide onClose={() => setOpenSearch(false)}>
            <div style={{ fontSize: 11, fontWeight: 'var(--fw-bold)', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-secondary)', padding: '4px 12px 6px' }}>{q ? `${matches.length} result${matches.length !== 1 ? 's' : ''}` : 'Recent patients'}</div>
            {matches.map((p) => (
              <button key={p.id} onClick={() => { setOpenSearch(false); setQ(''); onOpenPatient(p); }} style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '8px 12px', minHeight: 44, border: 'none', borderRadius: 'var(--radius-md)', background: 'transparent', textAlign: 'left' }}>
                <span style={{ width: 32, height: 32, borderRadius: 'var(--radius-pill)', background: 'var(--primary-50)', color: 'var(--accent-hover)', display: 'grid', placeItems: 'center', fontWeight: 'var(--fw-bold)', fontSize: 11, flexShrink: 0 }}>{p.name.split(' ').map((x) => x[0]).join('')}</span>
                <span style={{ flex: 1, minWidth: 0 }}><span style={{ display: 'block', fontSize: 'var(--fs-sm)', fontWeight: 'var(--fw-semibold)', color: 'var(--text-strong)' }}>{p.name}</span><span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{p.hid} · {p.age}{p.sex} · {p.status}</span></span>
              </button>
            ))}
            {matches.length === 0 && <div style={{ padding: '12px', fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)', textAlign: 'center' }}>No patient matches “{q}”.</div>}
          </Dropdown>
        )}
      </div>

      <div style={{ flex: 1 }} className="hide-sm" />

      {/* notifications */}
      <div style={{ position: 'relative', flexShrink: 0 }}>
        <button onClick={() => setOpenNotif((o) => !o)} aria-label="Notifications" style={{ position: 'relative', width: 38, height: 38, border: '1px solid var(--border-default)', background: 'var(--surface)', color: 'var(--text-secondary)', display: 'grid', placeItems: 'center', borderRadius: 'var(--radius-md)' }}>
          <Icon name="bell" size={18} /><span style={{ position: 'absolute', top: 6, right: 7, width: 8, height: 8, borderRadius: '50%', background: 'var(--danger-500)', border: '1.5px solid var(--surface)' }} />
        </button>
        {openNotif && (
          <Dropdown wide onClose={() => setOpenNotif(false)}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 12px 8px' }}><span style={{ fontSize: 'var(--fs-sm)', fontWeight: 'var(--fw-bold)', color: 'var(--text-strong)' }}>Notifications</span><span style={{ fontSize: 11, color: 'var(--text-link)', fontWeight: 'var(--fw-semibold)' }}>Mark all read</span></div>
            {NOTIFS.map((n, i) => (
              <div key={i} style={{ display: 'flex', gap: 10, padding: '8px 12px', borderRadius: 'var(--radius-md)' }}>
                <span style={{ width: 30, height: 30, borderRadius: 'var(--radius-pill)', flexShrink: 0, display: 'grid', placeItems: 'center', background: n.tone === 'danger' ? 'var(--danger-50)' : n.tone === 'warning' ? 'var(--warning-50)' : 'var(--surface-info)', color: n.tone === 'danger' ? 'var(--danger-500)' : n.tone === 'warning' ? 'var(--warning-600)' : 'var(--accent)' }}><Icon name={n.icon} size={15} /></span>
                <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-body)', lineHeight: 1.35 }}>{n.text}</div><div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>{n.when} ago</div></div>
              </div>
            ))}
          </Dropdown>
        )}
      </div>

      {/* shift indicator */}
      <div className="hide-sm" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 11px', minHeight: 38, border: '1px solid var(--border-default)', borderRadius: 'var(--radius-md)', background: 'var(--surface)', flexShrink: 0 }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--success-500)' }} />
        <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 'var(--fw-semibold)', color: 'var(--text-strong)' }}>Morning</span>
        <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>07:00–14:00</span>
      </div>

      {/* role switcher (brief: mandatory, no login) */}
      <div style={{ position: 'relative', flexShrink: 0 }}>
        <button onClick={() => setOpenRole((o) => !o)} title="Switch role" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', minHeight: 38, border: '1px solid var(--accent)', borderRadius: 'var(--radius-md)', background: 'var(--surface-info)', color: 'var(--accent-hover)', fontSize: 'var(--fs-sm)', fontWeight: 'var(--fw-semibold)' }}>
          <Icon name="users" size={15} /><span className="hide-sm">{roleLabel}</span><Icon name="chevron" size={14} />
        </button>
        {openRole && (
          <Dropdown onClose={() => setOpenRole(false)}>
            <div style={{ padding: '4px 12px 6px', fontSize: 11, fontWeight: 'var(--fw-bold)', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-secondary)' }}>View as role</div>
            <div style={{ maxHeight: 380, overflowY: 'auto' }}>
              {(roles || ROLES).map((r, i, arr) => {
                const newTier = i === 0 || arr[i - 1].tier !== r.tier;
                return (
                  <React.Fragment key={r.key}>
                    {newTier && <div style={{ padding: '8px 12px 3px', fontSize: 10, fontWeight: 'var(--fw-bold)', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-disabled)' }}>{r.tier} · {r.tierLabel}</div>}
                    <DropItem active={role && r.key === role.key} onClick={() => { onRole(r); setOpenRole(false); }}>{r.label}<span style={{ display: 'block', fontSize: 11, color: 'var(--text-secondary)' }}>{r.who} · {r.focus}</span></DropItem>
                  </React.Fragment>
                );
              })}
            </div>
          </Dropdown>
        )}
      </div>

      {/* profile */}
      <div style={{ position: 'relative', flexShrink: 0 }}>
        <button onClick={() => setOpenMenu((o) => !o)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px 4px 4px', background: 'var(--surface-muted)', border: 'none', borderRadius: 'var(--radius-pill)' }}>
          <span style={{ width: 30, height: 30, borderRadius: 'var(--radius-pill)', background: 'var(--accent)', color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 'var(--fw-bold)', fontSize: 12 }}>{initials}</span>
          <span className="hide-sm" style={{ textAlign: 'left' }}><span style={{ display: 'block', fontSize: 'var(--fs-sm)', fontWeight: 'var(--fw-semibold)', color: 'var(--text-strong)', lineHeight: 1.1 }}>{who}</span><span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{roleLabel}</span></span>
        </button>
        {openMenu && (
          <Dropdown onClose={() => setOpenMenu(false)}>
            <div style={{ padding: '8px 12px', fontSize: 11, color: 'var(--text-secondary)' }}>Signed in as {roleLabel}</div>
            <DropItem onClick={() => {}}>Profile &amp; security</DropItem>
            <DropItem onClick={() => { setOpenMenu(false); onSignOut(); }} danger>Sign out</DropItem>
          </Dropdown>
        )}
      </div>
    </header>
  );
}

function Dropdown({ children, wide, onClose }) {
  return (
    <React.Fragment>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 1 }} />
      <div style={{ position: 'absolute', right: 0, top: '100%', marginTop: 6, minWidth: wide ? 320 : 200, maxWidth: 360, background: 'var(--surface)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-lg)', padding: 6, zIndex: 2 }}>{children}</div>
    </React.Fragment>
  );
}
function DropItem({ children, onClick, active, danger }) {
  return <button onClick={onClick} style={{ display: 'block', width: '100%', padding: '9px 12px', minHeight: 40, border: 'none', borderRadius: 'var(--radius-md)', background: active ? 'var(--primary-50)' : 'transparent', color: danger ? 'var(--danger-500)' : 'var(--text-strong)', fontSize: 'var(--fs-sm)', fontWeight: 'var(--fw-medium)', textAlign: 'left' }}>{children}</button>;
}

// ============================================================================
//  Enterprise dashboard
// ============================================================================
function EmrDashboard({ onNav, onOpenPatient }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--space-400)', flexWrap: 'wrap', marginBottom: 'var(--space-600)' }}>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ fontSize: 'var(--fs-h-md)', fontWeight: 'var(--fw-bold)', color: 'var(--text-heading)', letterSpacing: 'var(--tracking-tight)', lineHeight: 1.15 }}>{`Good morning, ${STAFF_USER.name.split(' ')[1] ? 'Dr. ' + STAFF_USER.name.split(' ')[1] : STAFF_USER.name}`}</h1>
          <p style={{ fontSize: 'var(--fs-md)', color: 'var(--text-secondary)', marginTop: 'var(--space-200)' }}>Here's what's happening across the hospital today.</p>
        </div>
        <Button variant="primary" icon="user-plus" onClick={() => onNav('patients')}>Register patient</Button>
      </div>

      {/* KPIs — FlowBooks composition: label + icon chip, value + delta pill, footer strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(228px,1fr))', gap: 'var(--space-400)', marginBottom: 'var(--space-400)' }}>
        {KPIS.map((k) => {
          const up = k.tone === 'up' || k.tone === 'down-good';
          const deltaPct = /%/.test(k.delta);
          const ftone = k.footTone === 'up' ? 'var(--success-600)' : k.footTone === 'warn' ? 'var(--warning-600)' : 'var(--text-strong)';
          return (
            <Card key={k.k} padding="var(--space-500)">
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--space-300)' }}>
                <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 'var(--fw-semibold)', color: 'var(--text-secondary)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>{k.label}</span>
                <span style={{ width: 36, height: 36, borderRadius: 'var(--radius-lg)', background: 'var(--primary-50)', color: 'var(--accent-hover)', display: 'grid', placeItems: 'center', flexShrink: 0 }}><Icon name={k.icon} size={18} /></span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-200)', marginTop: 'var(--space-300)', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 'var(--fs-h-md)', fontWeight: 'var(--fw-bold)', color: 'var(--text-heading)', lineHeight: 1, letterSpacing: 'var(--tracking-tight)' }}>{k.value}</span>
                {deltaPct
                  ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 7px', borderRadius: 'var(--radius-pill)', background: up ? 'var(--success-50)' : 'var(--danger-50)', color: up ? 'var(--success-600)' : 'var(--danger-badge-text)', fontSize: 'var(--fs-sm)', fontWeight: 'var(--fw-semibold)' }}><Icon name={up ? 'trend-up' : 'trend-down'} size={12} />{k.delta.replace(/[+−-]/, '')}</span>
                  : <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)', fontWeight: 'var(--fw-medium)' }}>{k.delta}</span>}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 'var(--space-400)', padding: '9px 12px', background: 'var(--surface-muted)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)' }}>
                <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)' }}>{k.foot}</span>
                <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 'var(--fw-semibold)', color: ftone }}>{k.footValue}</span>
              </div>
            </Card>
          );
        })}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.5fr) minmax(0,1fr)', gap: 'var(--space-400)', alignItems: 'start' }} className="emr-cols">
        {/* work queues */}
        <Card asArticle padding="var(--space-500)">
          <SectionHeader title="Your work queues" hint="Live across the hospital" />
          <div style={{ marginTop: 'var(--space-400)', display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 'var(--space-200)' }}>
            {DASH_QUEUES.map((qd) => (
              <button key={qd.label} onClick={() => onNav(qd.to)} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-300)', padding: 'var(--space-300) var(--space-400)', textAlign: 'left', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', background: 'var(--surface)' }}>
                <div style={{ width: 36, height: 36, borderRadius: 'var(--radius-md)', background: 'var(--surface-muted)', color: 'var(--text-secondary)', display: 'grid', placeItems: 'center', flexShrink: 0 }}><Icon name={qd.icon} size={18} /></div>
                <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 'var(--fs-h-sm)', fontWeight: 'var(--fw-bold)', color: 'var(--text-heading)', lineHeight: 1 }}>{qd.n}</div><div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 3 }}>{qd.label}</div></div>
                <Icon name="chevron" size={16} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
              </button>
            ))}
          </div>
          <div style={{ marginTop: 'var(--space-500)' }}>
            <SectionHeader title="Department load" />
            <div style={{ marginTop: 'var(--space-300)', display: 'flex', flexDirection: 'column', gap: 10 }}>
              {DEPT_LOAD.map((d) => (
                <div key={d.dept} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-300)' }}>
                  <span style={{ width: 110, fontSize: 'var(--fs-sm)', color: 'var(--text-body)', flexShrink: 0 }}>{d.dept}</span>
                  <span style={{ flex: 1, height: 8, background: 'var(--neutral-100)', borderRadius: 'var(--radius-pill)', overflow: 'hidden' }}><span style={{ display: 'block', height: '100%', width: `${d.load}%`, background: d.load > 80 ? 'var(--warning-500)' : 'var(--accent)', borderRadius: 'var(--radius-pill)' }} /></span>
                  <span style={{ width: 36, textAlign: 'right', fontSize: 'var(--fs-sm)', fontWeight: 'var(--fw-semibold)', color: 'var(--text-strong)', fontVariantNumeric: 'tabular-nums' }}>{d.load}%</span>
                </div>
              ))}
            </div>
          </div>
        </Card>

        {/* notices + today */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-400)' }}>
          <Card asArticle padding="var(--space-500)">
            <SectionHeader title="Needs attention" />
            <div style={{ marginTop: 'var(--space-300)', display: 'flex', flexDirection: 'column', gap: 'var(--space-200)' }}>
              {DASH_NOTICES.map((n, i) => (
                <div key={i} style={{ display: 'flex', gap: 10, padding: 'var(--space-300)', borderRadius: 'var(--radius-md)', background: n.tone === 'danger' ? 'var(--danger-50)' : n.tone === 'warning' ? 'var(--warning-50)' : 'var(--surface-info)' }}>
                  <span style={{ flexShrink: 0, marginTop: 1, color: n.tone === 'danger' ? 'var(--danger-500)' : n.tone === 'warning' ? 'var(--warning-600)' : 'var(--accent)' }}><Icon name={n.icon} size={16} /></span>
                  <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-body)', lineHeight: 1.4 }}>{n.text}</span>
                </div>
              ))}
            </div>
          </Card>
          <Card asArticle padding="var(--space-500)">
            <SectionHeader title="Today's appointments" hint={`${APPTS.length} booked`} />
            <div style={{ marginTop: 'var(--space-300)', display: 'flex', flexDirection: 'column', gap: 'var(--space-200)' }}>
              {APPTS.slice(0, 4).map((a) => (
                <button key={a.id} onClick={() => onNav('appointments')} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-300)', padding: '8px 10px', textAlign: 'left', border: 'none', borderRadius: 'var(--radius-md)', background: 'transparent' }}>
                  <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 'var(--fw-bold)', color: 'var(--accent-hover)', width: 44, flexShrink: 0 }}>{a.time}</span>
                  <span style={{ flex: 1, minWidth: 0 }}><span style={{ display: 'block', fontSize: 'var(--fs-sm)', fontWeight: 'var(--fw-semibold)', color: 'var(--text-strong)' }}>{a.patient}</span><span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{a.type} · {a.doctor}</span></span>
                  {a.status === 'checked-in' && <Badge tone="success">In</Badge>}
                </button>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { PageHead, Pill, TONE_BY_STAGE, Sidebar, TopNav, TopBar, Dropdown, DropItem, EmrDashboard });
