# Waya + KORO Master Design System v1.0

## Purpose
This document is the reusable source of truth for recreating the visual language, layout logic, interaction behavior, density, responsive behavior, and component patterns of the supplied Waya/KORO project. It is intentionally broader than a component library: it covers foundations, alignment, spacing, cards, stats, search, settings, navigation, commerce, states, accessibility, responsive behavior, and composition rules.

## 1. Product Architecture
Treat the system as one core product language with two application layers:

- **Waya Core** — shared foundations, primitives, navigation, settings, global search, tables, analytics, overlays, feedback, accessibility.
- **KORO Commerce Extension** — storefront header, storefront search, category/product cards, product detail, cart, order summary, checkout, payment selection, commerce feedback.

KORO consumes Waya Core. Do not duplicate foundational tokens inside KORO unless a contextual alias is necessary.

## 2. Design DNA
- Quiet neutral surfaces; hierarchy comes mainly from typography, spacing, alignment, and subtle tonal separation.
- Structural borders are hairline and restrained.
- Controls are compact on desktop but must remain touch-safe on smaller screens.
- Shared left/right axes are more important than centering isolated sections.
- Rounded geometry is restrained: 3–8px for most UI; 10–12px for dialogs/sheets; pills only for genuinely pill-like controls.
- Motion is fast and functional, never decorative for its own sake.
- Serif display/headings + restrained sans-serif body/UI.
- Cards are not automatically floating white boxes; most use tonal surfaces and hairline structure.
- Status color is always paired with text and/or iconography.
- Waya accent is purple; KORO storefront action emphasis is charcoal.

## 3. Foundations

### 3.1 Typography
**Heading family**: `"Ashcroft", "Playfair Display", Georgia, serif`

**Body/UI family**: `"Geist", "DM Sans", Arial, sans-serif`

**Mono**: `ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace`

Type scale:
- 9px — micro status
- 10px — compact badges
- 11px — small metadata
- 12px — caption
- 13px — label / compact action
- 14px — body small / control text
- 15px — default body
- 16px — body large / lede
- 18px — small title
- 20px — title
- 39px — mobile display
- 48px — desktop display

Line-height roles:
- tight: 1.08
- UI: 1.25
- body: 1.45
- relaxed: 1.6

Tracking:
- display headings: about `-0.04em`
- compact UI/search labels: about `-0.015em` to `-0.018em`
- eyebrows/categories: `+0.06em` to `+0.08em`, uppercase
- money/metrics: tabular numerals when alignment matters

### 3.2 Spacing Scale
Use a 4px-based scale with optical half-steps:

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

Observed rhythm:
- mobile page gutter: 16px
- tablet/large gutter: 24px
- standard dashboard gutter: 20px
- compact dashboard gutter: 16px
- KORO standard section vertical padding: ~40px
- KORO hero vertical padding: ~48/40px mobile; ~64/56px desktop
- section heading to content: ~20px
- card padding: commonly 12–16px
- dense row/control gaps: 4–12px
- related groups: 16–24px
- major page blocks: 40–80px

Do not introduce arbitrary spacing when an existing scale value works.

### 3.3 Alignment System
- Page title, tabs, section dividers, cards, tables, and footer regions share a common content axis.
- Do not independently center individual sections.
- Icons align by fixed optical boxes, not irregular SVG path bounds.
- Labels and editable values maintain consistent vertical axes.
- Settings content remains left-anchored within its readable column.
- Data tables and analytics may use the full available content width.
- Mobile stacking must preserve the same reading order and primary alignment.

### 3.4 Color System
Light core:
- page/surface: `#ffffff`
- panel: `#f8f8f8`
- subtle: `#f6f6f6`
- hover: `#f3f3f3`
- selected: `#eeeeee`
- text strong: `#222222`
- text: `#262626`
- secondary: `#555555`
- muted: `#7b7b7b`
- soft: `#898989`
- border: `#f0f0f0`
- strong border: `#e3e3e3`

Dark core:
- page/surface: `#0b0b0b`
- raised: `#151515`
- panel: `#121212`
- subtle: `#1a1a1a`
- hover: `#202020`
- selected: `#242424`
- text strong: `#ffffff`
- text: `#f2f2f2`
- secondary: `#cccccc`
- muted: `#aaaaaa`
- border: `#242424`
- strong border: `#343434`

