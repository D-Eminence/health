# Waya / KORO Master Design-System Audit

## Scope

This audit treats the repository as one core product language (Waya) with a commerce extension (KORO). It was cross-checked against the actual tokens, React primitives, dashboard CSS/JS, command-search implementation, KORO storefront/checkout CSS, and the bundled dashboard screenshots.

The goal is not to preserve every accidental CSS value. The goal is to preserve repeatable visual and interaction decisions while identifying drift, duplicates, undefined tokens, and project-specific exceptions.

## 1. Design DNA

- Quiet neutral surfaces; hierarchy is created mostly with typography, spacing, alignment, and subtle surface shifts.
- Hairline structural borders; stronger 1px borders are reserved for controls and deliberate affordance.
- Serif display/headings + restrained sans-serif body/UI pairing.
- Compact operational controls, but with touch-safe mobile states.
- Strong shared left/right axes. Page title, tabs, sections, tables, and footer regions should not independently recenter themselves.
- Rounded geometry is restrained: 3–8px for most UI, 10–12px for dialogs/sheets, pills only for clearly pill-like controls/status/search.
- Motion is quick and functional; animation does not become decoration.
- KORO inherits the Waya foundations but replaces purple as the primary storefront action emphasis with charcoal (`--koro-cta`).

## 2. Foundations

### Typography

**Heading family**
`--font-heading: "Ashcroft", "Playfair Display", Georgia, serif`

**Body/UI family**
`--font-body: "Geist", "DM Sans", Arial, sans-serif`

**Mono**
`--font-mono: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace`

**Scale**
- 9px — 2XS / micro status
- 10px — XS / compact badges
- 11px — SM / small metadata
- 12px — caption
- 13px — label
- 14px — body small / control text
- 15px — body
- 16px — body large / lede
- 18px — small title
- 20px — title
- 39px — mobile display
- 48px — desktop display

**Line heights**
- Tight: 1.08
- UI: 1.25
- Body: 1.45
- Relaxed: 1.6

**Common tracking behavior**
- Display headings: approximately -0.04em
- Compact UI/search labels: approximately -0.015em to -0.018em
- Eyebrows/categories: +0.06em to +0.08em, uppercase
- Numeric/stat values: use tabular numerals where alignment matters

### Spacing

The core spacing scale is 4px-based with optical half-steps retained from the product:

| Token | Value |
|---|---:|
| space-0 | 0 |
| space-0-5 | 2px |
| space-1 | 4px |
| space-1-5 | 6px |
| space-2 | 8px |
| space-2-5 | 10px |
| space-3 | 12px |
| space-3-5 | 14px |
| space-4 | 16px |
| space-4-5 | 18px |
| space-5 | 20px |
| space-6 | 24px |
| space-7 | 28px |
| space-8 | 32px |
| space-10 | 40px |
| space-12 | 48px |
| space-14 | 56px |
| space-16 | 64px |
| space-18 | 72px |
| space-20 | 80px |

**Observed rhythm rules**
- Page/container mobile gutter: 16px
- Tablet/large gutter: 24px
- Standard dashboard gutter: 20px
- Compact dashboard gutter: 16px
- KORO section vertical padding: typically 40px
- KORO hero vertical padding: 48/40px mobile, 64/56px desktop
- Section heading → content: typically 20px
- Card internal padding: commonly 12–16px
- Dense row/control gaps: 4–12px
- Related groups: 16–24px
- Major page blocks: 40–80px

Do not invent arbitrary 17px/23px/31px spacing unless geometry genuinely requires it. Prefer the scale above.

### Color system

The canonical semantic colors live in `src/styles/product-tokens.css`.

**Core neutrals (light)**
- Page/surface: #ffffff
- Panel: #f8f8f8
- Subtle: #f6f6f6
- Hover: #f3f3f3
- Selected: #eeeeee
- Strong text: #222222
- Default text: #262626
- Secondary: #555555
- Muted: #7b7b7b
- Soft: #898989
- Border: #f0f0f0
- Strong border: #e3e3e3

**Core neutrals (dark)**
- Page/surface: #0b0b0b
- Raised: #151515
- Panel: #121212
- Subtle: #1a1a1a
- Hover: #202020
- Selected: #242424
- Strong text: #ffffff
- Default text: #f2f2f2
- Secondary: #cccccc
- Muted: #aaaaaa
- Border: #242424
- Strong border: #343434

**Semantic / product accents**
- Waya accent: #6d3bf5
- Accent-on-dark: #8b5cf6
- KORO CTA/action emphasis: #0a0a0a
- KORO CTA hover: #26262b
- Success: #00a94f
- Warning: #d89600
- Danger: #ba3a35
- Info: #25a4ff
- Workspace brand: #ff7900

