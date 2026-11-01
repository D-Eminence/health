/**
 * The app shell shared by the patient portal, the provider EHR and the platform admin.
 *
 * Desktop: a calm sidebar that folds to an icon rail (the owner's references, 2026-10-31): the brand and a fold button,
 * the switcher, places grouped with thin dividers (Hick's law; groups fold), the current place as a soft pill, counts as
 * small ink pills, then the light/dark switch, then the person last with a ⋯ menu that holds Sign out (serial position:
 * the destructive action last and out of the easy path). One background per mode: sidebar, header and page share the
 * surface colour and are told apart by hairlines only (owner, 2026-10-31).
 *
 * Phones: a tab bar in thumb reach (two tabs, a raised ➕ when there is something to start, one tab, Menu). Menu is a page
 * of its own (#menu), so the Back button closes it.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { ChevronRight, ChevronsUpDown, LogOut, Menu as MenuIcon, MoreHorizontal, PanelLeftClose, PanelLeftOpen, Plus, UserRound, X } from 'lucide-react'
import { Avatar, cx, type Icon } from './ui'
import { ThemeSwitch } from './interactive'

/** Whether the sidebar is folded to its rail: kept for the visit only (nothing is stored in the browser). */
let railed = false

export interface NavItem {
  readonly to: string
  readonly label: string
  readonly icon: Icon
  readonly end?: boolean
  readonly badge?: number
  /** For a link that leaves the router (another app): opens normally. */
  readonly external?: boolean
}
export interface NavGroup {
  readonly title?: string
  readonly items: readonly NavItem[]
  /** A long list's group can fold (Hick's Law): open while it holds the current page, or when `defaultOpen`. */
  readonly collapsible?: boolean
  readonly defaultOpen?: boolean
}
export interface CreateItem { readonly to: string; readonly label: string; readonly hint: string; readonly icon: Icon; readonly main?: boolean }
export interface Switcher {
  readonly name: string
  readonly subtitle: string
  readonly avatar?: ReactNode
  /** What the switcher opens (other facilities, a link to the profile); none makes it a plain card. */
  readonly menu?: (close: () => void) => ReactNode
}

