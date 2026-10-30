# Waya product design system

Status: extracted from the current Settings dashboard, sidebar system, theme selector, and global command search. This document records the product language already present in the codebase; it is not a visual redesign.

The implementation source of truth is [`src/styles/product-tokens.css`](../src/styles/product-tokens.css). Component-specific search colors remain in [`src/styles/tokens.css`](../src/styles/tokens.css) because the command palette intentionally uses a darker, higher-contrast surface in both product themes.

## Principles

1. Quiet tonal surfaces, hairline borders, and restrained elevation establish hierarchy.
2. Typography and spacing carry most of the visual structure; color is used sparingly.
3. Purple indicates selection, focus, and user-controlled appearance. Orange belongs to the workspace brand mark.
4. Rows and controls should feel compact, but interactive targets must remain usable.
5. Every interaction must work with pointer, keyboard, and touch, and every state must be visible in both light and dark themes.

## Color tokens

Use semantic tokens in components. Do not bind component code directly to raw hex values unless the value is genuinely content-specific, such as an Apple, Adobe, or avatar brand color.

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--color-page` | `#ffffff` | `#0b0b0b` | Base application canvas |
| `--color-surface` | `#ffffff` | `#0b0b0b` | Main shell and persistent navigation |
| `--color-surface-raised` | `#ffffff` | `#151515` | Dialogs, menus, and floating popovers |
| `--color-surface-panel` | `#f8f8f8` | `#121212` | Dashboard cards, embedded panels, and grouped data regions |
| `--color-surface-subtle` | `#f6f6f6` | `#1a1a1a` | Quiet fills and icon containers |
| `--color-surface-hover` | `#f3f3f3` | `#202020` | Hovered interactive rows |
| `--color-surface-selected` | `#eeeeee` | `#242424` | Selected navigation and menu rows |
| `--color-text` | `#262626` | `#f2f2f2` | Default text |
| `--color-text-strong` | `#222222` | `#ffffff` | Titles and emphasized values |
| `--color-text-secondary` | `#555555` | `#cccccc` | Navigation labels and secondary actions |
| `--color-text-muted` | `#7b7b7b` | `#aaaaaa` | Descriptions, labels, metadata |
| `--color-text-soft` | `#898989` | `#8f8f8f` | Lowest-emphasis nonessential text |
| `--color-border` | `#f0f0f0` | `#242424` | Hairline dividers and quiet structural borders |
| `--color-border-strong` | `#e3e3e3` | `#343434` | Form controls and intentional stronger separation |
| `--color-accent` | `#6d3bf5` | `#6d3bf5` | Focus, selected checkbox, active accent |
| `--color-accent-on-dark` | `#8b5cf6` | `#8b5cf6` | Command-search caret and dark-surface accent |
| `--color-danger` | `#ba3a35` | same | Destructive actions and errors |
| `--color-success` | `#00a94f` | same | Verified and successful status |
| `--color-warning` | `#d89600` | same | Flagged or attention-needed status |
| `--color-info` | `#25a4ff` | same | Informational and role status |
| `--color-brand-workspace` | `#ff7900` | same | Workspace logo only |
| `--color-tooltip` | `#262626` | same | Tooltip background |
| `--color-action-primary` | `#252525` | `#f2f2f2` | Primary neutral action fill |
| `--color-action-primary-text` | `#ffffff` | `#0b0b0b` | Text/icon on a primary neutral action |
| `--color-key-bg` | `#f0f0f0` | `#2b2b2b` | Keyboard-hint background |
| `--color-key-text` | `#666666` | `#dddddd` | Keyboard-hint label |
| `--color-avatar-neutral-bg` | `#ececec` | `#242424` | Neutral avatar background |
| `--color-avatar-neutral-text` | `#555555` | `#f2f2f2` | Neutral avatar label |
| `--color-warning-surface` | `#faf6ea` | `#2b281e` | Inline warning/notice background |
| `--color-warning-text` | `#776331` | `#e3d39a` | Inline warning/notice copy |
| `--color-success-surface` | `#e9f8ef` | `#14271c` | Quiet successful feedback and badges |
| `--color-danger-surface` | `#fbecec` | `#321b1b` | Quiet error feedback and badges |
| `--color-info-surface` | `#eaf5ff` | `#152636` | Quiet informational feedback and badges |
| `--color-unread-surface` | `#f7f5ff` | `#211a35` | Unread-notification background |
| `--color-chart-users` | `#25a4ff` | same | User-series data visualization |
| `--color-chart-orders` | `#d89600` | same | Order-series data visualization |
| `--color-chart-activation` | `#e457ef` | same | Activation-rate data visualization |
| `--color-chart-success` | `#00a94f` | same | Successful order segments |
| `--color-chart-pending` | `#25a4ff` | same | Pending order segments |
| `--color-chart-failed` | `#ef3e36` | same | Failed order segments |
| `--color-data-tooltip` | `rgba(18,18,18,.92)` | same | High-contrast analytics tooltip surface |
| `--color-data-tooltip-text` | `#f5f5f5` | same | Analytics tooltip copy |