**Rule:** status color is never the only cue; pair it with text/iconography.

### Radius

- 3px: tiny compact controls
- 4px: small rows/tooltips
- 5px: default control/nav row
- 6px: medium cards/marks
- 8px: general cards/product cards
- 10px: desktop dialogs
- 12px: sheets / soft checkout fields
- 50%: avatars, circular image masks
- 999px: pills, chips, capsules, search

### Borders

- 0.5px: structural/hairline division
- 1px: inputs, selects, checkboxes, explicit affordance
- 2px: keyboard focus only

Cards, tables, navigation, and page separators should not use heavy outlines.

### Elevation

- Popover: `0 12px 35px rgba(0,0,0,.12)`
- Menu: `0 12px 28px rgba(0,0,0,.10)`
- Dialog: `0 20px 80px rgba(0,0,0,.20)`
- Toast: `0 10px 30px rgba(0,0,0,.18)`
- Tooltip: `0 4px 18px rgba(0,0,0,.16)`
- Interactive card: `0 10px 28px rgba(0,0,0,.08)` light; stronger in dark mode

**Important defect:** `--shadow-card` is referenced by KORO checkout/product-detail styles but is not defined in the canonical token file. This must either become a real token or those references must be replaced with an existing elevation token.

### Motion

- Exit: 50ms
- Quick feedback: 150ms
- Sidebar: 180ms
- Standard: 250ms
- Slow/deliberate: 350ms
- Emphasis: 500ms

Easing:
- Standard: cubic-bezier(.2,0,0,1)
- Entrances/out: cubic-bezier(.22,1,0.36,1)
- Spring: cubic-bezier(.34,1.36,0.64,1), only for small feedback

Reduced-motion mode collapses shared duration tokens to ~1ms.

### Icons

- Utility/status: 13px
- Compact menu: 15px
- Default/nav: 17px
- Large action: 18px
- Alignment box: 20px
- Default stroke: 1.7
- Navigation stroke: 1.5

Always align the icon box, not the irregular path geometry.

## 3. Alignment & Grid System

### Waya dashboard

- Desktop shell is full viewport; no decorative centered outer frame.
- Sidebar: 247px expanded / 60px collapsed.
- Settings content uses a two-column composition with a 480px readable settings column and ~72px inter-column separation.
- Ultra-wide settings content remains left-anchored inside a 1440px readable inner region.
- Data-heavy pages may use full content width.
- Shared vertical axes matter more than per-section centering.

### KORO storefront

- Main container max-width: 1280px.
- Horizontal gutters: 16px mobile, 24px tablet/large desktop.
- Header height: 56px desktop; wraps to two rows on phones when search requires width.
- Desktop primary navigation appears at 901px+.
- Storefront layout breakpoints cluster around 600/601, 900/901, and 1280px.

### Responsive grid rules

**Product grid**
- Mobile: 2 columns
- Tablet 601+: 3 columns
- Desktop 901+: 4 columns

**Category grid**
- Mobile/tablet: 2 columns
- Desktop 901+: 5 columns

**Form grids**
- Default: 1 column
- 600/601+: 2 or 3 columns where explicitly declared

**Dashboard analytics**
- Uses progressive collapse points near 1180, 900, 700, 600 depending on data density.

## 4. Cards & Surfaces

### General card anatomy

A card is not automatically a raised white box. The system prefers:
- surface or panel fill
- hairline border
- 6–8px radius
- 12–16px internal padding
- restrained or zero static shadow
- hover elevation only when the whole card is interactive

### Product card

- Hairline border
- 8px radius
- Overflow hidden
- Product image area: 4:3
- `object-fit: contain` for merchandise; do not crop product content to force a decorative fill
- Body padding: 12px
- Internal body gap: 6px
- Category: 11px uppercase + 0.06em tracking
- Name: 14px, medium weight
- Hover: stronger border + interactive-card shadow

### Category tile

- Panel fill
- Hairline border
- 8px radius
- 16px padding
- 28px icon tile, 6px radius
- 12px icon-to-label separation

### Metric/stat cards

The repository already contains `MetricCard` and analytics components. Preserve these characteristics:
- Stats live within the same subtle card language as other data surfaces.
- Numeric values are the dominant visual element.
- Supporting labels remain muted and compact.
- Change/status is secondary and semantic, never louder than the value.
- Grid collapse should preserve readable numerical comparison rather than squeezing all stats into one row.

### Checkout cards

