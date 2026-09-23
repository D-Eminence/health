'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { Card, Display, Section, SectionHeader, Wrap } from '@hid/ui'
import {
  ABOUT_PAGE,
  CONTACT_PAGE,
  DOCUMENTATION_PAGE,
  PRIVACY_PAGE,
  SECURITY_PAGE,
  SOLUTIONS_PAGE,
} from '@/content/pages'
import { PRODUCTS } from '@/content/products'
import { ROUTES } from '@/content/site'

type ResourceCategory =
  | 'Understanding Health ID'
  | 'Product guides'
  | 'Implementation'
  | 'Security & privacy'
  | 'Help'

type ResourceItem = {
  readonly category: ResourceCategory
  readonly kind: string
  readonly title: string
  readonly description: string
  readonly href: string
  /** Search-only terms cover questions whose wording differs from a card title. */
  readonly keywords?: readonly string[]
}

const CATEGORY_ORDER: readonly ResourceCategory[] = [
  'Understanding Health ID',
  'Product guides',
  'Implementation',
  'Security & privacy',
  'Help',
]

const PRODUCT_GUIDES: readonly ResourceItem[] = PRODUCTS.map(product => ({
  category: 'Product guides',
  kind: 'Product guide',
  title: product.name,
  description: product.body,
  href: ROUTES.product(product.slug),
}))

/**
 * Every entry points to a published page. Descriptions come from the page's
 * source content, so this index never becomes a second documentation system.
 */
const RESOURCES: readonly ResourceItem[] = [
  {
    category: 'Understanding Health ID',
    kind: 'Overview',
    title: ABOUT_PAGE.title,
    description: ABOUT_PAGE.lede,
    href: ROUTES.about,
  },
  {
    category: 'Understanding Health ID',
    kind: 'Solution guide',
    title: SOLUTIONS_PAGE.title,
    description: SOLUTIONS_PAGE.lede,
    href: ROUTES.solutions,
  },
  ...PRODUCT_GUIDES,
  {
    category: 'Implementation',
    kind: 'Documentation',
    title: DOCUMENTATION_PAGE.title,
    description: DOCUMENTATION_PAGE.lede,
    href: ROUTES.documentation,
    keywords: ['getting started', 'onboarding', 'implementation', 'roles and permissions'],
  },
  {
    category: 'Implementation',
    kind: 'Implementation guide',
    title: DOCUMENTATION_PAGE.sections[1].title,
    description: DOCUMENTATION_PAGE.sections[1].body,
    href: ROUTES.documentation,
    keywords: ['getting started', 'onboarding', 'roles', 'permissions'],
  },
  {
    category: 'Implementation',
    kind: 'Integration guide',
    title: DOCUMENTATION_PAGE.sections[2].title,
    description: DOCUMENTATION_PAGE.sections[2].body,
    href: ROUTES.documentation,
    keywords: ['integration', 'EHR', 'API', 'existing healthcare software'],
  },
  {
    category: 'Security & privacy',
    kind: 'Security',
    title: SECURITY_PAGE.title,
    description: SECURITY_PAGE.lede,
    href: ROUTES.security,
    keywords: ['consent', 'access controls', 'audit history', 'emergency access', 'patient PIN', 'roles and permissions'],
  },
  {
    category: 'Security & privacy',
    kind: 'Privacy',
    title: PRIVACY_PAGE.title,
    description: PRIVACY_PAGE.lede,
    href: ROUTES.privacy,
  },
  {
    category: 'Help',
    kind: 'Contact',
    title: CONTACT_PAGE.title,
    description: CONTACT_PAGE.lede,
    href: ROUTES.contact,
  },
  {
    category: 'Help',
    kind: 'Demo',
    title: CONTACT_PAGE.demoTitle,
    description: CONTACT_PAGE.lede,
    href: '#demo',
    keywords: ['book a demo', 'talk to sales', 'healthcare provider'],
  },
]

function resourceCountLabel(count: number) {
  return `${count} ${count === 1 ? 'resource' : 'resources'}`
}