Legacy aliases such as `--page`, `--surface`, `--text`, `--line`, and `--accent` remain temporarily available. New code must use `--color-*` names.

### Color rules

- Text hierarchy should move through strong, default, secondary, muted, and soft tokens; do not create opacity-based gray variants per component.
- Use `--color-surface-panel` to group related content before adding an outline. Pale neutral fills should carry the card hierarchy in light mode; low-contrast charcoal fills do the same in dark mode.
- Selected and focused are different states: selected uses a surface plus an optional accent marker; focus always uses the focus ring.
- Status color is never the only cue. Pair it with a label or icon.
- Chart colors identify stable series, not decoration. Always pair them with a visible legend or accessible chart label and keep the series mapping consistent across themes.
- Product themes change neutral surfaces and text. Brand and semantic colors remain stable unless contrast testing requires their documented dark variant.
- Component styles must not hardcode neutral fills or text colors. Fixed values are limited to documented theme-preview swatches, identity/avatar colors, company marks, chart series, and semantic status colors.
- “On color” content uses `--color-on-accent` or the corresponding component token; do not assume white text is correct in both themes. Primary neutral buttons invert in dark mode through `--color-action-primary-text`.

## Typography

### Families

- Headings: `var(--font-heading)` = Ashcroft, then the current Playfair Display fallback, then Georgia.
- Body and UI: `var(--font-body)` = Geist, then DM Sans and Arial fallbacks.
- Keyboard hints and identifiers: `var(--font-mono)`.

Ashcroft is the required product heading face, but no licensed Ashcroft webfont is present in this repository. The token is ready for it. Add licensed `woff2` files and a matching `@font-face` declaration without changing component styles. Playfair Display preserves the current serif direction until then.

Geist is declared once in `product-tokens.css`; components must not import or redeclare it. Use body weights 400, 500, and 600. Use heading weight 400.

### Type scale

| Token | Size | Typical use |
| --- | ---: | --- |
| `--font-size-2xs` | 9px | Compact role/status chips only |
| `--font-size-xs` | 10px | Tiny badges and abbreviated metadata |
| `--font-size-sm` | 11px | Secondary metadata |
| `--font-size-caption` | 12px | Keyboard hints, section labels |
| `--font-size-label` | 13px | Control labels, menu items |
| `--font-size-body-sm` | 14px | Compact UI rows |
| `--font-size-body` | 15px | Default body |
| `--font-size-body-lg` | 16px | Emphasized body and card titles |
| `--font-size-title-sm` | 18px | Panel title |
| `--font-size-title` | 20px | Dialog title |
| `--font-size-display-mobile` | 39px | Mobile page heading |
| `--font-size-display` | 48px | Desktop page heading |

Use `--line-height-tight` for display headings, `--line-height-ui` for one-line controls, and `--line-height-body` for prose. The existing negative tracking belongs only to display headings (`-.04em`) and dense search labels (`-.015em` to `-.018em`). Do not apply tracking globally.

## Spacing

The product uses a 4px base with optical half-steps retained from the current interface.

