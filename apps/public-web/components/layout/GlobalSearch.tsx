'use client'

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import {
  CommandPalette,
  type CommandPaletteFilter,
  type CommandPaletteGroup,
  type CommandPaletteItem,
} from '@hid/ui'
import { HealthIcon, type HealthIconName } from '@/components/shared/HealthIcon'
import { PRODUCTS } from '@/content/products'
import { APP_ENTRY, ROUTES, SOLUTION_AUDIENCES } from '@/content/site'

type SiteSearchItem = CommandPaletteItem & {
  readonly href: string
  /** Authenticated applications remain a full navigation boundary. */
  readonly external?: boolean
}

function item({
  id,
  label,
  category,
  description,
  href,
  icon,
  keywords,
  external,
}: {
  readonly id: string
  readonly label: string
  readonly category: string
  readonly description: string
  readonly href: string
  readonly icon: HealthIconName
  readonly keywords?: readonly string[]
  readonly external?: boolean
}): SiteSearchItem {
  return {
    id,
    label,
    category,
    description,
    href,
    keywords,
    external,
    icon: <HealthIcon name={icon} size={16} />,
  }
}

const SOLUTION_DETAILS: Record<string, string> = {
  hospitals: 'Connected care across departments and branches.',
  clinics: 'Everyday clinical workflows that grow with your practice.',
  'diagnostic-centres': 'Investigations and verified results connected to the right record.',
  pharmacies: 'Prescriptions, dispensing and medication history in one workflow.',
  'public-health-programmes': 'Registration and care delivery for community programmes.',
}

/**
 * Public, non-sensitive destinations only. Patient records and provider data
 * are intentionally absent: the host application owns permissions for those.
 */
const SITE_SEARCH_ITEMS: readonly SiteSearchItem[] = [
  ...PRODUCTS.map(product => item({
    id: `product-${product.slug}`,
    label: product.name,
    category: 'products',
    description: product.summary,
    href: ROUTES.product(product.slug),
    icon: product.slug === 'laboratory' ? 'laboratory'
      : product.slug === 'pharmacy' ? 'medicine'
        : product.slug === 'migrate' ? 'database'
          : product.slug === 'outreach' ? 'location'
            : product.slug === 'api' ? 'code'
              : product.slug === 'identity' ? 'shield'
                : 'dashboard',
    keywords: [product.slug, product.body, ...product.capabilities.map(capability => capability.title)],
  })),
  ...SOLUTION_AUDIENCES.map(audience => item({
    id: `solution-${audience.id}`,
    label: audience.label,
    category: 'solutions',
    description: SOLUTION_DETAILS[audience.id] ?? 'A Health ID workflow for your care setting.',
    href: ROUTES.solution(audience.id),
    icon: audience.id === 'diagnostic-centres' ? 'laboratory'
      : audience.id === 'pharmacies' ? 'medicine'
        : audience.id === 'public-health-programmes' ? 'location'
          : 'hospital',
    keywords: [audience.id.replace(/-/g, ' '), 'care setting'],
  })),
  item({
    id: 'resources',
    label: 'Resources',
    category: 'resources',
    description: 'Browse product, implementation, security and privacy guidance.',
    href: ROUTES.resources,
    icon: 'file',
    keywords: ['guides', 'help', 'documentation'],
  }),
  item({
    id: 'documentation',
    label: 'Documentation',
    category: 'resources',
    description: 'Product, onboarding and integration information.',
    href: ROUTES.documentation,
    icon: 'file',
    keywords: ['implementation', 'onboarding', 'integration', 'API'],
  }),
  item({
    id: 'security',
    label: 'Security and access',
    category: 'resources',
    description: 'How Health ID approaches authorised access and accountability.',
    href: ROUTES.security,
    icon: 'shield',
    keywords: ['consent', 'privacy', 'roles', 'permissions'],
  }),
  item({
    id: 'privacy',
    label: 'Website privacy',
    category: 'resources',
    description: 'What this public website does and does not collect.',
    href: ROUTES.privacy,
    icon: 'shield',
    keywords: ['cookies', 'data collection', 'privacy policy'],
  }),
  item({
    id: 'providers',
    label: 'For healthcare providers',
    category: 'company',
    description: 'Explore connected workflows for facilities and clinical teams.',
    href: ROUTES.providers,
    icon: 'hospital',
    keywords: ['hospital', 'clinic', 'facility', 'provider'],
  }),
  item({
    id: 'patients',
    label: 'For patients',
    category: 'company',
    description: 'Understand your Health ID and how you control access.',
    href: ROUTES.patients,
    icon: 'person',
    keywords: ['health record', 'control', 'identity'],
  }),
  item({
    id: 'pricing',
    label: 'Pricing',
    category: 'company',
    description: 'Talk through a plan for your facility and workflows.',
    href: ROUTES.pricing,
    icon: 'dashboard',
    keywords: ['cost', 'plan', 'quote'],
  }),
  item({
    id: 'about',
    label: 'About Health ID',
    category: 'company',
    description: 'The infrastructure behind connected healthcare.',
    href: ROUTES.about,
    icon: 'activity',
    keywords: ['company', 'mission', 'connected healthcare'],
  }),
  item({
    id: 'contact',
    label: 'Contact Health ID',
    category: 'company',
    description: 'Talk to us about your facility and current workflow.',
    href: ROUTES.contact,
    icon: 'people',
    keywords: ['sales', 'support', 'demo'],
  }),
  item({
    id: 'patient-sign-in',
    label: 'Sign in to your patient account',
    category: 'access',
    description: 'Continue to your patient account in the authenticated Health ID portal.',
    href: APP_ENTRY.patientSignIn,
    icon: 'person',
    keywords: ['patient login', 'my account', 'health information'],
    external: true,
  }),
  item({
    id: 'provider-sign-in',
    label: 'Sign in as a healthcare provider',
    category: 'access',
    description: 'Continue to your provider workspace in the authenticated Health ID portal.',
    href: APP_ENTRY.staffSignIn,
    icon: 'hospital',
    keywords: ['staff login', 'hospital login', 'facility account'],
    external: true,
  }),
]

