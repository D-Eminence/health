function WayaSidebar({ active, onNav, collapsed, onCollapse, role, mods, config }) {
  const groups = NAV.map(g => ({...g, items:g.items.filter(it => (!role.nav || role.nav.includes(it.id)) && mods.has(it.id))})).filter(g => g.items.length);
  return <aside className={'waya-sidebar' + (collapsed ? ' is-collapsed' : '')}>
    <div className="workspace-brand"><img className={collapsed ? 'health-id-mark' : 'health-id-lockup'} src={collapsed ? 'brand/logo-icon.png' : 'brand/logo.png'} alt="Health ID"/>{!collapsed && <small>Hospital workspace</small>}</div>
    <div className="workspace-name">{!collapsed && <><span className="facility-mark"><Icon name="building" size={17}/></span><span><strong>{config.name || 'Living Word Hospital'}</strong><small>Your connected care team</small></span></>}</div>
    <nav aria-label="Main navigation">{groups.map(g => <div className="nav-group" key={g.section}>{!collapsed && <p>{g.section === 'Clinical' ? 'Workspace' : g.section}</p>}{g.items.map(it => <button key={it.id} title={it.label} aria-label={it.label} aria-current={active === it.id ? 'page' : undefined} onClick={() => onNav(it.id)}><Icon name={it.icon} size={18}/>{!collapsed && <span>{it.label}</span>}{!collapsed && active === it.id && <span className="active-dot"/>}</button>)}</div>)}</nav>
    <div className="sidebar-footer">{!collapsed && <div className="workspace-note"><Icon name="shield-check" size={18}/><span>Care, connected.<small>Health Identity Directory</small></span></div>}<button className="collapse-toggle" onClick={onCollapse} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}><Icon name={collapsed ? 'chevron' : 'arrowLeft'} size={17}/>{!collapsed && 'Collapse sidebar'}</button></div>
  </aside>;
}