| Token sequence | Pixels |
| --- | --- |
| `--space-0`, `--space-0-5` | 0, 2 |
| `--space-1`, `--space-1-5` | 4, 6 |
| `--space-2`, `--space-2-5` | 8, 10 |
| `--space-3`, `--space-3-5` | 12, 14 |
| `--space-4`, `--space-4-5`, `--space-5` | 16, 18, 20 |
| `--space-6`, `--space-7`, `--space-8` | 24, 28, 32 |
| `--space-10`, `--space-12`, `--space-14` | 40, 48, 56 |
| `--space-16`, `--space-18`, `--space-20` | 64, 72, 80 |

Use 8–12px inside compact controls, 14–20px inside rows and cards, 24–32px between related blocks, and 48–80px between major regions. Use an optical half-step only when icon/text alignment visibly needs it; do not add arbitrary 1px spacing values.

## Shape, elevation, and motion

| Category | Tokens and use |
| --- | --- |
| Small radius | 3px search icon controls, 4px result rows/tooltips, 5px controls |
| Structural radius | 6px search shell and compact panels, 8px cards/popovers, 10px dialogs, 12px mobile sheets |
| Round radius | 50% avatars, 999px chips and status badges |
| Structural border | `--border-width-hairline` = 0.5px for dividers, cards, menus, tables, and shell boundaries |
| Control border | `--border-width-control` = 1px for inputs, selects, checkboxes, and radio controls |
| Focus border | `--border-width-focus` = 2px for focus-visible rings only |
| Popover shadow | `--shadow-popover` |
| Menu shadow | `--shadow-menu` |
| Dialog shadow | `--shadow-dialog` |
| Toast shadow | `--shadow-toast` |
| Tooltip shadow | `--shadow-tooltip` |

Structural separation should be visually quiet. Prefer a panel fill plus an optional hairline; do not use 1.5px or 2px static outlines to define cards, rows, tables, or navigation. Controls retain a crisp 1px edge for affordance, while 2px is reserved for keyboard focus.

The current motion language uses 150ms for feedback, 180ms for sidebar width, 250ms for menus/dialogs, 350ms for deliberate state drawing, and 500ms for a single emphasized pop. Use `--motion-ease-standard` for spatial transitions, `--motion-ease-out` for entrances, and `--motion-ease-spring` only for small badge/check feedback. Reduced-motion mode collapses shared motion durations to 1ms.

## Layout

- Product shell: full viewport width and a minimum height of 100vh on desktop; do not add a centered max-width wrapper or decorative outer margin. The light canvas is always pure white.
- Sidebar: 247px expanded and 60px collapsed. It is a persistent column on desktop and a temporary navigation surface on tablet/mobile.
- Content gutter: 16px compact desktop, 20px standard desktop, 24px large desktop and tablet, 16px mobile.
- Settings content: two columns, with a 480px maximum content column and a 72px inter-column gap.
- Ultra-wide settings content: keep readable form/settings blocks left-aligned within a 1440px maximum inner region; data-heavy pages continue using the full content width.
- Command search: 810px × 525px maximum on desktop. It becomes a full-height, edge-to-edge interaction on mobile.
- Dialog: 500px maximum width on desktop. On mobile it becomes a bottom sheet with a 12px top radius.

Do not center each section independently. Page title, tabs, section dividers, and content columns share the content grid. Keep labels and their editable values on consistent vertical axes.

## Icons

The UI uses outlined Mingcute-style geometry through the existing icon helper. Maintain a common optical box even when path shapes differ.

| Context | Size | Stroke |
| --- | ---: | ---: |
| Inline utility/status | 13px | 1.7 |
| Compact menu | 15px | 1.7 |
| Sidebar/default action | 17px | 1.5 |
| Large action | 18px | 1.7 |
| Icon alignment box | 20px | — |

- Center icons inside a fixed box; align the box, not the SVG path, to text.
- Use `currentColor` so hover, selected, disabled, and dark mode inherit correctly.
- Keep labels 8–12px from icons. Sidebar navigation uses 12px; compact menu rows use 9px.
- Use one icon that matches the action. Navigation, action, and semantic status icons remain outlined and use the same stroke weight within a column.
- Decorative icons use `aria-hidden="true"`; icon-only controls require an accessible name.