Accents:
- Waya accent: `#6d3bf5`
- Waya accent dark: `#8b5cf6`
- KORO CTA: `#0a0a0a`
- KORO CTA hover: `#26262b`
- success: `#00a94f`
- warning: `#d89600`
- danger: `#ba3a35`
- info: `#25a4ff`
- workspace brand: `#ff7900`

### 3.5 Radius
- 3px: tiny compact controls
- 4px: compact rows/tooltips
- 5px: navigation/default rows
- 6px: standard controls/cards
- 8px: general cards/product cards
- 10px: desktop dialogs
- 12px: sheets/checkout fields
- 50%: avatars/circles
- 999px: pills/chips/search capsules

### 3.6 Borders
- 0.5px: structure/dividers/cards/tables/shell boundaries
- 1px: fields/selects/checkboxes/radios/explicit affordances
- 2px: focus-visible only

### 3.7 Elevation
- popover: `0 12px 35px rgba(0,0,0,.12)`
- menu: `0 12px 28px rgba(0,0,0,.10)`
- dialog: `0 20px 80px rgba(0,0,0,.20)`
- toast: `0 10px 30px rgba(0,0,0,.18)`
- tooltip: `0 4px 18px rgba(0,0,0,.16)`
- interactive card: `0 10px 28px rgba(0,0,0,.08)` in light mode

Canonical fix: define `--shadow-card` or replace every legacy reference with the standardized interactive-card shadow token.

### 3.8 Motion
Durations:
- exit: 50ms
- quick feedback: 150ms
- sidebar: 180ms
- standard: 250ms
- deliberate: 350ms
- emphasis: 500ms

Easing:
- standard: `cubic-bezier(.2,0,0,1)`
- entrance/out: `cubic-bezier(.22,1,0.36,1)`
- spring: `cubic-bezier(.34,1.36,0.64,1)` only for small feedback

Reduced-motion mode collapses shared motion to ~1ms while retaining state changes.

### 3.9 Icons
- utility/status: 13px
- compact menu: 15px
- default/nav: 17px
- large action: 18px
- alignment box: 20px
- standard stroke: 1.7
- nav stroke: 1.5
- label gap: 8–12px; sidebar typically 12px; compact menu ~9px

## 4. Layout and Grid

### 4.1 Waya Dashboard
- full-viewport shell; no decorative centered outer frame
- sidebar: 247px expanded / 60px collapsed
- settings content: readable settings column around 480px, with ~72px inter-column spacing where two columns are used
- ultra-wide settings content remains left-anchored inside a ~1440px readable region
- data-heavy pages can use full content width

### 4.2 KORO Storefront
- main max-width: 1280px
- horizontal gutters: 16px mobile, 24px tablet/large desktop
- header: 56px standard desktop height
- desktop nav transition: 901px+
- mobile search moves to its own row instead of being compressed

### 4.3 Responsive Grids
Product grid:
- mobile: 2 columns
- 601px+: 3 columns
- 901px+: 4 columns

Category grid:
- mobile/tablet: 2 columns
- 901px+: 5 columns

Form grids:
- default: 1 column
- 601px+: 2 or 3 columns when content warrants it

Analytics:
- progressively collapse near 1180, 900, 700, 600 depending on density

## 5. Surface and Card System

### 5.1 General Card
- tonal surface/panel fill
- hairline border when separation is needed
- 6–8px radius
- 12–16px padding
- no static shadow by default
- interactive hover elevation only if whole card is actionable

### 5.2 Product Card
- 8px radius
- hairline border
- overflow hidden
- media ratio: 4:3
- merchandise media uses `object-fit: contain`
- body padding: 12px
- body gap: 6px
- category: 11px uppercase with ~0.06em tracking
- name: 14px, medium
- hover: stronger border + interactive elevation

### 5.3 Category Tile
- panel fill
- hairline border
- 8px radius
- 16px padding
- icon tile: 28px, 6px radius
- icon-to-label: 12px

### 5.4 Metric / Stat Card
- same subtle surface language as other cards
- numeric value is visually dominant
- supporting label muted and compact
- status/change secondary to value
- tabular numerals where comparison matters
- responsive collapse preserves compare-ability