export function AppShell({ brand, switcher, nav, person, onSignOut, signingOut, headerStart, headerActions, tabs, create, extraFooter, sidebarTop, children, mainAs = 'main', wide, skipLink }: {
  brand: ReactNode
  switcher: Switcher
  nav: readonly NavGroup[]
  person: { name: string; detail: string; avatar?: ReactNode; profileTo?: string }
  onSignOut: () => void
  signingOut?: boolean
  /** What the header shows on the left, phones and desktop. */
  headerStart?: ReactNode
  headerActions?: ReactNode
  /** Three tabs for phones: two before the ➕ and one after (Menu is added by the shell). */
  tabs: readonly NavItem[]
  create?: { label: string; items: readonly CreateItem[] }
  extraFooter?: ReactNode
  sidebarTop?: ReactNode
  children: ReactNode
  /** 'div' when the shell sits inside a host that already has the page's <main>. */
  mainAs?: 'main' | 'div'
  /** Dense work screens (the EHR) take more width than paytrail's 1200px. */
  wide?: boolean
  /**
   * The text of a "skip to content" link, the first thing a keyboard reaches: it jumps past the navigation to <main>.
   * Shown only while focused. Needs mainAs 'main' (the link's target is the shell's own <main>).
   */
  skipLink?: string
}) {
  const { pathname, hash, search } = useLocation()
  const navigate = useNavigate()
  const [switching, setSwitching] = useState(false)
  const [creating, setCreating] = useState(false)
  const [personMenu, setPersonMenu] = useState(false)
  // The ⋯ button that opens the person menu: Sign out closes the menu, so focus goes back to it (a failed sign-out
  // leaves the person where they were, not on the page).
  const personButton = useRef<HTMLButtonElement>(null)
  const [rail, setRailState] = useState(railed)
  const setRail = (next: boolean) => { railed = next; setRailState(next) }
  // Menu is a page of its own, at #menu: the Back button closes it, as people expect.
  const menu = hash === '#menu'
  const openMenu = () => navigate({ pathname, search, hash: 'menu' })
  const closeMenu = () => navigate(-1)
  // Leaving a page closes its menus. Only a real change of address does: on mount there is nothing to close, and a
  // close run then would undo a menu opened before the effect ran.
  const shownPath = useRef(pathname)
  useEffect(() => {
    if (shownPath.current === pathname) return
    shownPath.current = pathname
    setSwitching(false); setCreating(false); setPersonMenu(false)
  }, [pathname])
  const [folded, setFolded] = useState<Record<string, boolean>>({})
  const holdsCurrent = (group: NavGroup) => group.items.some(item => item.end ? pathname === item.to : pathname === item.to || pathname.startsWith(`${item.to}/`))
  const isOpen = (group: NavGroup) => !group.collapsible || !group.title ? true
    : folded[group.title] !== undefined ? !folded[group.title] : group.defaultOpen === true || holdsCurrent(group)

  // The create sheet: Escape closes it, and focus moves into it as it opens and back to ➕ as it closes.
  const sheet = useRef<HTMLDivElement>(null)
  const plus = useRef<HTMLButtonElement>(null)
  useLayoutEffect(() => {
    if (!creating) return
    sheet.current?.querySelector<HTMLElement>('a,button')?.focus()
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setCreating(false) }
    document.addEventListener('keydown', onKey)
    const back = plus.current
    return () => { document.removeEventListener('keydown', onKey); back?.focus() }
  }, [creating])

  const badge = (count: number) => <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-ink px-1.5 text-[11px] font-semibold text-surface tabular" aria-label={`${count} new`}>{count}</span>

  const navLink = (item: NavItem) => (
    <NavLink to={item.to} end={item.end} title={rail ? item.label : undefined}
      className={({ isActive }) => cx('relative flex h-11 items-center gap-3 rounded-xl no-underline transition-colors duration-75',
        rail ? 'mx-auto w-11 justify-center' : 'px-3 text-sm font-medium',
        isActive ? 'bg-hover font-semibold text-ink' : 'text-ink-2 hover:bg-hover/60 hover:text-ink')}>
      {({ isActive }) => <>
        <item.icon className={cx('size-[19px] shrink-0', isActive ? 'text-ink' : 'text-ink-3')} aria-hidden strokeWidth={isActive ? 2.2 : 1.8} />
        {rail ? <span className="sr-only">{item.label}</span> : <span className="min-w-0 flex-1 truncate">{item.label}</span>}
        {item.badge ? (rail ? <span className="absolute top-2 right-2 size-2 rounded-full bg-danger ring-2 ring-surface" aria-label={`${item.badge} new`} /> : <span className="ml-auto">{badge(item.badge)}</span>) : null}
      </>}
    </NavLink>
  )

  const sidebar = <div className="flex h-full flex-col">
    <div className={cx('flex items-center pt-5 pb-2', rail ? 'justify-center px-2' : 'justify-between gap-2 px-5')}>
      {rail ? null : <div className="min-w-0">{brand}</div>}
      <button type="button" onClick={() => setRail(!rail)} aria-label={rail ? 'Expand the menu' : 'Collapse the menu'} title={rail ? 'Expand' : 'Collapse'} aria-expanded={!rail}
        className="inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-lg border-0 bg-transparent text-ink-3 hover:bg-hover hover:text-ink">
        {rail ? <PanelLeftOpen className="size-[18px]" aria-hidden /> : <PanelLeftClose className="size-[18px]" aria-hidden />}</button>
    </div>
    {rail ? null : sidebarTop}
    <div className={cx('relative pt-2 pb-2', rail ? 'flex justify-center px-2' : 'px-3')}>
      <button type="button" onClick={() => switcher.menu && setSwitching(v => !v)} aria-expanded={switcher.menu ? switching : undefined} disabled={!switcher.menu}
        title={rail ? `${switcher.name} · ${switcher.subtitle}` : undefined}
        className={cx('flex items-center gap-3 rounded-xl border-0 bg-transparent text-left', rail ? 'p-1' : 'w-full p-2', switcher.menu && 'cursor-pointer hover:bg-hover', !switcher.menu && 'cursor-default')}>
        {switcher.avatar ?? <Avatar name={switcher.name} />}
        {rail ? <span className="sr-only">{switcher.name}</span> : <>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-ink">{switcher.name}</span>
            <span className="block truncate text-xs text-ink-3">{switcher.subtitle}</span>
          </span>
          {switcher.menu && <ChevronsUpDown className="size-4 shrink-0 text-ink-3" aria-hidden />}
        </>}
      </button>
      {switching && switcher.menu && <div className={cx('absolute top-full z-[var(--z-dropdown)] mt-1 animate-rise rounded-xl bg-surface p-1.5 shadow-[var(--shadow-pop)] ring-1 ring-line', rail ? 'left-2 w-60' : 'inset-x-3')}>
        {switcher.menu(() => setSwitching(false))}
      </div>}
    </div>
    <nav className={cx('flex-1 overflow-y-auto pb-4 scroll-thin', rail ? 'px-2' : 'px-3')} aria-label="Main navigation">
      {nav.map((group, i) => { const open = rail || isOpen(group)
        // Groups are told apart by a thin divider (common region without boxes); a title names them when open.
        return <div key={group.title ?? i} className={cx(i > 0 && 'mt-2 border-t border-line pt-2')}>
          {group.title && !rail && (group.collapsible
            ? <button type="button" aria-expanded={open} onClick={() => setFolded(f => ({ ...f, [group.title!]: open }))}
                className="flex h-8 w-full cursor-pointer items-center justify-between rounded-md border-0 bg-transparent px-3 text-left text-[12px] font-medium text-ink-3 hover:text-ink">
                {group.title}<ChevronRight className={cx('size-3.5 transition-transform', open && 'rotate-90')} aria-hidden /></button>
            : <p className="m-0 flex h-8 items-center px-3 text-[12px] font-medium text-ink-3">{group.title}</p>)}
          {open && <ul className="m-0 list-none space-y-0.5 p-0">{group.items.map(item => <li key={item.to}>{navLink(item)}</li>)}</ul>}
        </div> })}
    </nav>
    {rail ? null : extraFooter}
    <div className={cx('border-t border-line', rail ? 'flex flex-col items-center gap-3 px-2 py-3' : 'flex flex-col gap-3 p-3')}>
      <ThemeSwitch vertical={rail} />
      <div className="relative">
        <div className={cx('flex items-center gap-3 rounded-xl', rail ? 'justify-center' : 'p-1.5')}>
          {rail ? null : <>
            {person.avatar ?? <Avatar name={person.name} size="sm" />}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium text-ink">{person.name}</span>
              <span className="block truncate text-xs text-ink-3">{person.detail}</span>
            </span>
          </>}
          <button ref={personButton} type="button" onClick={() => setPersonMenu(v => !v)} aria-expanded={personMenu} aria-label={`${person.name}: account`} title={rail ? person.name : 'Account'}
            className={cx('inline-flex shrink-0 cursor-pointer items-center justify-center rounded-lg border-0 bg-transparent text-ink-3 hover:bg-hover hover:text-ink', rail ? 'size-11' : 'size-9')}>
            {rail ? (person.avatar ?? <Avatar name={person.name} size="sm" />) : <MoreHorizontal className="size-[18px]" aria-hidden />}</button>
        </div>
        {personMenu && <div className={cx('absolute bottom-full z-[var(--z-dropdown)] mb-2 w-56 animate-rise rounded-xl bg-surface p-1.5 shadow-[var(--shadow-pop)] ring-1 ring-line', rail ? 'left-0' : 'right-0')}>
          {person.profileTo ? <Link to={person.profileTo} onClick={() => setPersonMenu(false)} className="flex h-10 items-center gap-2.5 rounded-md px-2.5 text-sm text-ink no-underline hover:bg-hover"><UserRound className="size-4 text-ink-3" aria-hidden />Your profile</Link> : null}
          <button type="button" onClick={() => { setPersonMenu(false); personButton.current?.focus(); onSignOut() }} disabled={signingOut}
            className="flex h-10 w-full cursor-pointer items-center gap-2.5 rounded-md border-0 bg-transparent px-2.5 text-left text-sm text-danger-ink hover:bg-danger-soft disabled:opacity-50"><LogOut className="size-4" aria-hidden />{signingOut ? 'Signing out…' : 'Sign out'}</button>
        </div>}
      </div>
    </div>
  </div>

  const row = 'flex min-h-14 items-center gap-3.5 px-4 py-2.5 text-[15px] font-medium text-ink no-underline hover:bg-hover'
  const menuPage = <div className="mx-auto flex max-w-xl flex-col gap-5 pb-4">
    <div className="flex items-center justify-between"><h1 className="m-0 text-title-1 text-ink">Menu</h1>
      <button type="button" onClick={closeMenu} aria-label="Close menu" className="inline-flex size-11 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-ink-2 ring-1 ring-line-control ring-inset"><X className="size-5" /></button></div>
    <div className="overflow-hidden rounded-2xl bg-surface ring-1 ring-line">
      <div className="flex items-center gap-3.5 px-4 py-4">{switcher.avatar ?? <Avatar name={switcher.name} />}
        <div className="min-w-0 flex-1"><p className="m-0 truncate text-[16px] font-semibold text-ink">{switcher.name}</p><p className="m-0 truncate text-[13px] text-ink-3">{switcher.subtitle}</p></div></div>
      {switcher.menu && <div className="border-t border-line p-1.5">{switcher.menu(() => undefined)}</div>}
    </div>
    {nav.map((group, i) => <div key={group.title ?? i}>
      {group.title && <p className="m-0 px-1 pb-2 text-[13px] font-medium text-ink-3">{group.title}</p>}
      <ul className="m-0 list-none divide-y divide-line overflow-hidden rounded-2xl bg-surface p-0 ring-1 ring-line">
        {group.items.map(item => <li key={item.to}><Link to={item.to} className={row}>
          <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-tray text-ink-2"><item.icon className="size-[18px]" aria-hidden /></span>
          <span className="min-w-0 flex-1 truncate">{item.label}</span>
          {item.badge ? badge(item.badge) : null}
          <ChevronRight className="size-4 shrink-0 text-ink-3" aria-hidden /></Link></li>)}
      </ul>
    </div>)}
    <ThemeSwitch />
    <div className="flex items-center gap-3 rounded-2xl bg-surface px-4 py-3 ring-1 ring-line">
      {person.avatar ?? <Avatar name={person.name} size="sm" />}
      <span className="min-w-0 flex-1"><span className="block truncate text-[15px] font-medium text-ink">{person.name}</span><span className="block truncate text-[13px] text-ink-3">{person.detail}</span></span>
      <button type="button" onClick={onSignOut} disabled={signingOut} className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-xl border-0 bg-transparent px-3.5 text-[14px] font-medium text-danger-ink ring-1 ring-line ring-inset hover:bg-danger-soft"><LogOut className="size-4" aria-hidden />{signingOut ? 'Signing out…' : 'Sign out'}</button>
    </div>
  </div>

  const tabCls = (on: boolean) => cx('flex min-h-14 flex-col items-center justify-end gap-0.5 pt-2 pb-1.5 text-[12px] font-medium no-underline', on ? 'text-ink' : 'text-ink-3')
  const tabInner = (item: Pick<NavItem, 'icon' | 'label' | 'badge'>, on: boolean) => <>
    <span className={cx('relative inline-flex h-7 w-12 items-center justify-center rounded-full transition-colors', on && 'bg-hover')}>
      <item.icon className="size-5" aria-hidden strokeWidth={on ? 2.2 : 1.8} />
      {item.badge ? <span className="absolute -top-1 right-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-danger-fill px-1 text-[10px] font-semibold text-white ring-2 ring-surface">{item.badge}</span> : null}
    </span>{item.label}</>
  const sidebarWidth = rail ? 'w-[76px]' : 'w-[264px]'

  return <div className="min-h-dvh bg-surface">
    {skipLink && mainAs === 'main' && <a href="#main" onClick={event => { event.preventDefault(); document.getElementById('main')?.focus() }}
      className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[var(--z-toast)] focus:rounded-md focus:bg-surface focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-ink focus:ring-2 focus:ring-brand">{skipLink}</a>}
    <aside className={cx('fixed inset-y-0 left-0 z-30 hidden border-r border-line bg-surface transition-[width] duration-200 lg:block', sidebarWidth)}>{sidebar}</aside>
    {creating && create && <div className="fixed inset-0 z-[var(--z-drawer)] lg:hidden">
      <div className="absolute inset-0 animate-fade-in bg-[#101828]/45" onClick={() => setCreating(false)} />
      <div ref={sheet} role="dialog" aria-modal="true" aria-label={create.label} className="absolute inset-x-0 bottom-0 animate-rise rounded-t-3xl bg-surface px-3 pt-2.5 pb-[calc(env(safe-area-inset-bottom)+12px)] shadow-[var(--shadow-dialog)]">
        <div className="flex justify-center pb-2"><span aria-hidden="true" className="h-1.5 w-10 rounded-full bg-line-strong" /></div>
        <ul className="m-0 flex list-none flex-col p-0">{create.items.map(c => <li key={c.to}>
          <Link to={c.to} onClick={() => setCreating(false)} className="flex min-h-14 items-center gap-3.5 rounded-2xl px-3 py-2.5 no-underline hover:bg-hover">
            <span className={cx('inline-flex size-10 shrink-0 items-center justify-center rounded-xl', c.main ? 'bg-brand-fill text-white' : 'bg-brand-soft text-brand-ink')}><c.icon className="size-5" aria-hidden /></span>
            <span className="min-w-0"><span className="block text-[15px] font-semibold text-ink">{c.label}</span><span className="block text-[13px] text-ink-3">{c.hint}</span></span>
          </Link></li>)}</ul>
        <button type="button" onClick={() => setCreating(false)} className="mt-1 flex h-12 w-full cursor-pointer items-center justify-center rounded-2xl border-0 bg-transparent text-[15px] font-medium text-ink-2 ring-1 ring-line ring-inset">Cancel</button>
      </div>
    </div>}
    <div className={cx('transition-[padding] duration-200', rail ? 'lg:pl-[76px]' : 'lg:pl-[264px]')}>
      {/* The header: shown on phones (brand, actions); on a computer only when it carries something. */}
      <header className={cx('sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-line bg-surface px-4 sm:px-6 lg:px-8', !headerStart && !headerActions && 'lg:hidden')}>
        <div className="flex min-w-0 items-center gap-2.5">{headerStart}</div>
        <div className="flex-1" />
        <div className="flex items-center gap-2">{headerActions}</div>
      </header>
      {mainAs === 'main'
        ? <main id="main" tabIndex={-1} className="@container mx-auto w-full max-w-[1200px] px-4 py-6 outline-none sm:px-6 lg:px-8 lg:py-8 max-lg:pb-28">{menu ? menuPage : children}</main>
        : <div className={cx('@container mx-auto w-full px-4 py-6 sm:px-6 lg:px-8 lg:py-8 max-lg:pb-28', wide ? 'max-w-[1440px]' : 'max-w-[1200px]')}>{menu ? menuPage : children}</div>}
    </div>
    <nav aria-label="Quick" className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden print:hidden">
      {/* Four places when there is nothing to start; with ➕ in the middle when there is. */}
      {/* Up to three places, Menu last; ➕ in the middle when there is something to start. */}
      <div className="mx-auto grid max-w-xl items-end" style={{ gridTemplateColumns: `repeat(${Math.min(tabs.length, 3) + 1 + (create ? 1 : 0)}, minmax(0, 1fr))` }}>
        {tabs.slice(0, 2).map(t => <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => tabCls(isActive && !menu)}>{({ isActive }) => tabInner(t, isActive && !menu)}</NavLink>)}
        {create ? <div className="flex justify-center pb-1.5">
          <button ref={plus} type="button" onClick={() => setCreating(true)} aria-label={create.label}
            className="-mt-5 inline-flex size-14 cursor-pointer items-center justify-center rounded-full border-0 bg-brand-fill text-white shadow-[0_10px_24px_-8px_rgba(23,92,211,.7)] ring-4 ring-surface transition-transform active:scale-95"><Plus className="size-7" aria-hidden /></button>
        </div> : null}
        {tabs[2] ? <NavLink to={tabs[2].to} end={tabs[2].end} className={({ isActive }) => tabCls(isActive && !menu)}>{({ isActive }) => tabInner(tabs[2]!, isActive && !menu)}</NavLink> : null}
        <button type="button" onClick={() => menu ? closeMenu() : openMenu()} aria-pressed={menu} className={cx(tabCls(menu), 'cursor-pointer border-0 bg-transparent')}>{tabInner({ icon: MenuIcon, label: 'Menu' }, menu)}</button>
      </div>
    </nav>
  </div>
}