## Component patterns

### Component registry

| Pattern | Current implementation | Reuse status |
| --- | --- | --- |
| Global search | `src/components/command-search/` | Production-ready React component with exported subparts and types |
| Buttons, fields, choices, cards, badges, avatars, tables | `src/components/ui/primitives.tsx` | Production-ready React primitives |
| Tabs, dropdown menus, tooltips, dialogs | `src/components/ui/overlays.tsx` | Production-ready controlled and keyboard-accessible React components |
| Alerts, loading, empty and error panels | `src/components/ui/feedback.tsx` | Production-ready React feedback components |
| Metric cards, line charts, donut charts, bar breakdowns | `src/components/ui/analytics.tsx` | Production-ready, dependency-free, theme-aware React analytics components |
| Shared component styles | `src/styles/components.css` | Canonical visual and responsive implementation for React components |
| Sidebar and workspace menu | `settings-dashboard/sidebar-system.js` and `.css` | Canonical dashboard shell behavior and visual reference |
| Theme selector | `settings-dashboard/theme-preview.js` and `.css` | Canonical preview/check interaction; currently dashboard-local |
| Data table, filters, pagination, bulk actions | `settings-dashboard/dashboard-pages.js` and `.css` | Canonical dashboard table pattern, including responsive card rows |
| Home analytics dashboard | `settings-dashboard/dashboard-pages.js` and `home-dashboard.css` | Canonical metric-card, line-chart, status-breakdown, and responsive analytics grid |
| Toast notifications | `settings-dashboard/toast-system.js` and `.css` | Reusable success, error, warning, info, loading/progress, action, dismiss, stacking, and timing API |
| Account page | `settings-dashboard/dashboard-pages.js` and `account-page.css` | Canonical balance card, transfer-details rail, and account transaction table |
| Service-status banner | `settings-dashboard/index.html` and `styles.css` | Reusable app-level notice above the product shell |
| Audit log | `settings-dashboard/dashboard-pages.js` and `audit-log.css` | Canonical activity table, shared anchored filter panel and event detail drawer |
| Page notice | `settings-dashboard/audit-log.css` (`.page-notice`) | Reusable full-bleed notice inside a page, below the top bar |
| Detail drawer | `settings-dashboard/audit-log.css` (`.audit-drawer`) | Canonical right-hand record drawer with prev/next stepping; 600px overlay on regular desktops and a 540–600px split inspection workspace from 1680px |

Do not create a second visual implementation of a dashboard-local pattern. Either reuse its classes and behavior in the current static host or extract it into a component while keeping the same tokens, states, and accessible semantics.

### React usage

Shared React components are exported from one entry point. Import the product tokens and component styles once at the application root.

```tsx
import './styles/product-tokens.css'
import './styles/components.css'
import {
  Button, InputField, Status, Table, Dialog,
  MetricCard, LineChart, DonutChart, Alert,
} from './components/ui'
```

The live component catalogue at the project root is the interaction and visual reference for every exported state in light and dark mode. The full dashboard remains the product-shell reference.

### Buttons

- Accent: purple fill for the single highest-emphasis user action in a decision area.
- Primary: theme-inverting neutral fill for strong, non-accented actions.
- Secondary: surface fill, standard border, default text.
- Quiet/icon: transparent until hover; use a subtle surface on hover.
- Destructive: danger color with an explicit destructive label.
- Keep verbs specific: “Save changes”, “Set 2FA”, and “Clear filter”, rather than generic “OK”.

All button variants need hover, active, focus-visible, disabled, and pending states. While pending, preserve width, disable repeat submission, show a 15px spinner, and retain a meaningful label.

### Inputs

Inputs use a 1px strong border, 6px radius, 10px vertical/11px horizontal padding, surface background, and inherited body typography. Labels appear above the control in muted 14px text. Errors appear below the field and set `aria-invalid`; do not use placeholder text as a label.

Search is intentionally different: the idle field merges into the header; focus or entered text activates the filled field. The caret is purple. “Clear” is only present when a query exists.

### Sidebar