### 5.5 Checkout Card
- 8px radius
- hairline border
- 12px dense padding
- selected payment method uses KORO charcoal inversion, not extra decorative accents
- payment method tile minimum height ~104px, 16px padding

## 6. Navigation System

### 6.1 Sidebar
- 247px expanded / 60px collapsed
- navigation row: 40px
- radius: 5px
- fixed icon axis
- selected = subtle surface + stronger text
- hover never appears more selected than active route
- collapsed tooltip appears outside sidebar
- badge count becomes dot when collapsed
- workspace logo remains visible in both states

### 6.2 Workspace Menu
- width ~245px
- padding: 8px
- radius: 6px
- row height: 36px
- icon column: 17px
- anchored to workspace trigger; never overflow viewport

### 6.3 Top Bars / Utility Bars
- preserve shared content axes
- icon-only utilities use accessible labels
- actions should not shift layout on hover or active

### 6.4 KORO Header
- sticky top
- 56px standard height
- hairline bottom border
- logo/brand left, nav middle, search/utilities allocated by available width
- main nav hidden below 901px
- mobile menu uses stacked links with ~10–12px vertical padding

## 7. Settings System — First-Class Pattern
Settings is a complete product pattern, not a generic form page.

### 7.1 Settings Shell
- uses the same dashboard shell/sidebar
- readable content stays left-anchored
- large settings sections should not stretch arbitrarily across wide screens
- preserve a clear hierarchy: page heading → section heading → description → control group

### 7.2 Settings Navigation
- supports side/sub navigation where needed
- active state uses subtle selected surface + stronger text
- labels align to the same axis as other dashboard navigation
- on small screens, convert to a compact temporary/scrollable navigation pattern rather than shrinking labels into unreadability

### 7.3 Section Anatomy
Recommended sequence:
1. section title
2. concise supporting description where needed
3. one or more grouped preference rows
4. optional divider between conceptually different groups
5. action area only if changes are not auto-saved

Spacing:
- section heading to supporting text: use scale, typically 8–12px
- heading block to controls: ~16–20px
- related rows: 12–16px
- major settings groups: 24–40px

### 7.4 Preference Rows
Support these reusable variants:
- text/value row
- toggle row
- select row
- radio/choice row
- connected-account row
- theme/appearance preview row
- destructive/danger row
- security/session row
- copyable credential/detail row

Each row must define label, description, control/action alignment, responsive stacking, loading, disabled, success and error behavior.

### 7.5 Save / Cancel / Unsaved Changes
- preserve geometry while saving
- pending actions show spinner and retain meaningful label
- prevent duplicate submission
- if unsaved changes exist, surface a persistent but restrained save affordance
- confirmations use the shared dialog system

### 7.6 Validation
- label remains visible above the field
- error text appears below
- use `aria-invalid`
- error color is not the only cue
- validation must not cause unexpected horizontal layout shifts

### 7.7 Danger Zone
- visually separated by semantic danger language, but do not over-saturate the whole section
- destructive action uses explicit verb
- irreversible actions require confirmation

### 7.8 Responsive Settings
- desktop: two-column settings composition where appropriate
- tablet/mobile: single readable column
- controls may move below labels/descriptions
- section order remains unchanged
- touch targets remain at least ~40px high

## 8. Global Search — First-Class Pattern
Global Search is a modal-scale command/search system distinct from the lighter KORO storefront search capsule.

### 8.1 Trigger
- lives in utility/top bar
- shows search copy and platform shortcut where appropriate
- trigger geometry aligns optically with adjacent controls

### 8.2 Overlay / Command Surface
- desktop maximum around 810 × 525px
- dark/high-contrast scoped surface using its command-search token namespace
- mobile becomes full-height/edge-to-edge with `100dvh`
- opening moves focus into search input
- closing returns focus to trigger
- Escape closes

### 8.3 Search Input
- about 40px high inside the command surface
- visible caret/focus state
- clear control only when query exists
- preserve input geometry through loading and filtered states

### 8.4 Result Anatomy
- minimum result row ~56px
- identity/title
- supporting metadata
- optional icon/avatar/thumbnail
- directional/action affordance
- keyboard-selected row uses same visual language as hover
- highlighted query matches must remain readable and not over-color the row