export function ResourcesHub() {
  const [query, setQuery] = useState('')
  const [activeCategory, setActiveCategory] = useState<ResourceCategory | 'All'>('All')
  const normalizedQuery = query.trim().toLocaleLowerCase()

  const categoryCounts = useMemo(
    () =>
      CATEGORY_ORDER.reduce<Record<ResourceCategory, number>>((counts, category) => {
        counts[category] = RESOURCES.filter(resource => resource.category === category).length
        return counts
      }, {} as Record<ResourceCategory, number>),
    [],
  )

  const filteredResources = useMemo(
    () =>
      RESOURCES.filter(resource => {
        const isInSelectedCategory = activeCategory === 'All' || resource.category === activeCategory
        const searchableText = `${resource.category} ${resource.kind} ${resource.title} ${resource.description} ${(resource.keywords ?? []).join(' ')}`.toLocaleLowerCase()

        return isInSelectedCategory && (!normalizedQuery || searchableText.includes(normalizedQuery))
      }),
    [activeCategory, normalizedQuery],
  )

  const groupedResources = useMemo(
    () =>
      CATEGORY_ORDER.map(category => ({
        category,
        items: filteredResources.filter(resource => resource.category === category),
      })).filter(group => group.items.length > 0),
    [filteredResources],
  )

  const hasActiveFilters = Boolean(query) || activeCategory !== 'All'

  return (
    <>
      <Section labelledBy="resources-title">
        <Wrap>
          <SectionHeader
            eyebrow="Resources"
            id="resources-title"
            title="Everything you need to understand Health ID."
            lede="Explore the connected healthcare ecosystem, individual products, implementation material, and the controls that protect patient information."
            as="h1"
          />

          <div className="mx-auto mt-12 max-w-[920px] rounded-(--radius-panel) border border-line bg-white p-4 shadow-[0_16px_40px_rgba(15,39,66,0.06)] sm:p-5">
            <form role="search" onSubmit={event => event.preventDefault()}>
              <label className="sr-only" htmlFor="resource-search">
                Search Health ID resources
              </label>
              <div className="flex flex-col gap-3 sm:flex-row">
                <div className="relative flex-1">
                  <svg
                    aria-hidden="true"
                    className="pointer-events-none absolute top-1/2 left-4 h-5 w-5 -translate-y-1/2 text-muted"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.8" />
                    <path d="m16 16 4 4" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
                  </svg>
                  <input
                    id="resource-search"
                    type="search"
                    value={query}
                    onChange={event => setQuery(event.target.value)}
                    placeholder="Search Health ID resources..."
                    aria-describedby="resources-count"
                    className="min-h-12 w-full rounded-(--radius-control) border border-line bg-surface py-3 pr-4 pl-12 text-[16px] text-ink placeholder:text-faint focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                  />
                </div>
                {hasActiveFilters ? (
                  <button
                    type="button"
                    onClick={() => {
                      setQuery('')
                      setActiveCategory('All')
                    }}
                    className="min-h-12 rounded-(--radius-control) border border-line px-5 text-[15px] font-semibold text-ink transition-colors hover:border-brand hover:text-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                  >
                    Clear filters
                  </button>
                ) : null}
              </div>
            </form>

            <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Filter resources by category">
              <FilterButton
                active={activeCategory === 'All'}
                count={RESOURCES.length}
                label="All resources"
                onClick={() => setActiveCategory('All')}
              />
              {CATEGORY_ORDER.map(category => (
                <FilterButton
                  key={category}
                  active={activeCategory === category}
                  count={categoryCounts[category]}
                  label={category}
                  onClick={() => setActiveCategory(category)}
                />
              ))}
            </div>
          </div>
        </Wrap>
      </Section>

      <Section tone="sunk" labelledBy="resource-results-title">
        <Wrap>
          <div className="flex flex-col gap-2 border-b border-line pb-6 sm:flex-row sm:items-end sm:justify-between">
            <Display as="h2" size="md" id="resource-results-title">
              Browse resources
            </Display>
            <p id="resources-count" aria-live="polite" className="text-[15px] text-muted">
              Showing {resourceCountLabel(filteredResources.length)}
              {activeCategory !== 'All' ? ` in ${activeCategory}` : ''}
              {normalizedQuery ? ` for "${query.trim()}"` : ''}.
            </p>
          </div>

          {groupedResources.length ? (
            <div id="resource-results" className="mt-10 flex flex-col gap-14">
              {groupedResources.map(group => (
                <section key={group.category} aria-labelledby={`${group.category}-resources`}>
                  <div className="flex items-baseline justify-between gap-4">
                    <h3
                      id={`${group.category}-resources`}
                      className="text-[16px] font-semibold tracking-[-0.01em] text-ink"
                    >
                      {group.category}
                    </h3>
                    <span className="font-mono text-[11px] tracking-[0.1em] text-faint uppercase">
                      {resourceCountLabel(group.items.length)}
                    </span>
                  </div>
                  <ul className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {group.items.map(resource => (
                      <li key={`${resource.category}-${resource.title}`} className="flex">
                        <Link
                          href={resource.href}
                          className="group flex w-full rounded-(--radius-panel) focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand"
                        >
                          <Card className="flex h-full w-full flex-col gap-3 bg-white p-6 transition-colors duration-150 group-hover:border-brand">
                            <span className="font-mono text-[11px] font-medium tracking-[0.12em] text-brand uppercase">
                              {resource.kind}
                            </span>
                            <h4 className="text-[18px]/[1.25] font-semibold tracking-[-0.02em] text-ink">
                              {resource.title}
                            </h4>
                            <p className="text-[15px]/relaxed text-muted">{resource.description}</p>
                            <span className="mt-auto pt-2 text-[15px] font-semibold text-brand">
                              Open resource <span aria-hidden="true">&rarr;</span>
                            </span>
                          </Card>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          ) : (
            <div className="mx-auto mt-10 max-w-[600px] rounded-(--radius-panel) border border-line bg-white px-6 py-10 text-center">
              <p className="text-[18px] font-semibold text-ink">No resources match that search.</p>
              <p className="mt-2 text-[15px]/relaxed text-muted">
                Try another term, or clear the current filters to view the full library.
              </p>
              <button
                type="button"
                onClick={() => {
                  setQuery('')
                  setActiveCategory('All')
                }}
                className="mt-5 min-h-11 rounded-(--radius-control) border border-line px-5 text-[15px] font-semibold text-ink transition-colors hover:border-brand hover:text-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
              >
                View all resources
              </button>
            </div>
          )}
        </Wrap>
      </Section>
    </>
  )
}

function FilterButton({
  active,
  count,
  label,
  onClick,
}: {
  readonly active: boolean
  readonly count: number
  readonly label: string
  readonly onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`min-h-11 rounded-(--radius-control) border px-4 text-[14px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
        active
          ? 'border-brand bg-brand text-white'
          : 'border-line bg-surface text-ink hover:border-brand hover:text-brand'
      }`}
    >
      {label} <span className="ml-1 opacity-70">{count}</span>
    </button>
  )
}