- Expanded width is 247px; collapsed width is 60px.
- Navigation rows are 40px in the refined sidebar, use a 5px radius, and keep icons on one vertical axis.
- The workspace logo remains visible in both modes. Copy disappears only after the collapse transition.
- Selected navigation uses a subtle surface and stronger text; hover must not look more selected than the current route.
- When collapsed, show the 36px dark tooltip to the outside of the sidebar. Never place it over the icon or label.
- Badge counts become a dot in collapsed mode and restore their full label when expanded.

### Workspace dropdown

Use the existing 245px menu, 8px padding, 6px radius, menu shadow, 36px rows, 17px icon column, and semantic surface/text tokens. Anchor it to the workspace trigger and keep it within the viewport. The header uses a 34px workspace mark, workspace name, account, and role chip before actions.

### Tooltips

The canonical tooltip is the floating/sidebar tooltip pattern: dark surface, white text, 14px/500, 7px × 10px padding, 4px radius, minimum 36px height, 8px diamond arrow, and optional light keyboard key. Open after 80ms and close immediately. Cap long content at 300px and allow wrapping.

Tooltips explain unfamiliar icon-only actions; they do not repeat visible labels. They are never interactive and must open on hover and keyboard focus. Position them outside the trigger so they do not hide the label—the previous overlapping pseudo-element tooltip is deprecated.

### Tabs

Tabs sit on a hairline divider, remain 39px high, and use a 1px bottom indicator for selection. The selected tab has stronger text; hover changes text only. Preserve `tablist`, `tab`, `tabpanel`, arrow-key movement, and `aria-selected` semantics.

### Global search

- The trigger is centered in the utility bar and shows search copy plus the platform shortcut.
- Header height is 56px. The 40px search field and icon controls share an optical left axis.
- Opening the filter reveals the filter row; selecting a filter narrows actual results. Query changes show the skeleton loading state before results.
- Result rows are 56px minimum and display identity, metadata, and an arrow affordance. Keyboard selection uses the same visual state as hover.
- Footer remains 53px high with Navigate, Open, and Close instructions; keyboard keys use the filled key style.
- Required states are idle, focused, query loading, populated, filtered, no results, and recoverable error.

### Service-status banner

An app-level notice sits above the shell, spanning the sidebar and content. It uses the warning surface and text tokens, a 13px status icon, centered copy, and one inline text action that resolves the notice. It is sticky above 900px so the notice stays visible while the page scrolls; the sticky sidebar and content offset by `--system-banner-height` so nothing is clipped. Below 600px the banner wraps rather than truncating.

Use it only for conditions that affect the whole workspace, such as a partner outage or scheduled maintenance. A problem confined to one screen belongs in an inline alert, and the result of a user action belongs in a toast.

### Account page

The account screen pairs a balance summary with the shared table pattern and a transfer-details rail.

- Balance card: panel surface, 8px radius, no shadow, a quiet 15px label above a 39px tabular value, and a 36px quiet refresh control in the top-right corner. The refresh control keeps focus while pending and reports its result through a toast.
- Toolbar: the shared table search and anchored filter popover on the left, Download on the right, sharing one 38px optical axis.
- Table: the canonical `.data-table` in an account variant whose columns are proportional, so the table fills the main column instead of scrolling behind the rail. Amount is right-aligned with tabular figures and Date does not wrap. Because this table ends on Amount rather than Date, its mobile card keeps that field's label and emphasizes the value.
- Scrolling: the rows scroll inside their own box, exactly as `.transactions-table-scroll` does, so pagination stays pinned to the bottom of the viewport and the page itself does not scroll. The column headers are frozen at the top of that box so they stay readable at any scroll position; because `border-collapse: collapse` paints cell borders on the table rather than the cell, the sticky header draws its divider with a shadow instead of a border. The page-size control sets how many rows the page holds, not how many fit on screen — a 20-row page scrolls within the box, and how much is visible follows the viewport height. Any data page that pairs a table with pagination uses this treatment; its offset is the shared shell chrome plus whatever that page puts above the table.
- Details rail: 320px on large desktop, and stacked under the table below 1440px so the table keeps the full content width. Each row is a label above its value with a quiet copy control; a successful copy swaps that control for the success check for 1.6s and also announces through a toast. `Copy all details` copies every field as labelled lines.

