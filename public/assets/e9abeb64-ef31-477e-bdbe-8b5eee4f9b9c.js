// emr-app.jsx — HID EMR root: auth → enterprise shell → module router
// Reuses the clinical consent door (hospital-components/consult/history/dashboard) for the
// CROSS-INSTITUTION record view; first-party EMR modules render without a consent gate.
const { useState: useEmr, useEffect: useEmrFx } = React;

const GRANT_MS = 60 * 60 * 1000;
const BG_MS = 60 * 60 * 1000;

// Consultation entry: pick a patient → HID consent door → consult workspace.
// This is the bridge between the enterprise EMR and the existing governed clinical flow.
function ConsultModule({ stage, patient, onPick, onRequest, onApprove, onCancel, grantExpires, onBack, onFinish, onHistory, onBreakGlass }) {
  if (stage === 'pick') {
    return (
      <div>
        <PageHead sub="Clinical" title="Consultation" />
        <Card asArticle padding="var(--space-500)">
          <div style={{ display: 'flex', gap: 8, padding: 'var(--space-300)', background: 'var(--surface-info)', borderRadius: 'var(--radius-md)', fontSize: 'var(--fs-sm)', color: 'var(--text-body)', marginBottom: 'var(--space-400)' }}>
            <Icon name="lock" size={16} style={{ flexShrink: 0, color: 'var(--accent)' }} /> Open a patient with their HID — their record loads directly. Every access is recorded in the audit log.
          </div>
          <SectionHeader title="Ready for doctor" hint="From triage" />
          <div style={{ marginTop: 'var(--space-300)', display: 'flex', flexDirection: 'column', gap: 'var(--space-200)' }}>
            {PATIENTS.slice(0, 3).map((p) => (
              <button key={p.id} onClick={() => onPick(p)} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-300)', padding: 'var(--space-300) var(--space-400)', textAlign: 'left', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', background: 'var(--surface)' }}>
                <span style={{ width: 38, height: 38, borderRadius: 'var(--radius-pill)', background: 'var(--primary-50)', color: 'var(--accent-hover)', display: 'grid', placeItems: 'center', fontWeight: 'var(--fw-bold)', fontSize: 12, flexShrink: 0 }}>{p.name.split(' ').map((x) => x[0]).join('')}</span>
                <span style={{ flex: 1, minWidth: 0 }}><span style={{ display: 'block', fontWeight: 'var(--fw-semibold)', color: 'var(--text-strong)' }}>{p.name}</span><span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)' }}>{p.hid} · {p.age}{p.sex}{p.flag ? ' · ' + p.flag : ''}</span></span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 'var(--fs-sm)', fontWeight: 'var(--fw-semibold)', color: 'var(--text-link)' }}>Start <Icon name="chevron" size={15} /></span>
              </button>
            ))}
          </div>
        </Card>
      </div>
    );
  }
  if (stage === 'gate') return <AccessGate hid={patient.hid} onRequest={onRequest} onBreakGlass={onBreakGlass} />;
  if (stage === 'awaiting') return <AwaitingConsent hid={patient.hid} onApproved={onApprove} onCancel={onCancel} />;
  if (stage === 'consult') return <ConsultWorkspace expiresAt={grantExpires} onBack={onBack} onFinish={onFinish} onHistory={onHistory} />;
  if (stage === 'history') return <PatientHistory expiresAt={grantExpires} onBack={onHistory} />;
  return null;
}

