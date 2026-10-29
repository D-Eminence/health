// emr-setup.jsx — Hospital Setup Wizard (9 steps) → produces a hospital config
// that dynamically generates navigation, roles and workspaces.
const { useState: useWiz } = React;

const WIZ_STEPS = ['Facility', 'Type', 'Departments', 'Branches', 'Staff', 'Roles', 'Billing', 'Review', 'Launch'];
const WIZ_INPUT = { width: '100%', padding: '11px 13px', fontSize: 'var(--fs-md)', border: '1px solid var(--border-control)', borderRadius: 'var(--radius-md)', color: 'var(--text-strong)', background: 'var(--surface)' };

function WizField({ label, children, hint }) {
  return <label style={{ display: 'block' }}><span style={{ display: 'block', fontSize: 'var(--fs-sm)', fontWeight: 'var(--fw-semibold)', color: 'var(--text-strong)', marginBottom: 6 }}>{label}</span>{children}{hint && <span style={{ display: 'block', fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>{hint}</span>}</label>;
}

function SetupWizard({ initial, onLaunch, onCancel }) {
  const [step, setStep] = useWiz(0);
  const [name, setName] = useWiz(initial.name || '');
  const [type, setType] = useWiz(initial.type || 'community');
  const [depts, setDepts] = useWiz(initial.departments || []);
  const [multiBranch, setMultiBranch] = useWiz(!!initial.multiBranch);

  function chooseType(t) {
    setType(t);
    setDepts((TYPE_PRESETS[t] || []).slice()); // pre-check recommended departments
  }
  function toggleDept(id) {
    const d = DEPARTMENTS.find((x) => x.id === id);
    if (d.core) return; // core depts can't be removed
    setDepts((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id]);
  }

  const mods = enabledModules(depts);
  const roleKeys = enabledRoleKeys(depts);
  const genModules = NAV.flatMap((g) => g.items).filter((it) => mods.has(it.id));
  const genRoles = ROLES.filter((r) => roleKeys.has(r.key));
  const canNext = step !== 0 || name.trim().length > 1;

  const next = () => setStep((s) => Math.min(s + 1, WIZ_STEPS.length - 1));
  const back = () => setStep((s) => Math.max(s - 1, 0));

  return (
    <div>
      <PageHead sub="Administration" title="Hospital Setup" action={<Button variant="ghost" icon="x" onClick={onCancel}>Exit setup</Button>} />

      {/* stepper */}
      <div style={{ display: 'flex', gap: 6, overflowX: 'auto', marginBottom: 'var(--space-600)', paddingBottom: 4 }}>
        {WIZ_STEPS.map((s, i) => {
          const done = i < step, on = i === step;
          return (
            <button key={s} onClick={() => i <= step && setStep(i)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', flexShrink: 0, borderRadius: 'var(--radius-pill)', border: `1px solid ${on ? 'var(--accent)' : 'var(--border-default)'}`, background: on ? 'var(--accent)' : done ? 'var(--primary-50)' : 'var(--surface)', color: on ? '#fff' : done ? 'var(--accent-hover)' : 'var(--text-secondary)', fontSize: 'var(--fs-sm)', fontWeight: 'var(--fw-semibold)', cursor: i <= step ? 'pointer' : 'default' }}>
              <span style={{ width: 18, height: 18, borderRadius: '50%', display: 'grid', placeItems: 'center', background: on ? 'rgba(255,255,255,0.25)' : done ? 'var(--accent)' : 'var(--neutral-200)', color: on || done ? '#fff' : 'var(--text-secondary)', fontSize: 10, fontWeight: 'var(--fw-bold)' }}>{done ? '✓' : i + 1}</span>
              {s}
            </button>
          );
        })}
      </div>

      <Card asArticle padding="var(--space-600)">
        {/* STEP 1 — Facility info */}
        {step === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-400)', maxWidth: 560 }}>
            <SectionHeader title="Facility information" hint="Tell us about the hospital" />
            <WizField label="Facility name"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Living Word Hospital" style={WIZ_INPUT} /></WizField>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-400)' }}>
              <WizField label="Phone"><input placeholder="080…" style={WIZ_INPUT} inputMode="tel" /></WizField>
              <WizField label="Email"><input placeholder="admin@hospital.com" style={WIZ_INPUT} /></WizField>
            </div>
            <WizField label="Address"><input placeholder="Street, city, state" style={WIZ_INPUT} /></WizField>
          </div>
        )}

        {/* STEP 2 — Facility type */}
        {step === 1 && (
          <div>
            <SectionHeader title="Facility type" hint="This pre-selects the departments most facilities of this type run" />
            <div style={{ marginTop: 'var(--space-400)', display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 'var(--space-300)' }}>
              {FACILITY_TYPES.map((t) => {
                const on = type === t.id;
                return (
                  <button key={t.id} onClick={() => chooseType(t.id)} style={{ textAlign: 'left', padding: 'var(--space-400)', borderRadius: 'var(--radius-lg)', border: `1.5px solid ${on ? 'var(--accent)' : 'var(--border-default)'}`, background: on ? 'var(--primary-50)' : 'var(--surface)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ width: 36, height: 36, borderRadius: 'var(--radius-lg)', background: on ? 'var(--accent)' : 'var(--surface-muted)', color: on ? '#fff' : 'var(--text-secondary)', display: 'grid', placeItems: 'center' }}><Icon name={t.icon} size={18} /></span>
                      {on && <Icon name="check" size={18} style={{ color: 'var(--accent)' }} />}
                    </div>
                    <div style={{ fontSize: 'var(--fs-md)', fontWeight: 'var(--fw-semibold)', color: 'var(--text-strong)', marginTop: 'var(--space-300)' }}>{t.label}</div>
                    <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)', marginTop: 2 }}>{t.desc}</div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* STEP 3 — Departments */}
        {step === 2 && (
          <div>
            <SectionHeader title="Services & departments" hint="Enable only what this facility runs — the rest never appears" />
            <div style={{ marginTop: 'var(--space-400)', display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 'var(--space-200)' }}>
              {DEPARTMENTS.map((d) => {
                const on = depts.includes(d.id);
                return (
                  <button key={d.id} onClick={() => toggleDept(d.id)} disabled={d.core} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 13px', borderRadius: 'var(--radius-md)', border: `1.5px solid ${on ? 'var(--accent)' : 'var(--border-default)'}`, background: on ? 'var(--primary-50)' : 'var(--surface)', textAlign: 'left', cursor: d.core ? 'default' : 'pointer', opacity: d.core ? 0.85 : 1 }}>
                    <span style={{ width: 20, height: 20, flexShrink: 0, borderRadius: 'var(--radius-sm)', border: `1.5px solid ${on ? 'var(--accent)' : 'var(--border-control)'}`, background: on ? 'var(--accent)' : 'transparent', display: 'grid', placeItems: 'center' }}>{on && <Icon name="check" size={12} strokeWidth={3} style={{ color: '#fff' }} />}</span>
                    <span style={{ flex: 1, fontSize: 'var(--fs-sm)', fontWeight: 'var(--fw-medium)', color: 'var(--text-strong)' }}>{d.label}</span>
                    {d.core && <Badge tone="gray">Core</Badge>}
                  </button>
                );
              })}
            </div>
            <div style={{ marginTop: 'var(--space-400)', fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)' }}>{depts.length} departments enabled · generates {genModules.length} workspaces and {genRoles.length} roles.</div>
          </div>
        )}

        {/* STEP 4 — Branches */}
        {step === 3 && (
          <div style={{ maxWidth: 560 }}>
            <SectionHeader title="Branch configuration" />
            <div style={{ marginTop: 'var(--space-400)', display: 'flex', flexDirection: 'column', gap: 'var(--space-200)' }}>
              {[['single', 'Single branch', 'One physical facility'], ['multi', 'Multi-branch', 'A group operating across several sites']].map(([id, t, d]) => {
                const on = (id === 'multi') === multiBranch;
                return (
                  <button key={id} onClick={() => setMultiBranch(id === 'multi')} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 'var(--space-400)', borderRadius: 'var(--radius-lg)', border: `1.5px solid ${on ? 'var(--accent)' : 'var(--border-default)'}`, background: on ? 'var(--primary-50)' : 'var(--surface)', textAlign: 'left' }}>
                    <span style={{ width: 18, height: 18, borderRadius: '50%', border: `2px solid ${on ? 'var(--accent)' : 'var(--border-control)'}`, background: on ? 'var(--accent)' : 'transparent', display: 'grid', placeItems: 'center', flexShrink: 0 }}>{on && <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#fff' }} />}</span>
                    <span><span style={{ display: 'block', fontSize: 'var(--fs-md)', fontWeight: 'var(--fw-semibold)', color: 'var(--text-strong)' }}>{t}</span><span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)' }}>{d}</span></span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* STEP 5 — Staff structure (informational scaffold) */}
        {step === 4 && <WizScaffold title="Staff structure" hint="Departments, reporting lines, roles & shift structure" rows={[['Departments', `${depts.length} enabled`], ['Reporting lines', 'Administrative + clinical-governance'], ['Shift structure', 'Morning · Afternoon · Night · On-call']]} />}

        {/* STEP 6 — Roles & permissions (generated preview) */}
        {step === 5 && (
          <div>
            <SectionHeader title="Roles & permissions" hint="These roles are generated from the departments you enabled" />
            <div style={{ marginTop: 'var(--space-400)', display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 'var(--space-200)' }}>
              {genRoles.map((r) => (
                <div key={r.key} style={{ padding: 'var(--space-300) var(--space-400)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)' }}>
                  <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 'var(--fw-semibold)', color: 'var(--text-strong)' }}>{r.label}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{r.tierLabel} · {r.focus}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* STEP 7 — Billing */}
        {step === 6 && (
          <div style={{ maxWidth: 560 }}>
            <SectionHeader title="Billing & services" hint="Set base charges — itemized pricing comes later" />
            <div style={{ marginTop: 'var(--space-400)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-400)' }}>
              {[['Consultation', '5,000'], ['Lab (avg)', '8,000'], ['Pharmacy markup', '15%'], ['Procedure (base)', '20,000']].map(([l, v]) => (
                <WizField key={l} label={l}><input defaultValue={v} style={WIZ_INPUT} /></WizField>
              ))}
            </div>
          </div>
        )}

        {/* STEP 8 — Review */}
        {step === 7 && (
          <div>
            <SectionHeader title="Review configuration" hint="This is the workspace that will be generated" />
            <div style={{ marginTop: 'var(--space-400)', display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 'var(--space-400)' }}>
              <ReviewBox title="Facility" rows={[['Name', name || '—'], ['Type', (FACILITY_TYPES.find((t) => t.id === type) || {}).label], ['Branches', multiBranch ? 'Multi-branch' : 'Single branch']]} />
              <ReviewBox title={`Generated navigation (${genModules.length})`} chips={genModules.map((m) => m.label)} />
              <ReviewBox title={`Generated roles (${genRoles.length})`} chips={genRoles.map((r) => r.label)} />
            </div>
          </div>
        )}

        {/* STEP 9 — Launch */}
        {step === 8 && (
          <div style={{ textAlign: 'center', padding: 'var(--space-600) 0' }}>
            <div style={{ width: 64, height: 64, borderRadius: 'var(--radius-pill)', background: 'var(--primary-50)', color: 'var(--accent-hover)', display: 'grid', placeItems: 'center', margin: '0 auto var(--space-400)' }}><Icon name="building" size={32} /></div>
            <h2 style={{ fontSize: 'var(--fs-h-sm)', fontWeight: 'var(--fw-bold)', color: 'var(--text-heading)' }}>Ready to launch {name || 'your hospital'}</h2>
            <p style={{ fontSize: 'var(--fs-md)', color: 'var(--text-secondary)', marginTop: 8, maxWidth: 460, marginInline: 'auto' }}>The workspace will generate {genModules.length} modules and {genRoles.length} roles for your {(FACILITY_TYPES.find((t) => t.id === type) || {}).label}. You can reconfigure anytime from Hospital Setup.</p>
            <Button variant="primary" size="lg" icon="check" style={{ marginTop: 'var(--space-500)' }} onClick={() => onLaunch({ name: name || 'New Hospital', type, multiBranch, departments: depts })}>Launch hospital workspace</Button>
          </div>
        )}
      </Card>

      {/* footer nav */}
      {step < 8 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 'var(--space-500)' }}>
          <Button variant="ghost" icon="arrowLeft" onClick={step === 0 ? onCancel : back}>{step === 0 ? 'Cancel' : 'Back'}</Button>
          <Button variant="primary" onClick={next} style={{ opacity: canNext ? 1 : 0.5, pointerEvents: canNext ? 'auto' : 'none' }}>Continue</Button>
        </div>
      )}
    </div>
  );
}

function WizScaffold({ title, hint, rows }) {
  return (
    <div>
      <SectionHeader title={title} hint={hint} />
      <div style={{ marginTop: 'var(--space-400)', display: 'flex', flexDirection: 'column', gap: 'var(--space-200)', maxWidth: 520 }}>
        {rows.map(([k, v]) => (
          <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: 'var(--space-300) var(--space-400)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)' }}>
            <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)' }}>{k}</span>
            <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 'var(--fw-semibold)', color: 'var(--text-strong)' }}>{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
function ReviewBox({ title, rows, chips }) {
  return (
    <div style={{ padding: 'var(--space-400)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-lg)', background: 'var(--surface-muted)' }}>
      <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 'var(--fw-bold)', color: 'var(--text-strong)', marginBottom: 'var(--space-300)' }}>{title}</div>
      {rows && rows.map(([k, v]) => <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--fs-sm)', padding: '3px 0' }}><span style={{ color: 'var(--text-secondary)' }}>{k}</span><span style={{ fontWeight: 'var(--fw-semibold)', color: 'var(--text-strong)' }}>{v}</span></div>)}
      {chips && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{chips.map((c) => <span key={c} style={{ fontSize: 11, padding: '3px 9px', borderRadius: 'var(--radius-pill)', background: 'var(--surface)', border: '1px solid var(--border-default)', color: 'var(--text-body)' }}>{c}</span>)}</div>}
    </div>
  );
}

Object.assign(window, { SetupWizard });