### Page notice

A page notice sits directly under the top bar, inside the content column but bled to both shell edges by cancelling the content gutter (`margin-inline: calc(var(--content-gutter) * -1)`). It uses a semantic surface token, a 13px icon, centred copy and one inline action that resolves it. Use it for a condition that is true of one screen — a retention window, a sync delay — and keep the service-status banner for conditions that affect the whole workspace.

### Table filters

Account defines the canonical data-table filter interaction. The Filter button opens one anchored `.table-filter-panel` beneath its trigger and carries `aria-expanded` plus `aria-controls`. The panel groups each filter dimension under a short label and presents values with the shared selectable `.filter-chip` control.

Selecting an option updates the table immediately while leaving the panel open for multi-dimensional filtering. Selected options use `aria-pressed="true"`; the Filter trigger shows the number of active dimensions after the panel closes. Reset clears every dimension but leaves the panel open for review, while Done closes it. Clicking outside or pressing Escape also closes it without discarding selected values.

Audit Log reuses this Account pattern for Activity, Role, and Date. Selected values are then surfaced above the table as segmented, removable applied-filter controls with one shared Clear filter action. On mobile the selection panel becomes the existing viewport-safe bottom sheet. Do not duplicate the crowded member-name chip list in this panel.

After a value is selected, Audit Log also renders a compact applied-filter summary above the table. Each item pairs the dimension label with its selected value and a dedicated remove action; `Clear filter` removes the full set. This row is a read-and-remove summary only—the anchored Account-style panel remains the single place where filter values are chosen.

### Detail drawer

A record drawer is an 8px-radius raised panel inset 12px from the safe viewport edges. At 1440px and above it creates a split inspection workspace: the app shell yields space to the drawer so the selected row and all data columns remain visible. On smaller desktop and tablet widths it overlays the page with the shared scrim; below 600px it becomes a bottom sheet.

- Opening moves focus to the drawer's close control; closing returns focus to the row control that opened it. Escape closes it.
- The body is a header, an identity block, an uppercase section label per group, and label/value rows on a 132px label column.
- Previous/next step through the current filtered result set, following the filter and paging to the row's page rather than escaping the user's context. The unavailable direction is disabled at either end.
- On mobile the label/value rows stack and the footer actions remain within the safe viewport width.

### Cards and lists

Cards use an 8px radius and `--color-surface-panel` without a shadow by default. Add only a hairline border when the panel needs separation from an adjacent surface. Use shadow only when the element floats over content. Session rows use hairline separators within one 8px container rather than separate card shadows.

### Analytics interaction

- Line charts expose one keyboard-focusable hit area per date. Hover or focus shows the exact date and every series value, adds a vertical guideline and point markers, brightens the nearest series, and dims the others to 50%.
- Pie/donut slices expose their count and percentage, scale to 111%, dim non-active slices to 60%, and highlight the matching legend row.
- Brokerage bars expose exact amount and percentage, grow by 3px, and use the shared accent glow. The total metric explains that it is the sum of every category and highlights all bars together.
- Analytics cards use `--color-surface-subtle`, the strong hairline, and `--shadow-card-interactive` on hover. Chart targets use pointer/crosshair cursors; non-actionable card space retains the default cursor.
- Data tooltips use the shared 92%-opaque surface, 80ms entrance delay, 150ms fade/scale entrance, immediate 50ms exit, and viewport-aware edge transforms. Pointer and keyboard focus produce identical information.
- Reduced-motion mode removes chart, slice, bar, card, and tooltip transitions without removing the state change itself.

### Tables

The canonical dashboard table is the `.data-table` pattern. It uses semantic table markup, 15px body copy, a quiet hairline row divider, 52px minimum rows, 14px horizontal cell padding, a subtle hover surface, and a stronger selected-row surface. Status is always communicated by icon, color, and text. Selection uses the shared 16px checkbox and exposes a fixed bulk-action bar only while rows are selected.