- 8px radius
- Hairline borders
- Panel or white surface depending hierarchy
- 12px padding for dense summary cards
- Payment-method tiles: minimum ~104px height, 16px padding, 20px internal vertical separation
- Selected payment method inverts to KORO charcoal rather than adding multiple decorative accent colors

## 5. Search Pattern

Search has a distinct capsule anatomy used across storefront surfaces:
- Outer height: 44px
- Inner action: 28px
- Inner inset: 8px
- Left padding: 14px
- Gap: 10px
- Search icon: 16px
- Maximum field width: 560px in the token
- Search text: 14px
- Submit text: 13px
- Full-pill outer and inner radii

Global command search is deliberately different: dark/high-contrast, modal-scale, information-dense, and component-scoped through `--cs-*` tokens.

## 6. Component Inventory

### Production-ready React primitives already present

- Button
- InputField
- SelectField
- TextareaField
- Checkbox
- Card
- Badge
- Status
- Avatar
- Table / TableHead / TableBody / TableRow / TableHeader / TableCell
- Tabs
- DropdownMenu
- Tooltip
- Dialog
- Alert
- Skeleton
- Spinner
- StatePanel
- MetricCard
- LineChart
- DonutChart
- BarBreakdown
- Icon

### Specialized reusable product patterns

- Global command search
- Sidebar expanded/collapsed behavior
- Workspace menu/dropdown
- Theme selector/preview
- Dashboard data table
- Filters and pagination
- Bulk actions
- Home analytics dashboard
- Toast stack
- Service-status banner
- Audit log
- Page notice
- Detail drawer
- KORO sticky storefront header
- Mobile navigation
- Hero search
- Category tile/grid
- Product card/grid
- PDP media gallery and product-detail controls
- Cart line item
- Quantity stepper
- Order summary
- Checkout stepper
- Checkout plan/item card
- Payment-method selector
- Discount row
- Checkout totals
- Commerce notices/toasts

## 7. Navigation

### Dashboard sidebar

- 247px expanded / 60px collapsed
- Refined nav row height: 40px
- 5px row radius
- Icon and label use a fixed vertical axis
- Selected: subtle surface + stronger text
- Hover must never look more selected than current route
- Collapsed tooltips appear outside the sidebar
- Count badges become dots when collapsed

### KORO header

- Sticky at top
- 56px normal height
- Hairline bottom border
- Logo/brand left, nav middle, search/action utilities allocated by available width
- Mobile search moves to its own row instead of being squeezed
- Main nav hidden below 901px
- Mobile menu uses stacked links with 10–12px vertical padding and selected-surface treatment

## 8. Forms

### Shared product controls

- Default field target ~42px in design-system catalogue
- 1px control border
- 6px-ish radius for ordinary forms
- Labels above controls
- Muted supporting/error text beneath
- `aria-invalid` on errors
- Focus is visible and distinct from selected state

### Checkout variation

Checkout intentionally compresses controls to a minimum ~38px to keep critical content above fold on laptop screens.
- Panel fill
- 12px radius
- Quiet border
- Focus returns to white/surface and uses charcoal border emphasis

This is a contextual density variant, not a license for arbitrary field heights.

## 9. States

Every interactive component should specify:
- default
- hover
- active/pressed
- focus-visible
- selected/current
- disabled
- loading/pending
- error
- success where applicable
- empty state
- skeleton/loading placeholder where data is asynchronous

Do not conflate hover, selected, and focus.

## 10. Data & Tables

- Use hairline separators instead of boxed cells.
- Keep status presentation textual/icon-supported.
- Use tabular numerals for money and metrics.
- Dense tables may transform to card-like rows on small screens where horizontal comparison is no longer practical.
- Filters, pagination, bulk action bars, drawers, and table row actions are part of the system and must be documented together, not as unrelated one-offs.

## 11. Imagery

- Product cards use 4:3 media and `object-fit: contain`.
- Thumbnails and avatars may use circular masks where identity/product context benefits from it.
- Gallery/PDP media may use different ratios, but images should preserve the product rather than crop aggressively.
- Fallback media treatment is neutral/subtle, not branded decoration.

## 12. Feedback & Overlays

The system already contains:
- success/error/warning/info notices
- loading/progress toasts
- dismiss/action toasts
- dialog
- tooltip
- dropdown/menu
- audit detail drawer
- command palette overlay

Z-index foundation:
- Popover 1000
- Overlay 1100
- Toast 1200
- Tooltip 2000

These roles should remain stable so local components do not start competing with arbitrary z-index values.

## 13. Accessibility Rules