const SEARCH_GROUPS: readonly CommandPaletteGroup[] = [
  { id: 'products', label: 'Products' },
  { id: 'solutions', label: 'Solutions' },
  { id: 'resources', label: 'Resources' },
  { id: 'company', label: 'Health ID' },
  { id: 'access', label: 'Get started' },
]

const SEARCH_FILTERS: readonly CommandPaletteFilter[] = SEARCH_GROUPS.map(group => ({
  id: group.id,
  label: group.label,
}))

const INITIAL_ITEM_IDS = new Set([
  'providers',
  'patients',
  'product-ehr',
  'documentation',
  'security',
  'contact',
  'patient-sign-in',
])

const INITIAL_SEARCH_ITEMS = SITE_SEARCH_ITEMS.filter(entry => INITIAL_ITEM_IDS.has(entry.id))
const SEARCH_ITEM_BY_ID = new Map(SITE_SEARCH_ITEMS.map(entry => [entry.id, entry]))

type SearchHistory = {
  readonly recentItemIds: readonly string[]
  readonly setRecentItemIds: (ids: readonly string[]) => void
}

const SearchHistoryContext = createContext<SearchHistory | null>(null)

/**
 * Keeps recent public searches only in the current application session.
 * No search terms or destinations are written to browser storage.
 */
export function GlobalSearchProvider({ children }: { readonly children: ReactNode }) {
  const [recentItemIds, setRecentItemIds] = useState<readonly string[]>([])
  const value = useMemo(() => ({ recentItemIds, setRecentItemIds }), [recentItemIds])
  return <SearchHistoryContext.Provider value={value}>{children}</SearchHistoryContext.Provider>
}

/** A lightweight adapter: the shared palette never owns the route table. */
export function GlobalSearch() {
  const router = useRouter()
  const history = useContext(SearchHistoryContext)

  const select = useCallback((selected: CommandPaletteItem) => {
    const destination = SEARCH_ITEM_BY_ID.get(selected.id)
    if (!destination) return

    // Authenticated applications are a deliberate boundary, so they keep the
    // same full navigation behaviour as the existing sign-in links.
    if (destination.external) {
      window.location.assign(destination.href)
      return
    }

    router.push(destination.href)
  }, [router])

  return (
    <CommandPalette
      title="Search Health ID"
      placeholder="Search products, solutions and resources"
      trigger={(
        <button
          type="button"
          aria-label="Search Health ID"
          className="group grid h-11 w-11 place-items-center rounded-full border border-line text-muted transition-[border-color,background-color,color] duration-150 hover:border-brand hover:bg-brand-tint hover:text-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand lg:flex lg:w-auto lg:gap-2 lg:rounded-(--radius-button) lg:px-3"
        >
          <HealthIcon name="search" size={18} />
          <span aria-hidden="true" className="hidden min-[1180px]:inline text-[13px] font-semibold">Search</span>
          <kbd aria-hidden="true" className="hidden min-[1320px]:inline-flex min-h-5 items-center rounded-(--radius-compact) bg-surface-selected px-1.5 font-mono text-[10px] text-muted">⌘ K</kbd>
        </button>
      )}
      groups={SEARCH_GROUPS}
      filters={SEARCH_FILTERS}
      initialItems={INITIAL_SEARCH_ITEMS}
      recentItemIds={history?.recentItemIds}
      onRecentItemIdsChange={history?.setRecentItemIds}
      items={SITE_SEARCH_ITEMS}
      maxResults={10}
      onSelect={select}
    />
  )
}
