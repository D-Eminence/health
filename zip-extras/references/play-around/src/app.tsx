import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { CommandSearch } from './components/command-search'
import { globalSearchFilters, globalSearchGroups, globalSearchResults } from './global-search-data'
import { Alert, Avatar, Badge, BarBreakdown, Button, Card, Checkbox, Dialog, DonutChart, DropdownMenu, Icon, InputField, LineChart, MetricCard, SelectField, Skeleton, StatePanel, Status, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Tabs, TextareaField, Tooltip } from './components/ui'

const chartLabels = ['Jan 13', 'Jan 14', 'Jan 15', 'Jan 16', 'Jan 17', 'Jan 18', 'Jan 19']

export function App() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => localStorage.getItem('design-system-theme') === 'dark' ? 'dark' : 'light')
  const [tab, setTab] = useState('general')
  const [checked, setChecked] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [toastVisible, setToastVisible] = useState(true)
  const [query, setQuery] = useState('')
  const searchResults = useMemo(() => globalSearchResults.filter(item => `${item.label} ${item.description || ''} ${(item.metadata || []).join(' ')}`.toLowerCase().includes(query.toLowerCase())), [query])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('design-system-theme', theme)
  }, [theme])

  return <main className="docs-shell">
    <header className="catalog-header">
      <div><p className="eyebrow">Waya product language</p><h1>Design system</h1><p className="lede">Production-ready foundations and reusable components extracted from the dashboard.</p></div>
      <div className="catalog-actions"><Button icon="search" onClick={() => setSearchOpen(true)}>Open global search</Button><Tooltip label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}><Button aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`} icon={theme === 'light' ? 'sun' : 'moon'} onClick={() => setTheme(value => value === 'light' ? 'dark' : 'light')}>Theme</Button></Tooltip></div>
    </header>

    <nav className="catalog-nav" aria-label="Component categories">{['Foundations', 'Actions', 'Forms', 'Navigation', 'Data', 'Analytics', 'Feedback', 'Overlays'].map(item => <a key={item} href={`#${item.toLowerCase()}`}>{item}</a>)}</nav>

    <CatalogSection id="foundations" kicker="01" title="Foundations" description="Semantic tokens keep light and dark mode aligned without changing component structure.">
      <div className="swatch-grid">{[
        ['Canvas', 'var(--color-page)'], ['Surface', 'var(--color-surface-panel)'], ['Text', 'var(--color-text)'], ['Muted', 'var(--color-text-muted)'], ['Accent', 'var(--color-accent)'], ['Success', 'var(--color-success)'], ['Warning', 'var(--color-warning)'], ['Danger', 'var(--color-danger)']
      ].map(([label, color]) => <div className="swatch" key={label}><i style={{ background: color }} /><span>{label}</span><code>{color.replace('var(--', '').replace(')', '')}</code></div>)}</div>
      <div className="type-specimens"><div><span>Display / Ashcroft</span><h2>Clarity at every scale</h2></div><div><span>Body / Geist</span><p>Operational interfaces need compact, legible typography with a clear hierarchy and predictable rhythm.</p></div></div>
    </CatalogSection>

    <CatalogSection id="actions" kicker="02" title="Buttons & actions" description="Use one high-emphasis action per decision area; neutral actions remain visually quieter.">
      <Demo title="Variants"><div className="component-row"><Button variant="accent">Save changes</Button><Button variant="primary">Continue</Button><Button variant="secondary">Cancel</Button><Button variant="quiet">Learn more</Button><Button variant="danger">Delete</Button></div></Demo>
      <Demo title="States"><div className="component-row"><Button size="sm" icon="download">Download</Button><Button loading>Saving</Button><Button disabled>Disabled</Button><Tooltip label="Exports the current report"><Button icon="info">Hover for help</Button></Tooltip></div></Demo>
    </CatalogSection>

    <CatalogSection id="forms" kicker="03" title="Inputs & selection" description="A shared field frame, 42px target height, restrained focus ring, and one error pattern across forms.">
      <div className="form-grid"><InputField label="Full name" placeholder="Enter a full name" defaultValue="Oyeleye Ogunsanya" /><InputField label="Search" leadingIcon="search" placeholder="Search users" hint="Search by name, email, or ID." /><InputField label="Email address" defaultValue="invalid@email" error="Enter a valid work email address." /><SelectField label="Role" defaultValue="operations"><option value="operations">Operations</option><option value="support">Customer support</option><option value="admin">Admin</option></SelectField><TextareaField label="Notes" placeholder="Add an internal note" /><InputField label="Disabled field" value="Unavailable" disabled readOnly /></div>
      <Demo title="Checkbox states"><div className="component-row"><Checkbox label="Selected option" checked={checked} onChange={setChecked} /><Checkbox label="Unselected option" checked={false} onChange={() => undefined} /><Checkbox label="Disabled option" checked={false} disabled onChange={() => undefined} /></div></Demo>
    </CatalogSection>

    <CatalogSection id="navigation" kicker="04" title="Navigation & menus" description="Tabs, menus, and contextual help share the same spacing, focus, and viewport-safe behavior.">
      <Tabs value={tab} onChange={setTab} items={[{ id: 'general', label: 'General' }, { id: 'team', label: 'Team' }, { id: 'sessions', label: 'Sessions' }, { id: 'support', label: 'Support' }]} />
      <div className="component-row padded-row"><DropdownMenu label="Manage member" items={[{ id: 'role', label: 'Change role' }, { id: 'reset', label: 'Reset password' }, { id: 'remove', label: 'Remove member', danger: true }]} /><Button onClick={() => setDialogOpen(true)}>Open dialog</Button><Tooltip label="This label never blocks its trigger"><Button variant="quiet" icon="info">Tooltip</Button></Tooltip></div>
    </CatalogSection>

    <CatalogSection id="data" kicker="05" title="Cards, badges & tables" description="Data-heavy components use hairline separators and semantic status colors—not filled status icons.">
      <Demo title="Statuses"><div className="component-row"><Status tone="success">Successful</Status><Status tone="pending">Pending</Status><Status tone="failed">Failed</Status></div><div className="component-row"><Badge tone="success">Verified</Badge><Badge tone="warning">Flagged</Badge><Badge tone="info">Admin</Badge><Badge>Neutral</Badge></div></Demo>
      <Card title="Team members" description="Reusable table, avatar, status, row hover, and horizontal overflow behavior.">
        <Table><TableHead><TableRow><TableHeader>Name</TableHeader><TableHeader>Email</TableHeader><TableHeader>Role</TableHeader><TableHeader>2FA status</TableHeader></TableRow></TableHead><TableBody>{[
          ['Adebayo Johnson', 'adebayo@company.com', 'Owner', 'Enabled', 'blue'], ['Oyeleye Ogunsanya', 'oyeleye@company.com', 'Operations', 'Enabled', 'orange'], ['Damilola Adeyemi', 'damilola@company.com', 'Support', 'Disabled', 'green']
        ].map(row => <TableRow key={row[1]}><TableCell><span className="ui-table-person"><Avatar name={row[0]} tone={row[4] as 'blue' | 'orange' | 'green'} size="sm" />{row[0]}</span></TableCell><TableCell>{row[1]}</TableCell><TableCell>{row[2]}</TableCell><TableCell><Badge tone={row[3] === 'Enabled' ? 'success' : 'warning'}>{row[3]}</Badge></TableCell></TableRow>)}</TableBody></Table>
      </Card>
      <Demo title="Loading"><div className="skeleton-stack"><Skeleton width="42%" /><Skeleton width="100%" /><Skeleton width="86%" /><Skeleton width="64%" /></div></Demo>
    </CatalogSection>

    <CatalogSection id="analytics" kicker="06" title="Graphs & analytics" description="Native, theme-aware charts use stable series colors and shared card geometry without a chart dependency.">
      <div className="metric-grid"><MetricCard label="Total users" value="824.6K" change="12.4%" icon={<Icon name="info" />} /><MetricCard label="Active users" value="394.7K" change="8.4%" icon={<Icon name="check" />} /><MetricCard label="Total orders" value="1.28M" change="8.7%" icon={<Icon name="trend" />} /><MetricCard label="Order value" value="$284.6M" change="15.2%" icon={<Icon name="info" />} /></div>
      <div className="analytics-grid"><Card title="Users & orders" description="Seven-day comparison"><LineChart title="Users and orders over seven days" labels={chartLabels} max={120} series={[{ label: 'Users', tone: 'users', unit: 'K', values: [22, 17, 17, 43, 43, 52, 95] }, { label: 'Orders', tone: 'orders', unit: 'K', values: [42, 31, 57, 37, 48, 62, 116] }]} /></Card><Card title="Registered vs active users" description="47.9% activation rate"><LineChart title="Activation rate over seven days" labels={chartLabels} min={40} max={50} series={[{ label: 'Activation', tone: 'activation', unit: '%', values: [42.1, 43.2, 43.5, 45.3, 45.3, 47.7, 49.5] }]} /></Card><Card title="Order status" description="Total order distribution"><DonutChart title="Order status distribution" values={[{ label: 'Successful', value: 85.5, display: '1.10M (85.5%)', tone: 'success' }, { label: 'Pending', value: 10, display: '128.4K (10.0%)', tone: 'pending' }, { label: 'Failed', value: 4.5, display: '58.1K (4.5%)', tone: 'failed' }]} /></Card><Card title="Brokerage" description="Total brokerage breakdown"><BarBreakdown total="$284.6M" totalDescription="Sum of Buying power, Unsettled cash, and Reserved cash." items={[{ label: 'Buying power', value: '$91,412,210', percent: 32.1 }, { label: 'Unsettled cash', value: '$132,048,310', percent: 46.4 }, { label: 'Reserved cash', value: '$61,161,320', percent: 21.5 }]} /></Card></div>
    </CatalogSection>

    <CatalogSection id="feedback" kicker="07" title="Feedback & states" description="Notifications remain compact, stack safely, and communicate with icon, title, message, and color together.">
      <div className="feedback-grid">{toastVisible && <Alert tone="success" title="Changes saved" onDismiss={() => setToastVisible(false)}>Your settings have been updated.</Alert>}<Alert tone="error" title="Could not save">Check your connection and try again.</Alert><Alert tone="warning" title="Action needed">Two members still need 2FA.</Alert><Alert tone="info" title="New report ready">Your export is available to download.</Alert><Alert tone="loading" title="Processing export">This may take a few seconds.</Alert></div>
      {!toastVisible && <Button size="sm" onClick={() => setToastVisible(true)}>Restore success toast</Button>}
      <div className="state-grid"><StatePanel state="empty" title="No transactions found" action="Clear filters">Try a different search or remove active filters.</StatePanel><StatePanel state="error" title="We could not load this page" action="Try again">The service did not respond. Your data is safe.</StatePanel><StatePanel state="loading" title="Loading analytics">Fetching the latest account totals.</StatePanel></div>
    </CatalogSection>

    <CatalogSection id="overlays" kicker="08" title="Overlays & global search" description="Dialogs, dropdowns, tooltips, and search reuse the same elevation, radius, motion, and keyboard rules.">
      <Demo title="Command search"><div className="component-row"><Button variant="primary" icon="search" onClick={() => setSearchOpen(true)}>Search the product</Button><code>Ctrl / Cmd + K</code></div></Demo>
    </CatalogSection>

    <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} title="Remove team member?" description="This person will immediately lose access." footer={<><Button onClick={() => setDialogOpen(false)}>Cancel</Button><Button variant="danger" onClick={() => setDialogOpen(false)}>Remove member</Button></>}><p className="dialog-copy">The member can be invited again later. Existing audit log entries will be preserved.</p></Dialog>
    <CommandSearch open={searchOpen} onOpenChange={setSearchOpen} searchValue={query} onSearchValueChange={setQuery} placeholder="Search users, orders, transactions…" filters={globalSearchFilters} groups={globalSearchGroups} results={searchResults} onClear={() => setQuery('')} onResultSelect={() => setSearchOpen(false)} />
  </main>
}

function CatalogSection({ id, kicker, title, description, children }: { id: string; kicker: string; title: string; description: string; children: ReactNode }) {
  return <section className="catalog-section" id={id}><header><span>{kicker}</span><div><h2>{title}</h2><p>{description}</p></div></header><div className="catalog-content">{children}</div></section>
}

function Demo({ title, children }: { title: string; children: ReactNode }) {
  return <div className="component-demo"><span>{title}</span>{children}</div>
}