function PatientPortalView() {
  const p = PATIENTS[0];
  const [decision, setDecision] = useEmr(null); // null | 'approved' | 'declined'
  return (
    <div>
      <PageHead sub="Patient portal" title={`Hello, ${p.name.split(' ')[0]}`} />
      <div style={{ display: 'flex', gap: 8, padding: 'var(--space-300) var(--space-400)', background: 'var(--surface-info)', borderRadius: 'var(--radius-lg)', fontSize: 'var(--fs-sm)', color: 'var(--text-body)', marginBottom: 'var(--space-400)' }}>
        <Icon name="lock" size={16} style={{ flexShrink: 0, color: 'var(--accent)' }} /> This is your own health record. You control who can see it — staff must request access, and you approve or decline.
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.4fr) minmax(0,1fr)', gap: 'var(--space-400)', alignItems: 'start' }} className="emr-cols">
        <Card asArticle padding="var(--space-500)">
          <SectionHeader title="Your details" />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 'var(--space-300)', marginTop: 'var(--space-400)' }}>
            {[['HID number', p.hid, true], ['Age / Sex', `${p.age} · ${p.sex}`], ['Blood group', p.blood], ['Genotype', p.genotype], ['Insurer', p.insurer], ['Status', p.status]].map(([k, v, mono]) => (
              <div key={k}><div style={{ fontSize: 11, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 'var(--fw-semibold)' }}>{k}</div><div className={mono ? 'mono' : ''} style={{ fontSize: 'var(--fs-md)', fontWeight: 'var(--fw-semibold)', color: 'var(--text-strong)', marginTop: 2 }}>{v}</div></div>
            ))}
          </div>
        </Card>
        <Card asArticle padding="var(--space-500)">
          <SectionHeader title="Access requests" hint={decision ? 'Resolved' : 'Awaiting your decision'} />
          {decision === null && (
            <div style={{ marginTop: 'var(--space-300)', padding: 'var(--space-400)', border: '1px solid var(--warning-500)', borderRadius: 'var(--radius-lg)', background: 'var(--warning-50)' }}>
              <div style={{ fontWeight: 'var(--fw-semibold)', color: 'var(--text-strong)' }}>Dr. Amaka Eze · Living Word Hospital</div>
              <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)', marginTop: 2 }}>Wants to view your record for: Antenatal review</div>
              <div style={{ display: 'flex', gap: 'var(--space-200)', marginTop: 'var(--space-400)' }}>
                <Button variant="success" size="sm" icon="check" onClick={() => setDecision('approved')}>Approve for 60 min</Button>
                <Button variant="secondary" size="sm" onClick={() => setDecision('declined')}>Decline</Button>
              </div>
            </div>
          )}
          {decision === 'approved' && (
            <div style={{ marginTop: 'var(--space-300)', padding: 'var(--space-400)', border: '1px solid var(--success-500)', borderRadius: 'var(--radius-lg)', background: 'var(--success-50)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 'var(--fw-semibold)', color: 'var(--success-600)' }}><Icon name="check" size={16} /> Access approved</div>
              <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-body)', marginTop: 4 }}>Dr. Amaka Eze can view your record until {new Date(Date.now() + 60 * 60 * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. You can revoke this anytime.</div>
              <div style={{ display: 'flex', gap: 'var(--space-200)', marginTop: 'var(--space-400)' }}>
                <Button variant="secondary" size="sm" icon="x" onClick={() => setDecision(null)}>Revoke access</Button>
              </div>
            </div>
          )}
          {decision === 'declined' && (
            <div style={{ marginTop: 'var(--space-300)', padding: 'var(--space-400)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-lg)', background: 'var(--surface-muted)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 'var(--fw-semibold)', color: 'var(--text-strong)' }}><Icon name="x" size={16} /> Request declined</div>
              <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)', marginTop: 4 }}>Dr. Amaka Eze was not granted access. They've been notified.</div>
              <div style={{ display: 'flex', gap: 'var(--space-200)', marginTop: 'var(--space-400)' }}>
                <Button variant="ghost" size="sm" icon="arrowLeft" onClick={() => setDecision(null)}>Undo</Button>
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function GenericDept({ title }) {
  return (
    <div>
      <PageHead sub="Clinical" title={title} />
      <Card asArticle padding="var(--space-600)">
        <EmptyState icon="stethoscope" title={`${title} workspace`} body={`This ${title} department is enabled for your facility. Encounters, notes and orders for ${title} appear here.`} />
      </Card>
    </div>
  );
}

function MobileNav({ items, active, onNav }) {
  const [drawer, setDrawer] = useEmr(false);
  // first 4 items as the bottom tab bar; everything goes in the drawer
  const primary = items.slice(0, 4);
  return (
    <React.Fragment>
      <nav className="emr-mobilenav" style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 'var(--z-sticky)', background: 'var(--surface)', borderTop: '1px solid var(--border-default)', display: 'none', paddingBottom: 'env(safe-area-inset-bottom, 0)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${primary.length + 1}, 1fr)` }}>
          {primary.map((it) => {
            const on = active === it.id;
            return (
              <button key={it.id} onClick={() => onNav(it.id)} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, padding: '8px 4px 7px', minHeight: 56, border: 'none', background: 'none', color: on ? 'var(--accent-hover)' : 'var(--text-secondary)', fontSize: 10, fontWeight: on ? 'var(--fw-semibold)' : 'var(--fw-medium)' }}>
                <Icon name={it.icon} size={21} strokeWidth={on ? 2 : 1.6} />{it.label.split(' ')[0]}
              </button>
            );
          })}
          <button onClick={() => setDrawer(true)} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, padding: '8px 4px 7px', minHeight: 56, border: 'none', background: 'none', color: 'var(--text-secondary)', fontSize: 10, fontWeight: 'var(--fw-medium)' }}>
            <Icon name="dots" size={21} />More
          </button>
        </div>
      </nav>
      {drawer && (
        <div className="emr-sheet-scrim" onClick={() => setDrawer(false)} style={{ position: 'fixed', inset: 0, zIndex: 'var(--z-overlay)', background: 'rgba(17,17,17,0.4)', display: 'flex', alignItems: 'flex-end' }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', background: 'var(--surface)', borderRadius: '16px 16px 0 0', maxHeight: '80vh', overflowY: 'auto', padding: 'var(--space-400) var(--space-400) calc(var(--space-500) + env(safe-area-inset-bottom, 0))' }}>
            <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--neutral-200)', margin: '4px auto var(--space-400)' }} />
            <div style={{ fontSize: 11, fontWeight: 'var(--fw-bold)', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-secondary)', padding: '0 8px 8px' }}>All sections</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 6 }}>
              {items.map((it) => {
                const on = active === it.id;
                return (
                  <button key={it.id} onClick={() => { onNav(it.id); setDrawer(false); }} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', minHeight: 48, border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', background: on ? 'var(--primary-50)' : 'var(--surface)', color: on ? 'var(--accent-hover)' : 'var(--text-strong)', fontSize: 'var(--fs-sm)', fontWeight: 'var(--fw-medium)', textAlign: 'left' }}>
                    <Icon name={it.icon} size={18} style={{ flexShrink: 0 }} />{it.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </React.Fragment>
  );
}

function App() {
  const [phase, setPhase] = useEmr('login');     // login | forgot | app
  const [branch, setBranch] = useEmr(BRANCHES[0]);
  const [collapsed, setCollapsed] = useEmr(false);
  const [nav, setNav] = useEmr('dashboard');
  const [booting, setBooting] = useEmr(false);
  const [role, setRole] = useEmr(ROLES.find((r) => r.key === 'consultant'));
  const [config, setConfig] = useEmr(HOSPITAL_CONFIG);
  const [setupMode, setSetupMode] = useEmr(false); // true = run the wizard

  // dynamic generation: which modules & roles exist for THIS facility
  const mods = enabledModules(config.departments);
  const roleKeys = enabledRoleKeys(config.departments);
  const availableRoles = ROLES.filter((r) => roleKeys.has(r.key));

  // consult sub-flow
  const [cStage, setCStage] = useEmr('pick');
  const [cPatient, setCPatient] = useEmr(PATIENTS[0]);
  const [grantExpires, setGrantExpires] = useEmr(0);

  // break-glass
  const [bgOpen, setBgOpen] = useEmr(false);
  const [bg, setBg] = useEmr(null);
  const [bgViewed, setBgViewed] = useEmr(['overview']);

  function goNav(id) { setNav(id); setSetupMode(false); if (id === 'consult') setCStage('pick'); }
  function launchConfig(cfg) {
    setConfig(cfg); setSetupMode(false);
    // if the active role no longer exists for this facility, fall back to admin
    if (!enabledRoleKeys(cfg.departments).has(role.key)) setRole(ROLES.find((r) => r.key === 'administrator'));
    setNav('dashboard'); setBooting(true); setTimeout(() => setBooting(false), 400);
  }
  function changeRole(r) { setRole(r); setNav(r.home); setBooting(true); setTimeout(() => setBooting(false), 280); }
  function openPatientFromSearch(p) { setCPatient(p); setNav('consult'); setGrantExpires(Date.now() + GRANT_MS); setCStage('consult'); }
  function bootInto() { setBooting(true); setPhase('app'); setTimeout(() => setBooting(false), 500); }
  function confirmBreakGlass(reason, note) { setBgOpen(false); setBg({ reason, note, expiresAt: Date.now() + BG_MS }); setBgViewed(['overview']); setNav('emergency-view'); }

  if (phase === 'login') return <EmrLogin onNext={bootInto} onForgot={() => setPhase('forgot')} />;
  if (phase === 'forgot') return <EmrForgot onBack={() => setPhase('login')} onSent={() => setPhase('login')} />;

  // break-glass emergency takeover (red frame, outside the shell)
  if (nav === 'emergency-view' && bg) {
    return <div style={{ minHeight: '100vh', background: 'var(--surface-muted)' }}><BreakGlassView reason={bg.reason} note={bg.note} expiresAt={bg.expiresAt} viewed={bgViewed} onView={(id) => setBgViewed((s) => s.includes(id) ? s : [...s, id])} onClose={() => { setBg(null); setNav('dashboard'); }} /></div>;
  }

  let content;
  if (booting) content = <div style={{ minHeight: 400, display: 'grid', placeItems: 'center' }}><PageLoader label="Loading workspace…" /></div>;
  else if (nav === 'portal') content = <PatientPortalView />;
  else switch (nav) {
    case 'dashboard': content = <RoleDashboard role={role} onNav={goNav} onOpenPatient={openPatientFromSearch} />; break;
    case 'patients': content = <PatientsModule onOpenPatient={openPatientFromSearch} />; break;
    case 'appointments': content = <AppointmentsModule />; break;
    case 'triage': content = <TriageModule />; break;
    case 'journey': content = <JourneyModule />; break;
    case 'consult': content = <ConsultModule stage={cStage} patient={cPatient}
      onPick={(p) => { setCPatient(p); setGrantExpires(Date.now() + GRANT_MS); setCStage('consult'); }}
      onRequest={() => setCStage('consult')} onApprove={() => { setGrantExpires(Date.now() + GRANT_MS); setCStage('consult'); }}
      onCancel={() => setCStage('pick')} grantExpires={grantExpires}
      onBack={() => setCStage('pick')} onFinish={() => { setCStage('pick'); setNav('dashboard'); }}
      onHistory={() => setCStage((s) => s === 'history' ? 'consult' : 'history')} onBreakGlass={() => setBgOpen(true)} />; break;
    case 'inpatient': content = <InpatientModule />; break;
    case 'emergency': content = <EmergencyModule onBreakGlass={() => setBgOpen(true)} />; break;
    case 'maternity': content = <MaternityModule />; break;
    case 'surgery': content = <SurgeryModule />; break;
    case 'lab': content = <LabModule />; break;
    case 'radiology': content = <RadiologyModule />; break;
    case 'pharmacy': content = <PharmacyModule />; break;
    case 'billing': content = <BillingModule />; break;
    case 'insurance': content = <InsuranceModule />; break;
    case 'inventory': content = <InventoryModule />; break;
    case 'reports': content = <ReportsModule />; break;
    case 'audit': content = <ActivityLog />; break;
    case 'ambulance': content = <AmbulanceModule />; break;
    case 'bloodbank': content = <BloodBankModule />; break;
    case 'telemedicine': content = <TelemedicineModule />; break;
    case 'referrals': content = <ReferralsModule />; break;
    case 'setup': content = setupMode
      ? <SetupWizard initial={config} onLaunch={launchConfig} onCancel={() => setSetupMode(false)} />
      : <SetupModule config={config} onConfigure={() => setSetupMode(true)} />; break;
    case 'icu': content = <InpatientModule />; break;
    case 'dental': content = <GenericDept title="Dental" />; break;
    case 'staff': content = <StaffModule />; break;
    case 'shifts': content = <ShiftsModule />; break;
    case 'hr': content = <HRModule />; break;
    case 'quality': content = <QualityModule />; break;
    default: content = <RoleDashboard role={role} onNav={goNav} onOpenPatient={openPatientFromSearch} />;
  }

  const navItems = NAV.flatMap((g) => g.items).filter((it) => (!role.nav || role.nav.includes(it.id)) && mods.has(it.id));
  return (
    <div style={{ minHeight: '100vh', background: 'var(--surface-muted)', display: 'flex', flexDirection: 'column' }}>
      <TopBar branch={branch} onBranch={setBranch} onOpenPatient={openPatientFromSearch} onSignOut={() => { setPhase('login'); setNav('dashboard'); }} role={role} onRole={changeRole} roles={availableRoles} config={config} />
      <TopNav active={nav === 'emergency-view' ? 'emergency' : nav} onNav={goNav} role={role} mods={mods} />
      <main className="emr-main" style={{ flex: 1, minWidth: 0, padding: 'var(--space-800) var(--space-600) var(--space-700)' }}>
        <div style={{ maxWidth: 1280, margin: '0 auto' }}>{content}</div>
      </main>
      <MobileNav items={navItems} active={nav === 'emergency-view' ? 'emergency' : nav} onNav={goNav} />
      <BreakGlassModal open={bgOpen} onClose={() => setBgOpen(false)} onConfirm={confirmBreakGlass} />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