- Pointer, keyboard, and touch must all work.
- Focus-visible state is mandatory.
- Icon-only controls need accessible names.
- Decorative icons are aria-hidden.
- Status cannot depend on color alone.
- Reduced-motion must be respected.
- Mobile controls become taller where necessary for touch.
- Tabs retain tablist/tab/tabpanel semantics and keyboard navigation.

## 14. Breakpoint Strategy

The code currently uses several breakpoint families. They are coherent but should be formalized:
- <=480px: very small phone refinements
- <=599/600px: phone
- 601px+: tablet baseline
- 720/760px: component-specific mid-size collapse
- 900/901px: primary desktop/navigation transition
- 1024px: dashboard layout refinement
- 1100/1180px: data-layout refinement
- 1280px: wide storefront/container refinement
- 1440px: readable dashboard region
- 1680px: large audit/detail split view
- 1920px: ultra-wide dashboard refinement

Recommended cleanup: name these semantic breakpoint roles instead of continuing to scatter raw media-query values.

## 15. Project-Specific vs Core

### Core design system

- color semantics
- type system
- spacing
- radii
- border weights
- elevation
- motion
- icon geometry
- layout/gutter primitives
- buttons/forms
- cards
- tabs/menus/tooltips/dialogs
- tables/status/badges/avatar
- feedback states
- analytics primitives
- responsive/accessibility conventions

### Waya dashboard patterns

- sidebar/workspace switcher
- settings page composition
- theme selector
- audit log/drawer
- operational tables and filters
- dashboard metric/analytics composition
- global command search

### KORO commerce extension

- charcoal action accent
- sticky commerce header
- storefront search capsule
- category grid
- product card and product grid
- PDP gallery and commerce controls
- cart patterns
- checkout stepper
- payment methods
- order summary/totals
- commerce toast/notice variants

The KORO extension should consume core tokens and primitives rather than duplicate foundations.

## 16. Drift / Defects Found

1. **Undefined `--shadow-card` token** is referenced in multiple KORO rules. Define it or replace it.
2. **Command-search maintains a parallel token namespace (`--cs-*`)**. This is justified for its distinct high-contrast surface, but shared primitives (spacing, motion, radii) should keep aliasing core tokens rather than drift.
3. **Some hardcoded `#fff`/brand/avatar colors remain**. Many are legitimate on-color/identity values; the rest should be audited before packaging.
4. **Breakpoint values are repeated directly** rather than represented as a named design-system contract.
5. **Two visual contexts coexist**: operational Waya dashboard and KORO commerce. They should remain core + extension, not be flattened into one giant component set with ambiguous rules.
6. **Ashcroft is referenced but not shipped as a licensed webfont.** The system currently relies on Playfair Display / Georgia fallback behavior.
7. **Repository dependencies cannot currently be validated in this sandbox** because bundled `node_modules` is missing platform-native optional packages for TypeScript/Rolldown/Vite. A clean install is needed before test/build verification.

## 17. Packaging Target

Recommended reusable structure:

```text
@yourname/design-system/
  foundations/
    tokens.css
    tokens.json
    typography.css
    themes.css
    motion.css
  primitives/
    Button/
    Field/
    Card/
    Badge/
    Status/
    Avatar/
    Table/
    Tabs/
    Dialog/
    Tooltip/
    Menu/
  data/
    MetricCard/
    LineChart/
    DonutChart/
    BarBreakdown/
  patterns/
    Search/
    Sidebar/
    SettingsLayout/
    DataTable/
    AuditDrawer/
  extensions/
    commerce/
      CommerceHeader/
      ProductCard/
      ProductGrid/
      ProductGallery/
      CartLine/
      QuantityStepper/
      OrderSummary/
      CheckoutSteps/
      PaymentMethod/
  docs/
    DESIGN_LANGUAGE.md
    SPACING_ALIGNMENT.md
    RESPONSIVE_RULES.md
    COMPONENT_RULES.md
    INTERACTION_STATES.md
    ACCESSIBILITY.md
    DO_NOTS.md
    AI_USAGE.md
  index.ts
  package.json
```

## 18. Definition of Done

The extraction is complete only when:
- every recurring value has a token or a documented reason to remain local;
- spacing and alignment relationships are documented, not just raw values;
- all reusable components expose their states and responsive behavior;
- cards, stats, tables, search, forms, nav, overlays, checkout and commerce patterns are covered;
- the core vs commerce-extension boundary is explicit;
- no undefined CSS variables remain;
- no duplicated visual implementation remains without a documented reason;
- Storybook/component catalogue demonstrates each variant/state;
- keyboard and reduced-motion behavior are testable;
- package imports work from a second clean project;
- AI rules prevent tools from inventing new visual language.
