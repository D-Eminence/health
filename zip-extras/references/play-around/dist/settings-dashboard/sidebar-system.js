(() => {
  const sidebar = document.querySelector('.sidebar');
  const shell = document.querySelector('#app-shell');
  if (!sidebar || !shell) return;

  const prefsKey = 'settings-preview-v3';
  const workspaceKey = 'settings-preview-workspace';
  const countKey = 'settings-preview-orders-count';
  const closeMs = 150;
  const menuWidth = 245;
  const menuOffset = 6;
  const viewportPadding = 12;
  const workspaces = [
    { id: 'winner', name: 'Winner Company', email: 'Ogunsleye123@gmail.com', role: 'Admin' },
    { id: 'studio', name: 'Winner Studio', email: 'team@winner.studio', role: 'Member' },
    { id: 'labs', name: 'Winner Labs', email: 'labs@winner.company', role: 'Viewer' }
  ];
  let workspaceId = localStorage.getItem(workspaceKey) || 'winner';
  let orderCount = Number(localStorage.getItem(countKey) ?? 10);
  let menuNode = null;
  let menuTrigger = null;
  let menuMode = 'menu';
  let tooltipNode = null;
  let tooltipTrigger = null;
  let tooltipHome = null;
  let tooltipClosing = null;

  paths.panel = paths.panel || 'M4 6h16v12H4zM16 6v12';
  paths.chevronDown = 'm7 9 5 5 5-5';
  paths.userPlus = 'M15 19v-1.5c0-2-1.7-3.5-3.8-3.5H8.8C6.7 14 5 15.5 5 17.5V19M10 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6M18 8v6M21 11h-6';
  paths.logout = 'M10 5H5v14h5M14 8l4 4-4 4M8 12h10';

  const navGroups = [
    {
      items: [
        ['/dashboard', 'home', 'Home', 'H'],
        ['/account', 'bank', 'Account', 'C'],
        ['/users', 'users', 'Users', 'U'],
        ['/orders', 'orders', 'Orders', 'O'],
        ['/transactions', 'receipt', 'Transactions', 'T'],
        ['/api', 'code', 'API', 'A'],
        ['/reports', 'report', 'Report', 'R']
      ]
    },
    {
      label: 'Trading Account',
      items: [
        ['/business-trading', 'building', 'Business trading', 'B'],
        ['/accounts/new', 'plus', 'New account', 'N']
      ]
    },
    {
      label: 'More',
      items: [
        ['/audit-log', 'audit', 'Audit log', 'L'],
        ['/settings', 'settings', 'Settings', 'S']
      ]
    }
  ];

  function currentWorkspace() {
    return workspaces.find(item => item.id === workspaceId) || workspaces[0];
  }

  function currentRoute() {
    const hashRoute = location.hash.replace(/^#/, '');
    if (hashRoute.startsWith('/settings')) return '/settings';
    if (hashRoute.startsWith('/')) return hashRoute;
    return '/settings';
  }

  function saveCollapsed(value) {
    try {
      const data = JSON.parse(localStorage.getItem(prefsKey)) || {};
      data.collapsed = value;
      localStorage.setItem(prefsKey, JSON.stringify(data));
      if (typeof state !== 'undefined') state.collapsed = value;
    } catch {
      // The visual state still works if storage is unavailable.
    }
  }

  function tooltip(id, label, shortcut, className = 'nav-tooltip') {
    return `<span class="t-tt ${className}" data-side="right" id="${id}" role="tooltip"><span>${label}</span>${shortcut ? `<kbd>${shortcut}</kbd>` : ''}</span>`;
  }

  function settingsHexIcon() {
    return '<svg class="svg-icon settings-hex-icon" aria-hidden="true" viewBox="0 0 20 20"><path d="M10 2.25 16.7 6.1v7.8L10 17.75 3.3 13.9V6.1L10 2.25Z"></path><circle cx="10" cy="10" r="2.25"></circle></svg>';
  }

  function sidebarIcon(name) {
    return `<span class="sidebar-icon">${name === 'settings' ? settingsHexIcon() : icon(name)}</span>`;
  }

  function badgeMarkup(count) {
    const shown = count > 99 ? '99+' : String(count);
    return `<span class="t-badge nav-badge" data-open="${count > 0}"><i class="t-badge-dot" aria-hidden="true">${shown}</i><span class="sr-only">${shown} items require attention</span></span>`;
  }

  function navItem([route, iconName, label, shortcut]) {
    const active = currentRoute() === route;
    const badge = route === '/orders' ? badgeMarkup(orderCount) : '';
    const id = `sidebar-tip-${label.toLowerCase().replace(/\s+/g, '-')}`;
    return `<span class="t-tt-wrap nav-wrap"><button class="nav-item t-tt-trigger" data-sidebar-tooltip="collapsed" data-sidebar-route="${route}" data-label="${label}" aria-describedby="${id}" ${active ? 'aria-current="page"' : ''}>${sidebarIcon(iconName)}<span class="nav-copy">${label}</span><span class="sidebar-trailing">${badge}</span></button>${tooltip(id, label, shortcut)}</span>`;
  }

  function renderSidebar() {
    hideSidebarTooltip(true);
    const ws = currentWorkspace();
    const collapsed = shell.classList.contains('is-collapsed');
    const shortcut = navigator.platform.toLowerCase().includes('mac') ? '⌘ B' : 'Ctrl B';
    const navHtml = navGroups.map(group => `${group.label ? `<span class="nav-section">${group.label}</span>` : ''}${group.items.map(navItem).join('')}`).join('');

    sidebar.classList.add('sidebar-system');
    sidebar.innerHTML = `
      <div class="sidebar-header">
        <span class="t-tt-wrap workspace-wrap">
          <button class="workspace-trigger t-tt-trigger" data-sidebar-tooltip="workspace" data-sidebar-action="workspace" aria-expanded="false" aria-haspopup="menu" aria-describedby="workspace-name-tip">
            <span class="workspace-logo">W</span>
            <span class="workspace-name">${esc(ws.name)}</span>
            <span class="workspace-chevron">${icon('chevronDown')}</span>
          </button>
          ${tooltip('workspace-name-tip', ws.name, '', 'workspace-tooltip')}
        </span>
        <span class="t-tt-wrap collapse-wrap">
          <button class="icon-button collapse t-tt-trigger" data-sidebar-tooltip="always" data-sidebar-action="collapse" aria-label="${collapsed ? 'Open sidebar' : 'Close sidebar'}" aria-describedby="collapse-tip">${sidebarIcon('panel')}</button>
          ${tooltip('collapse-tip', collapsed ? 'Open sidebar' : 'Close sidebar', shortcut, 'collapse-tooltip')}
        </span>
      </div>
      <nav class="navigation" aria-label="Workspace navigation">${navHtml}</nav>
      <span class="t-tt-wrap help-wrap"><button class="nav-item help t-tt-trigger" data-sidebar-tooltip="collapsed" data-sidebar-route="/help" data-label="Help" aria-describedby="sidebar-tip-help">${sidebarIcon('question')}<span class="nav-copy">Help</span><span class="sidebar-trailing"></span></button>${tooltip('sidebar-tip-help', 'Help', '?')}</span>`;

    requestAnimationFrame(() => {
      const name = sidebar.querySelector('.workspace-name');
      const trigger = sidebar.querySelector('.workspace-trigger');
      if (name && trigger) trigger.dataset.tooltipEnabled = String(collapsed || name.scrollWidth > name.clientWidth);
    });
  }

  function canShowSidebarTooltip(trigger) {
    const mode = trigger?.dataset.sidebarTooltip;
    if (!mode || trigger.getAttribute('aria-expanded') === 'true') return false;
    if (mode === 'always') return true;
    if (mode === 'workspace') return trigger.dataset.tooltipEnabled === 'true';
    return mode === 'collapsed' && shell.classList.contains('is-collapsed');
  }

  function positionSidebarTooltip() {
    if (!tooltipNode || !tooltipTrigger) return;
    const anchor = tooltipTrigger.getBoundingClientRect();
    const width = tooltipNode.offsetWidth;
    const height = tooltipNode.offsetHeight;
    const padding = 8;
    const offset = 8;
    const fitsRight = anchor.right + offset + width <= innerWidth - padding;
    const side = fitsRight ? 'right' : 'left';
    const preferredLeft = side === 'right' ? anchor.right + offset : anchor.left - offset - width;
    const left = Math.min(Math.max(preferredLeft, padding), Math.max(padding, innerWidth - width - padding));
    const preferredTop = anchor.top + (anchor.height - height) / 2;
    const top = Math.min(Math.max(preferredTop, padding), Math.max(padding, innerHeight - height - padding));
    const arrowY = Math.min(Math.max(anchor.top + anchor.height / 2 - top, 8), height - 8);

    tooltipNode.dataset.side = side;
    tooltipNode.style.left = `${left}px`;
    tooltipNode.style.top = `${top}px`;
    tooltipNode.style.setProperty('--sidebar-tooltip-arrow-y', `${arrowY}px`);
  }

  function showSidebarTooltip(trigger) {
    if (!canShowSidebarTooltip(trigger) || trigger === tooltipTrigger) return;
    hideSidebarTooltip(true);
    const node = document.getElementById(trigger.getAttribute('aria-describedby'));
    if (!node) return;
    tooltipTrigger = trigger;
    tooltipNode = node;
    tooltipHome = { parent: node.parentNode, next: node.nextSibling };
    node.classList.add('floating-sidebar-tooltip');
    document.body.append(node);
    positionSidebarTooltip();
    requestAnimationFrame(() => node.classList.add('is-open'));
  }

  function restoreClosingTooltip() {
    if (!tooltipClosing) return;
    const { node, home, timer } = tooltipClosing;
    clearTimeout(timer);
    tooltipClosing = null;
    node.classList.remove('floating-sidebar-tooltip', 'is-open');
    node.removeAttribute('style');
    if (!home?.parent?.isConnected) return;
    if (home.next?.parentNode === home.parent) home.parent.insertBefore(node, home.next);
    else home.parent.append(node);
  }

  function hideSidebarTooltip(immediate = false) {
    restoreClosingTooltip();
    if (!tooltipNode) return;
    const node = tooltipNode;
    const home = tooltipHome;
    tooltipNode = null;
    tooltipTrigger = null;
    tooltipHome = null;
    node.classList.remove('is-open');
    tooltipClosing = { node, home, timer: 0 };
    if (immediate) restoreClosingTooltip();
    else tooltipClosing.timer = setTimeout(restoreClosingTooltip, 50);
  }

  function toggleSidebar() {
    closeWorkspaceMenu(false);
    const collapsed = !shell.classList.contains('is-collapsed');
    shell.classList.toggle('is-collapsed', collapsed);
    saveCollapsed(collapsed);
    renderSidebar();
  }

  function menuHeader(ws) {
    return `<div class="workspace-menu-header"><span class="workspace-logo">W</span><div class="workspace-menu-heading"><strong>${esc(ws.name)}</strong><small>${esc(ws.email)}</small><span class="role-chip">${icon('shield')} ${esc(ws.role)}</span></div></div>`;
  }

  function workspaceMenuMarkup() {
    const ws = currentWorkspace();
    return `${menuHeader(ws)}<div class="workspace-menu-divider"></div>
      <div class="workspace-menu-items">
        <button class="workspace-menu-item" role="menuitem" data-workspace-menu-action="settings">${settingsHexIcon()}<span>Settings</span></button>
        <button class="workspace-menu-item" role="menuitem" data-workspace-menu-action="members">${icon('userPlus')}<span>Add &amp; manage members</span></button>
        <button class="workspace-menu-item" role="menuitem" data-workspace-menu-action="switch">${icon('building')}<span>Switch workspace</span></button>
      </div>
      <div class="workspace-menu-divider"></div>
      <div class="workspace-menu-items">
        <button class="workspace-menu-item" role="menuitem" data-workspace-menu-action="logout">${icon('logout')}<span>Log out</span></button>
      </div>`;
  }

  function switcherMarkup() {
    const ws = currentWorkspace();
    return `<button class="workspace-menu-item" data-workspace-menu-action="back">${icon('arrow')}<span>Back</span></button><div class="workspace-menu-divider"></div>${menuHeader(ws)}<div class="workspace-menu-divider"></div>${workspaces.map(item => `<button class="workspace-menu-item" role="option" aria-selected="${item.id === workspaceId}" data-workspace-id="${item.id}"><span class="workspace-logo" style="width:18px;height:18px;border-radius:5px;font-size:10px">W</span><span>${esc(item.name)}</span><small>${esc(item.role)}</small></button>`).join('')}`;
  }

  function positionMenu(trigger) {
    if (!menuNode || !trigger) return;
    const rect = trigger.getBoundingClientRect();
    const menuHeight = menuNode.offsetHeight;
    const availableBelow = innerHeight - rect.bottom - viewportPadding;
    const availableAbove = rect.top - viewportPadding;
    const placeAbove = availableBelow < menuHeight + menuOffset && availableAbove > availableBelow;
    const preferredTop = placeAbove ? rect.top - menuHeight - menuOffset : rect.bottom + menuOffset;
    const maxLeft = Math.max(viewportPadding, innerWidth - menuWidth - viewportPadding);
    const maxTop = Math.max(viewportPadding, innerHeight - menuHeight - viewportPadding);

    menuNode.dataset.origin = placeAbove ? 'bottom-left' : 'top-left';
    menuNode.dataset.placement = placeAbove ? 'top-start' : 'bottom-start';
    menuNode.style.left = `${Math.min(Math.max(rect.left, viewportPadding), maxLeft)}px`;
    menuNode.style.top = `${Math.min(Math.max(preferredTop, viewportPadding), maxTop)}px`;
  }

  function openWorkspaceMenu(trigger, keyboard = false) {
    if (menuNode) return closeWorkspaceMenu(true);
    hideSidebarTooltip(true);
    menuTrigger = trigger;
    menuMode = 'menu';
    trigger.setAttribute('aria-expanded', 'true');
    menuNode = document.createElement('div');
    menuNode.className = 'workspace-menu t-dropdown';
    menuNode.dataset.origin = 'top-left';
    menuNode.id = 'workspace-menu';
    menuNode.setAttribute('role', 'menu');
    menuNode.setAttribute('aria-label', 'Workspace menu');
    trigger.setAttribute('aria-controls', menuNode.id);
    menuNode.innerHTML = workspaceMenuMarkup();
    document.body.append(menuNode);
    positionMenu(trigger);
    requestAnimationFrame(() => menuNode?.classList.add('is-open'));
    if (keyboard) requestAnimationFrame(() => menuNode?.querySelector('button')?.focus());
  }

  function closeWorkspaceMenu(returnFocus = false) {
    if (!menuNode) return;
    const closing = menuNode;
    menuNode = null;
    menuTrigger?.setAttribute('aria-expanded', 'false');
    menuTrigger?.removeAttribute('aria-controls');
    closing.classList.remove('is-open');
    closing.classList.add('is-closing');
    setTimeout(() => closing.remove(), closeMs);
    if (returnFocus) menuTrigger?.focus();
  }

  function showSwitcher() {
    if (!menuNode) return;
    menuMode = 'switcher';
    menuNode.setAttribute('role', 'listbox');
    menuNode.setAttribute('aria-label', 'Switch workspace');
    menuNode.innerHTML = switcherMarkup();
    positionMenu(menuTrigger);
    menuNode.querySelector('[data-workspace-id]')?.focus();
  }

  function switchWorkspace(id) {
    if (!menuNode || id === workspaceId) return closeWorkspaceMenu(true);
    menuNode.innerHTML = '<div class="workspace-menu-loading"><i class="spinner"></i>Switching workspace…</div>';
    setTimeout(() => {
      workspaceId = id;
      localStorage.setItem(workspaceKey, id);
      closeWorkspaceMenu(false);
      renderSidebar();
      safeToast(`Switched to ${currentWorkspace().name}`);
    }, 600);
  }

  function navigate(route, label) {
    closeWorkspaceMenu(false);
    if (route === '/orders' && orderCount > 0) {
      orderCount = 0;
      localStorage.setItem(countKey, '0');
    }
    location.hash = route;
    renderSidebar();
    document.querySelector('.mobile-nav')?.remove();
    document.querySelector('.mobile-nav-backdrop')?.remove();
  }

  function safeToast(message, type) {
    if (typeof toast === 'function') toast(message, type);
  }

  function showLogoutConfirmation() {
    closeWorkspaceMenu(false);
    if (typeof modal === 'function') {
      modal('Log out?', 'You will need to sign in again to access this workspace.', '<p class="field-label">This standalone preview has no authenticated session to end.</p>', '<button class="button secondary" data-action="close">Cancel</button><button class="button danger" data-sidebar-action="confirm-logout">Log out</button>');
    }
  }

  function handleMenuAction(action) {
    if (action === 'settings') return navigate('/settings', 'Settings');
    if (action === 'members') return navigate('/settings/team', 'Workspace members');
    if (action === 'switch') return showSwitcher();
    if (action === 'back') {
      menuMode = 'menu';
      menuNode.setAttribute('role', 'menu');
      menuNode.innerHTML = workspaceMenuMarkup();
      menuNode.querySelector('button')?.focus();
      return;
    }
    if (action === 'logout') return showLogoutConfirmation();
  }

  document.addEventListener('click', event => {
    const sidebarAction = event.target.closest('[data-sidebar-action]');
    const routeButton = event.target.closest('[data-sidebar-route]');
    const menuAction = event.target.closest('[data-workspace-menu-action]');
    const workspaceOption = event.target.closest('[data-workspace-id]');
    const legacyWorkspace = event.target.closest('[data-action="business"]');

    if (sidebarAction || routeButton || menuAction || workspaceOption || legacyWorkspace) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }

    if (sidebarAction?.dataset.sidebarAction === 'collapse') return toggleSidebar();
    if (sidebarAction?.dataset.sidebarAction === 'workspace') return openWorkspaceMenu(sidebarAction, event.detail === 0);
    if (sidebarAction?.dataset.sidebarAction === 'confirm-logout') {
      closeOverlay();
      return safeToast('No authenticated session exists in this preview.', 'error');
    }
    if (routeButton) return navigate(routeButton.dataset.sidebarRoute, routeButton.dataset.label || routeButton.textContent.trim());
    if (menuAction) return handleMenuAction(menuAction.dataset.workspaceMenuAction);
    if (workspaceOption) return switchWorkspace(workspaceOption.dataset.workspaceId);
    if (legacyWorkspace) return openWorkspaceMenu(legacyWorkspace, event.detail === 0);
    if (menuNode && !event.target.closest('.workspace-menu') && !event.target.closest('[data-sidebar-action="workspace"]')) closeWorkspaceMenu(false);
  }, true);

  document.addEventListener('pointerover', event => {
    const trigger = event.target.closest('.sidebar-system .t-tt-trigger');
    if (trigger) showSidebarTooltip(trigger);
  }, true);

  document.addEventListener('pointerout', event => {
    if (!tooltipTrigger || !tooltipTrigger.contains(event.target)) return;
    if (event.relatedTarget && tooltipTrigger.contains(event.relatedTarget)) return;
    hideSidebarTooltip();
  }, true);

  document.addEventListener('focusin', event => {
    const trigger = event.target.closest('.sidebar-system .t-tt-trigger');
    if (trigger) showSidebarTooltip(trigger);
  }, true);

  document.addEventListener('focusout', event => {
    if (event.target === tooltipTrigger) hideSidebarTooltip();
  }, true);

  document.addEventListener('keydown', event => {
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '');
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'b') {
      event.preventDefault();
      toggleSidebar();
      return;
    }
    if (event.key === 'Escape' && menuNode) {
      event.preventDefault();
      event.stopImmediatePropagation();
      closeWorkspaceMenu(true);
      return;
    }
    if (event.key === 'Escape' && tooltipNode) hideSidebarTooltip(true);
    if (menuNode && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      const items = [...menuNode.querySelectorAll('button:not(:disabled)')];
      if (!items.length) return;
      event.preventDefault();
      const current = Math.max(0, items.indexOf(document.activeElement));
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[next].focus();
      return;
    }
    if (!typing && shell.classList.contains('is-collapsed') && !event.metaKey && !event.ctrlKey && !event.altKey) {
      const item = navGroups.flatMap(group => group.items).find(entry => entry[3].toLowerCase() === event.key.toLowerCase());
      if (item) {
        event.preventDefault();
        navigate(item[0], item[2]);
      }
    }
  }, true);

  addEventListener('hashchange', renderSidebar);
  addEventListener('resize', () => {
    if (menuNode) positionMenu(menuTrigger);
    if (tooltipNode) positionSidebarTooltip();
  });
  addEventListener('scroll', () => {
    if (menuNode) positionMenu(menuTrigger);
    if (tooltipNode) positionSidebarTooltip();
  }, { passive: true, capture: true });

  shell.classList.add('sidebar-ready');
  renderSidebar();
})();
