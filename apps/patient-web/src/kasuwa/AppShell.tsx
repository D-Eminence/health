/**
 * The app shell of paytrail (components/app-shell.js), shared by the patient portal, the provider EHR and the platform
 * admin: a 264px white sidebar (brand, a switcher card, grouped navigation with icons, the person and their quick
 * actions), a sticky header that blurs what scrolls under it, and on phones a five-slot tab bar in thumb reach with a
 * raised ➕ in the middle (a create sheet) and Menu (every place, as a page).
 */
import { useEffect, useState, type ReactNode } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { ChevronRight, ChevronsUpDown, LogOut, Menu as MenuIcon, Plus, X } from 'lucide-react'
import { Avatar, cx, type Icon } from './ui'
import { ThemeToggle } from './interactive'

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

export function AppShell({ brand, switcher, nav, person, onSignOut, signingOut, headerStart, headerActions, tabs, create, extraFooter, sidebarTop, children, mainAs = 'main', wide }: {
  brand: ReactNode
  switcher: Switcher
  nav: readonly NavGroup[]
  person: { name: string; detail: string; avatar?: ReactNode; profileTo?: string }
  onSignOut: () => void
  signingOut?: boolean
  /** What the header shows on the left, phones and desktop. */
  headerStart?: ReactNode
  headerActions?: ReactNode
  /** Four tabs for phones: two before the ➕ and two after (the last is usually Menu, added by the shell). */
  tabs: readonly [NavItem, NavItem, NavItem]
  create?: { label: string; items: readonly CreateItem[] }
  extraFooter?: ReactNode
  sidebarTop?: ReactNode
  children: ReactNode
  /** 'div' when the shell sits inside a host that already has the page's <main>. */
  mainAs?: 'main' | 'div'
  /** Dense work screens (the EHR) take more width than paytrail's 1200px. */
  wide?: boolean
}) {
  const { pathname } = useLocation()
  const [switching, setSwitching] = useState(false)
  const [creating, setCreating] = useState(false)
  const [menu, setMenu] = useState(false)
  useEffect(() => { setSwitching(false); setCreating(false); setMenu(false) }, [pathname])
  const [folded, setFolded] = useState<Record<string, boolean>>({})
  const holdsCurrent = (group: NavGroup) => group.items.some(item => item.end ? pathname === item.to : pathname === item.to || pathname.startsWith(`${item.to}/`))
  const isOpen = (group: NavGroup) => !group.collapsible || !group.title ? true
    : folded[group.title] !== undefined ? !folded[group.title] : group.defaultOpen === true || holdsCurrent(group)

  const navLink = (item: NavItem) => (
    <NavLink to={item.to} end={item.end} className={({ isActive }) => cx('relative flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium no-underline transition-colors duration-75',
      isActive ? 'bg-brand-soft text-brand-ink' : 'text-ink-2 hover:bg-hover hover:text-ink')}>
      {({ isActive }) => <>
        <item.icon className={cx('size-[18px] shrink-0', isActive ? 'text-brand' : 'text-ink-3')} aria-hidden />
        <span className="min-w-0 flex-1 truncate">{item.label}</span>
        {item.badge ? <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1.5 text-[11px] font-semibold text-white tabular" aria-label={`${item.badge} new`}>{item.badge}</span> : null}
      </>}
    </NavLink>
  )

  const sidebar = <div className="flex h-full flex-col">
    <div className="flex items-center px-5 pt-5 pb-1">{brand}</div>
    {sidebarTop}
    <div className="relative px-3 pt-4 pb-2">
      <button type="button" onClick={() => switcher.menu && setSwitching(v => !v)} aria-expanded={switcher.menu ? switching : undefined} disabled={!switcher.menu}
        className={cx('flex w-full items-center gap-3 rounded-lg border-0 bg-transparent p-2 text-left ring-1 ring-transparent', switcher.menu && 'cursor-pointer hover:bg-hover hover:ring-line', !switcher.menu && 'cursor-default')}>
        {switcher.avatar ?? <Avatar name={switcher.name} />}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-ink">{switcher.name}</span>
          <span className="block truncate text-xs text-ink-3">{switcher.subtitle}</span>
        </span>
        {switcher.menu && <ChevronsUpDown className="size-4 shrink-0 text-ink-3" aria-hidden />}
      </button>
      {switching && switcher.menu && <div className="absolute inset-x-3 top-full z-30 mt-1 animate-rise rounded-xl bg-surface p-1.5 shadow-[var(--shadow-pop)] ring-1 ring-line">
        {switcher.menu(() => setSwitching(false))}
      </div>}
    </div>
    <nav className="flex-1 overflow-y-auto px-3 pb-4 scroll-thin" aria-label="Main">
      {nav.map((group, i) => { const open = isOpen(group)
        return <div key={group.title ?? i} className="mt-4 first:mt-1">
          {group.title && (group.collapsible
            ? <button type="button" aria-expanded={open} onClick={() => setFolded(f => ({ ...f, [group.title!]: open }))}
                className="flex w-full cursor-pointer items-center justify-between rounded-md border-0 bg-transparent px-3 pb-1.5 text-left text-overline text-ink-3 hover:text-ink">
                {group.title}<ChevronRight className={cx('size-3.5 transition-transform', open && 'rotate-90')} aria-hidden /></button>
            : <p className="m-0 px-3 pb-1.5 text-overline text-ink-3">{group.title}</p>)}
          {open && <ul className="m-0 list-none space-y-0.5 p-0">{group.items.map(item => <li key={item.to}>{navLink(item)}</li>)}</ul>}
        </div> })}
    </nav>
    {extraFooter}
    <div className="border-t border-line p-3">
      <div className="flex items-center gap-3 rounded-lg p-2">
        {person.avatar ?? <Avatar name={person.name} size="sm" />}
        <span className="min-w-0 flex-1">
          {person.profileTo
            ? <Link to={person.profileTo} className="block truncate text-[13px] font-medium text-ink no-underline hover:underline">{person.name}</Link>
            : <span className="block truncate text-[13px] font-medium text-ink">{person.name}</span>}
          <span className="block truncate text-xs text-ink-3">{person.detail}</span>
        </span>
        <button type="button" onClick={onSignOut} disabled={signingOut} aria-label="Sign out" title="Sign out"
          className="inline-flex size-8 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-ink-3 hover:bg-hover hover:text-ink disabled:opacity-50">
          <LogOut className="size-4" aria-hidden />
        </button>
      </div>
    </div>
  </div>

  const row = 'flex min-h-14 items-center gap-3.5 px-4 py-2.5 text-[15px] font-medium text-ink no-underline hover:bg-hover'
  const menuPage = <div className="mx-auto flex max-w-xl flex-col gap-5 pb-4">
    <div className="flex items-center justify-between"><h1 className="m-0 text-title-1 text-ink">Menu</h1>
      <button type="button" onClick={() => setMenu(false)} aria-label="Close menu" className="inline-flex size-10 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-ink-2 ring-1 ring-line-strong ring-inset"><X className="size-5" /></button></div>
    <div className="overflow-hidden rounded-2xl bg-surface ring-1 ring-line">
      <div className="flex items-center gap-3.5 px-4 py-4">{switcher.avatar ?? <Avatar name={switcher.name} />}
        <div className="min-w-0 flex-1"><p className="m-0 truncate text-[16px] font-semibold text-ink">{switcher.name}</p><p className="m-0 truncate text-[13px] text-ink-3">{switcher.subtitle}</p></div></div>
      {switcher.menu && <div className="border-t border-line p-1.5">{switcher.menu(() => setMenu(false))}</div>}
    </div>
    {nav.map((group, i) => <div key={group.title ?? i}>
      {group.title && <p className="m-0 px-1 pb-2 text-overline text-ink-3">{group.title}</p>}
      <ul className="m-0 list-none divide-y divide-line overflow-hidden rounded-2xl bg-surface p-0 ring-1 ring-line">
        {group.items.map(item => <li key={item.to}><Link to={item.to} className={row}>
          <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-subtle text-ink-2"><item.icon className="size-[18px]" aria-hidden /></span>
          <span className="min-w-0 flex-1 truncate">{item.label}</span>
          {item.badge ? <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1.5 text-[11px] font-semibold text-white">{item.badge}</span> : null}
          <ChevronRight className="size-4 shrink-0 text-ink-3" aria-hidden /></Link></li>)}
      </ul>
    </div>)}
    <div className="overflow-hidden rounded-2xl bg-surface ring-1 ring-line"><div className="px-2 py-1"><ThemeToggle row /></div></div>
    <div className="flex items-center gap-3 rounded-2xl bg-surface px-4 py-3 ring-1 ring-line">
      {person.avatar ?? <Avatar name={person.name} size="sm" />}
      <span className="min-w-0 flex-1"><span className="block truncate text-[14px] font-medium text-ink">{person.name}</span><span className="block truncate text-[12.5px] text-ink-3">{person.detail}</span></span>
      <button type="button" onClick={onSignOut} disabled={signingOut} className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-xl border-0 bg-transparent px-3.5 text-[14px] font-medium text-danger-ink ring-1 ring-line ring-inset hover:bg-danger-soft"><LogOut className="size-4" aria-hidden />{signingOut ? 'Signing out…' : 'Sign out'}</button>
    </div>
  </div>

  const tabCls = (on: boolean) => cx('flex flex-col items-center gap-0.5 pt-2 pb-1.5 text-[11px] font-medium no-underline', on ? 'text-brand-ink' : 'text-ink-3')
  const tabInner = (item: Pick<NavItem, 'icon' | 'label' | 'badge'>, on: boolean) => <>
    <span className={cx('relative inline-flex h-7 w-12 items-center justify-center rounded-full transition-colors', on && 'bg-brand-soft')}>
      <item.icon className="size-5" aria-hidden />
      {item.badge ? <span className="absolute -top-1 right-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-brand px-1 text-[10px] font-semibold text-white ring-2 ring-surface">{item.badge}</span> : null}
    </span>{item.label}</>

  return <div className="min-h-dvh bg-canvas">
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-[264px] border-r border-line bg-surface lg:block">{sidebar}</aside>
    {creating && create && <div className="fixed inset-0 z-40 lg:hidden">
      <div className="absolute inset-0 animate-fade-in bg-[#101828]/45" onClick={() => setCreating(false)} />
      <div role="dialog" aria-modal="true" aria-label={create.label} className="absolute inset-x-0 bottom-0 animate-rise rounded-t-3xl bg-surface px-3 pt-2.5 pb-[calc(env(safe-area-inset-bottom)+12px)] shadow-[var(--shadow-dialog)]">
        <div className="flex justify-center pb-2"><span aria-hidden="true" className="h-1.5 w-10 rounded-full bg-line-strong" /></div>
        <ul className="m-0 flex list-none flex-col p-0">{create.items.map(c => <li key={c.to}>
          <Link to={c.to} onClick={() => setCreating(false)} className="flex min-h-14 items-center gap-3.5 rounded-2xl px-3 py-2.5 no-underline hover:bg-hover">
            <span className={cx('inline-flex size-10 shrink-0 items-center justify-center rounded-xl', c.main ? 'bg-brand text-white' : 'bg-brand-soft text-brand-ink')}><c.icon className="size-5" aria-hidden /></span>
            <span className="min-w-0"><span className="block text-[15px] font-semibold text-ink">{c.label}</span><span className="block text-[12.5px] text-ink-3">{c.hint}</span></span>
          </Link></li>)}</ul>
        <button type="button" onClick={() => setCreating(false)} className="mt-1 flex h-12 w-full cursor-pointer items-center justify-center rounded-2xl border-0 bg-transparent text-[15px] font-medium text-ink-2 ring-1 ring-line ring-inset">Cancel</button>
      </div>
    </div>}
    <div className="lg:pl-[264px]">
      <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-line bg-canvas/85 px-4 backdrop-blur sm:px-6 lg:px-8">
        <div className="flex min-w-0 items-center gap-2.5">{headerStart}</div>
        <div className="flex-1" />
        <div className="flex items-center gap-2">
          <ThemeToggle className="max-lg:hidden" />
          {headerActions}
          {/* No menu button here: Menu is the tab bar's, in thumb reach (one way to every place, not two). */}
        </div>
      </header>
      {mainAs === 'main'
        ? <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[1200px] px-4 py-6 outline-none sm:px-6 lg:px-8 lg:py-8 max-lg:pb-28">{menu ? menuPage : children}</main>
        : <div className={cx('mx-auto w-full px-4 py-6 sm:px-6 lg:px-8 lg:py-8 max-lg:pb-28', wide ? 'max-w-[1440px]' : 'max-w-[1200px]')}>{menu ? menuPage : children}</div>}
    </div>
    <nav aria-label="Quick" className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden print:hidden">
      <div className="mx-auto grid max-w-xl grid-cols-5 items-end">
        {tabs.slice(0, 2).map(t => <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => tabCls(isActive && !menu)}>{({ isActive }) => tabInner(t, isActive && !menu)}</NavLink>)}
        <div className="flex justify-center pb-1.5">
          {create ? <button type="button" onClick={() => setCreating(true)} aria-label={create.label}
            className="-mt-5 inline-flex size-14 cursor-pointer items-center justify-center rounded-full border-0 bg-brand text-white shadow-[0_10px_24px_-8px_rgba(23,92,211,.7)] ring-4 ring-surface transition-transform active:scale-95"><Plus className="size-7" aria-hidden /></button> : <span />}
        </div>
        <NavLink to={tabs[2].to} end={tabs[2].end} className={({ isActive }) => tabCls(isActive && !menu)}>{({ isActive }) => tabInner(tabs[2], isActive && !menu)}</NavLink>
        <button type="button" onClick={() => setMenu(v => !v)} aria-pressed={menu} className={cx(tabCls(menu), 'cursor-pointer border-0 bg-transparent')}>{tabInner({ icon: MenuIcon, label: 'Menu' }, menu)}</button>
      </div>
    </nav>
  </div>
}