Keep the header and pagination visually quiet. Filters are anchored popovers, loading rows preserve column geometry with skeletons, and empty/error states occupy the expected table region without collapsing the page. On mobile, each row becomes a single-column summary card whose fields retain their labels through `data-label`; do not force a desktop table into a narrow horizontal viewport.

### Modals, popovers, and sheets

Desktop dialogs are centered, maximum 500px wide, 10px radius, raised surface, and dialog shadow over the existing translucent backdrop. Popovers are content-sized (215px base; 340px for notifications), 8px radius, and anchored to their trigger. At mobile width, dialogs become bottom sheets and should leave the title and dismiss action visible above scrollable content.

### Status badges and toasts

Badges use pill geometry and pair icon, color, and text. Product toasts use a semantic raised surface, hairline border, 8px radius, toast shadow, a 20px status icon, concise title/message copy, an optional inline action, and a dedicated close control. The reusable API supports success, error, warning, information, loading/progress, in-place updates, manual dismissal, and per-toast auto-dismiss timing.

Toast stacks are capped at five and appear at the top-right on desktop, 20px from the safe viewport edges. Newest messages occupy the first visual position and older messages stack downward. Items enter with a short rise/fade/blur transition and exit with a shorter fade/scale transition; reduced-motion removes transforms and blur. On mobile, the stack keeps the existing bottom placement, respects a 16px safe gutter, and each toast fills the available width. Loading toasts persist until updated or dismissed; errors remain longer than success confirmations and should include Retry when recovery is possible.

## Interaction states

| State | Required treatment |
| --- | --- |
| Hover | Subtle surface or text-strength change; never move layout |
| Active/pressed | Slightly stronger surface or existing compact scale feedback; preserve target size |
| Selected/current | Persistent selected surface/indicator plus `aria-selected`, `aria-current`, or `aria-pressed` |
| Focus-visible | `--focus-ring`, 2px offset; inset only when an outer ring would be clipped |
| Disabled | `--opacity-disabled`, `not-allowed` cursor, no hover/press feedback, native/ARIA disabled state |
| Loading | Preserve container geometry; use spinner for actions and skeleton rows for fetched result sets |
| Empty | Plain-language message in the expected content area with one recovery action when useful |
| Error | Explain what failed and provide Retry when recovery is possible; do not show a permanent spinner |

Loading skeletons must match the geometry of the content they replace. Empty and error states must not collapse the modal or make the footer jump.

## Responsive behavior

| Range | Behavior |
| --- | --- |
| Compact desktop: 1024–1279px | Full-width shell, persistent/collapsible sidebar, 16px content gutter, two-column settings sections |
| Standard desktop: 1280–1439px | Full-width shell, persistent/collapsible sidebar, standard 20px content gutter |
| Large desktop: 1440–1919px | Full-width shell with 24px content gutter; tables expand with the grid |
| Ultra-wide desktop: 1920px and above | Full-width shell; data pages remain fluid while readable settings blocks stop at 1440px |
| Existing intermediate: 901–1023px | Preserve the current pre-desktop layout behavior; desktop-specific sizing begins at 1024px |
| Tablet: 601–900px | Full-width shell, temporary navigation, 24px content gutter, single-column settings sections, preserve dialogs where they fit |
| Mobile: 600px and below | 16px gutter, compact top bar, horizontally scrollable tabs/filters, stacked appearance choices where needed, bottom-sheet dialogs, full-height command search |

Responsive changes occur because space or interaction mode changes, not because of a device name. At every width:

- no essential action may depend on hover;
- no fixed-width menu may overflow the viewport;
- long names truncate without hiding their icon or action;
- touch targets should remain at least 40px high for primary navigation and controls;
- the virtual keyboard must not cover the active search input or dialog action;
- use `100dvh` for full-height overlays and respect safe-area insets where supported.

The old 580/581px split has been consolidated to 600/601px so the dashboard and command search change modes together. The 900px sidebar breakpoint remains the tablet boundary.

## Do and don’t