### 8.5 Result Grouping
Support:
- recent items
- suggested items
- grouped result types
- filtered scopes
- no-result state
- loading skeleton
- error/retry state

### 8.6 Filters / Scope
- filter row reveals only when needed
- selecting filters must actually narrow results
- use accessible pressed/selected semantics
- filters remain usable with keyboard and touch

### 8.7 Keyboard Behavior
- Up/Down moves active result
- Enter opens active result
- Escape closes
- Tab order remains predictable
- focus is never lost behind overlay

### 8.8 Mobile Search
- full-height
- search input remains visible above the virtual keyboard
- results scroll independently
- close/back control remains visible
- safe-area insets respected

## 9. Storefront Search Capsule
Distinct from Global Search:
- outer height: 44px
- inner action: 28px
- inner inset: 8px
- left padding: 14px
- gap: 10px
- icon: 16px
- max width: ~560px
- search text: 14px
- submit text: 13px
- full pill geometry

## 10. Forms and Controls
### Buttons
Variants:
- accent: Waya purple for highest-emphasis decision action
- primary: theme-inverting neutral strong action
- secondary: surface + standard border
- quiet/icon: transparent until hover
- destructive: danger semantic treatment

All variants require: default, hover, active, focus-visible, disabled, pending.

### Fields
- standard field target ~42px
- 1px strong border
- ~6px radius
- labels above
- support/error below
- placeholder is never the only label

Checkout density variant:
- minimum ~38px
- 12px radius
- quiet border
- contextual, not a universal new default

### Choices
- checkbox/radio/toggle must retain native/ARIA semantics
- selected is distinct from focus
- label remains clickable

## 11. Tables, Filters, Pagination, Bulk Actions
- semantic table markup on desktop
- body copy: ~15px
- row minimum: ~52px
- cell horizontal padding: ~14px
- hairline separators
- subtle hover
- stronger selected row
- status = icon + color + text
- selection uses shared checkbox
- bulk action bar only while selection exists
- filters are anchored popovers; selected filters are summarized above table where applicable
- loading rows preserve column geometry with skeletons
- empty/error states occupy expected table region
- mobile transforms rows into labeled summary cards instead of forcing horizontal desktop tables

## 12. Analytics / Stats
Reusable primitives:
- MetricCard
- LineChart
- DonutChart
- BarBreakdown

Interaction rules:
- keyboard-focusable chart targets
- hover/focus expose exact values
- active series/slice/bar is emphasized while others are softly dimmed
- tooltips are viewport-aware
- reduced-motion removes animation, not information
- cards remain quiet surfaces; chart interaction is the focus

## 13. Feedback and State System
Every interactive component defines:
- default
- hover
- pressed
- focus-visible
- selected/current
- disabled
- loading/pending
- error
- success where relevant
- empty
- skeleton/loading placeholder

Do not conflate hover, selected, and focus.

Toasts:
- semantic raised surface
- hairline border
- 8px radius
- toast shadow
- 20px status icon
- concise title/message
- optional action
- close control
- stack capped at five
- top-right desktop; bottom/full-width within safe gutters on mobile

## 14. Overlays
Dialogs:
- max ~500px desktop
- 10px radius
- raised surface + dialog shadow
- mobile becomes bottom sheet with ~12px top radius

Tooltips:
- dark surface / white text
- 14px / medium
- 7px vertical, 10px horizontal padding
- 4px radius
- min height ~36px
- 8px arrow
- open ~80ms; close immediately
- max width ~300px

Detail drawer:
- raised panel, 8px radius
- inset ~12px from safe viewport edges
- split-view on large desktop where possible
- overlay/scrim on smaller desktop/tablet
- bottom sheet on mobile
- focus moves in on open and returns to trigger on close

## 15. Imagery
- product cards: 4:3, `object-fit: contain`
- avoid aggressive cropping of merchandise or important subject matter
- avatars/identity images may use circles
- thumbnails preserve clear recognition
- fallback imagery uses neutral/subtle surfaces
- gallery/PDP media can use context-specific ratios but must not distort content

## 16. Responsive Contract
Semantic ranges:
- <=480px: very small phone refinements
- <=600px: phone
- 601–900px: tablet
- 901–1023px: intermediate desktop/pre-full dashboard sizing
- 1024–1279px: compact desktop
- 1280–1439px: standard desktop
- 1440–1919px: large desktop
- 1920px+: ultra-wide