| Do | Don’t |
| --- | --- |
| Use semantic product tokens | Copy hex values into a new component |
| Use Ashcroft for page-level headings and Geist for UI/body | Mix DM Sans, Inter, Playfair, and Geist within one surface |
| Align icons through fixed optical boxes | Nudge individual SVG paths with arbitrary margins |
| Reuse 5/6/8/10/12px radii by component level | Give every new component a different radius |
| Use pale neutral panel fills and hairline separators for grouping | Box every region with a medium-gray or thick outline |
| Keep menus and tooltips outside their trigger and within the viewport | Cover the icon or visible label with a tooltip |
| Use skeletons only while a real search/request is pending | Show decorative loading after results are already available |
| Preserve height between loading, empty, and result states | Let state changes resize the dialog unexpectedly |
| Test keyboard, pointer, touch, light, dark, and system themes | Treat a mouse-only light-mode screenshot as complete |
| Add a documented pattern when a genuinely new need appears | Force an unrelated component style onto a new problem silently |

## Current inconsistencies and standardization plan

| Priority | Current inconsistency | Standard |
| --- | --- | --- |
| High | Four UI font declarations: DM Sans, Geist, Inter, and Playfair | Ashcroft headings; Geist body/UI; mono only for keys/identifiers |
| High | Purple values `#7652ef`, `#6d3bf5`, `#8b5cf6`, and `#a78bfa` used interchangeably | `--color-accent` for product UI, `--color-accent-on-dark` for dark search surfaces, semantic focus token for rings |
| High | Legacy pseudo-element tooltip, transitions tooltip, floating sidebar tooltip, and search tooltip overlap | Floating tooltip anatomy is canonical; search may retain inverse theme colors but should share sizing/timing tokens |
| High | Sidebar base rules and refined sidebar rules both define widths, row heights, and collapsed behavior | Refined `.sidebar-system` rules own the sidebar; remove legacy rules after markup migration is complete |
| Medium | Mobile boundaries used both 580px and 600px | 600px mobile, 900px tablet |
| Medium | Focus styles varied between purple hexes, rgba inset rings, and input-specific overrides | Use `--focus-ring`; use `--focus-ring-muted` only for clipped inset focus |
| Medium | Icon sizes and strokes ranged without a context rule | 13/15/17/18px scale; 17px and 1.5 stroke for navigation |
| Medium | Motion values were redeclared per stylesheet | Shared duration/easing tokens; component aliases only for meaningful choreography |
| Medium | Disabled styles were absent from much of the static dashboard | Shared disabled opacity/cursor plus component-specific contrast checking |
| Medium | Structural borders used mixed 0.5px, 1px, and 1.5px weights | 0.5px hairlines for structure, 1px for controls, and 2px only for focus-visible rings |
| Low | Radius values include several one-off sizes | Use the documented radius scale; retain a one-off only for a proven optical need |
| Deferred | No canonical production table exists | Build the first table from row/list primitives, validate it, then document it as canonical |

## Implementation usage

Load shared tokens before component styles:

```ts
import './styles/product-tokens.css'
import './styles/tokens.css' // only when CommandSearch is present
```

Consume semantic values:

```css
.product-card {
  padding: var(--space-4);
  border: var(--border-width-hairline) solid var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--color-surface-panel);
  color: var(--color-text);
  font-family: var(--font-body);
}

.product-card:focus-visible {
  outline: var(--focus-ring);
  outline-offset: 2px;
}
```

Theme selection belongs on the root element as `data-theme="light"` or `data-theme="dark"`. “System” resolves the operating-system preference and applies one of those values. Components must not maintain a separate theme state.

## Review checklist

Before a new screen is complete, verify:

- tokens are used for shared colors, spacing, radius, motion, and typography;
- title, tabs, dividers, fields, and actions align to the page grid;
- all icons use an approved size, stroke, and accessible treatment;
- hover, pressed, selected, focus-visible, disabled, loading, empty, and error states are present where applicable;
- light, dark, and system theme behavior is correct;
- keyboard order and semantics match visual order;
- desktop, tablet, and mobile layouts work at their boundary widths;
- reduced motion is respected;
- no tooltip, dropdown, toast, or modal is clipped or blocks its trigger label.