Additional data/detail breakpoints may exist near 1100/1180/1680 where content density genuinely requires them.

Rules at every width:
- no essential action depends on hover
- no fixed menu overflows viewport
- long names truncate without hiding icon/action
- touch targets stay ~40px minimum where appropriate
- virtual keyboard must not cover active input/action
- use `100dvh` for full-height overlays
- respect safe-area insets

## 17. Accessibility
- keyboard, pointer, and touch all work
- focus-visible always visible
- icon-only controls have accessible names
- decorative icons are aria-hidden
- status never depends on color alone
- reduced motion respected
- tabs preserve tablist/tab/tabpanel semantics
- dialogs/search trap or manage focus correctly
- forms use labels, descriptions, invalid states, and error messaging
- touch targets remain usable on mobile

## 18. Component Registry
Core primitives:
- Button
- InputField
- SelectField
- TextareaField
- Checkbox
- Radio / Choice
- Toggle
- Card
- Badge
- Status
- Avatar
- Table family
- Tabs
- DropdownMenu
- Tooltip
- Dialog
- Alert
- Skeleton
- Spinner
- StatePanel
- Icon

Data:
- MetricCard
- LineChart
- DonutChart
- BarBreakdown

Product patterns:
- Sidebar
- Workspace menu
- Settings shell/navigation/sections/preference rows
- Global Search / command palette
- Data table
- Filters
- Pagination
- Bulk actions
- Theme selector
- Service-status banner
- Page notice
- Toast stack
- Audit log
- Detail drawer

KORO extension:
- Commerce header
- Mobile nav
- Storefront search capsule
- Category tile/grid
- Product card/grid
- PDP media gallery
- Product detail controls
- Cart line item
- Quantity stepper
- Order summary
- Checkout stepper
- Checkout item/plan card
- Payment method selector
- Discount row
- Totals
- Commerce notices/toasts

## 19. Page Composition Patterns
Capture and reuse composition, not only components:
- Dashboard home
- Data/list page
- Settings page
- Account page
- Audit log / inspect drawer page
- Search overlay
- Empty/loading/error screen
- Storefront landing page
- Product listing
- Product detail
- Cart
- Checkout
- Payment/result state

Each page pattern must define container, primary alignment axis, spacing rhythm, major sections, responsive reflow, and interaction/state behavior.

## 20. Project-Specific Exceptions
Preserve brand/content-specific values only when they are truly specific:
- external brand colors/logos
- avatar identity colors
- content-specific media ratios where justified
- payment provider marks
- KORO action emphasis aliases

Do not elevate random one-off CSS numbers into global tokens unless repeated intent is clear.

## 21. Technical Cleanup / Drift
- standardize or define `--shadow-card`
- keep command-search `--cs-*` namespace scoped, but alias shared spacing/motion/radius to core tokens where possible
- reduce unnecessary raw hex usage
- formalize named breakpoints
- keep Waya Core and KORO extension separate
- ensure referenced fonts are actually licensed/shipped or intentionally use fallbacks

## 22. Non-Negotiable DO NOTS
- Do not redesign approved navigation/search/settings interactions.
- Do not introduce generic SaaS cards everywhere.
- Do not add gradients without an existing token/pattern.
- Do not center every section.
- Do not invent arbitrary spacing values.
- Do not create new font sizes outside the type scale without documented need.
- Do not add large decorative shadows to static cards.
- Do not over-round every container.
- Do not crop product imagery aggressively.
- Do not make hover look more selected than the active state.
- Do not use color as the sole state cue.
- Do not duplicate a pattern that already exists.
- Do not flatten Waya and KORO into one ambiguous set of components.

## 23. Definition of Done for Any New Screen
A screen is design-system compliant only if:
1. It uses the shared typography, color, spacing, radius, border, motion and icon rules.
2. Its main content aligns to existing shell/container axes.
3. It reuses an existing primitive/pattern before inventing a new one.
4. It documents every interactive state.
5. It works with keyboard, pointer and touch.
6. It respects reduced motion.
7. It follows the responsive contract.
8. It preserves settings/search/table/commerce behavior where those patterns are used.
9. It does not introduce arbitrary visual language.
10. It remains recognizably part of the same Waya/KORO product family.
