# Master Implementation Prompt — Waya + KORO Design System

Use this prompt whenever building or extending a project with this design system.

---

You are working inside an established product design system. Do **not** redesign the product and do **not** introduce a generic SaaS visual language.

Your job is to build the requested screen or feature while preserving the existing Waya + KORO design language exactly.

## SOURCE OF TRUTH
Read and follow `MASTER_DESIGN_SYSTEM.md` before writing or changing UI code. Treat it as authoritative for foundations, spacing, alignment, grids, typography, cards, stats, settings, global search, navigation, forms, tables, feedback, overlays, responsive behavior, accessibility, and KORO commerce patterns.

Also read `DO_NOTS.md` and obey it as a hard constraint.

## SYSTEM ARCHITECTURE
The product has two layers:

1. **Waya Core**
   - foundations
   - layout/grid/alignment
   - navigation/sidebar/workspace menu
   - settings
   - global search / command palette
   - forms and controls
   - cards
   - data tables, filters, pagination and bulk actions
   - stats/analytics
   - dialogs, drawers, menus, tooltips
   - feedback/toasts/states
   - accessibility and responsive behavior

2. **KORO Commerce Extension**
   - commerce header/mobile nav
   - storefront search capsule
   - category tiles/grids
   - product cards/grids
   - product detail/gallery
   - cart
   - quantity stepper
   - order summary
   - checkout steps
   - payment methods
   - discount/totals
   - commerce notices/toasts

KORO must inherit core foundations. Do not duplicate tokens or create a separate visual language.

## BEFORE BUILDING
First inspect the existing codebase and identify:
- an existing primitive that solves the need;
- an existing product pattern that solves the need;
- the correct token values for spacing, color, typography, radius, border, shadow, motion and breakpoint behavior;
- the approved layout/alignment axis for the page;
- the states and responsive behavior already used by similar components.

Reuse before creating.

If a new component is genuinely required, make it composable and add it to the correct layer of the system. Do not create a one-off component that duplicates an existing pattern.

## VISUAL RULES
Preserve the following character:
- quiet neutral surfaces;
- strong hierarchy through spacing and typography;
- hairline structural borders;
- restrained radius;
- restrained static elevation;
- shared left/right alignment axes;
- compact operational controls on desktop;
- touch-safe controls on mobile;
- functional, fast motion;
- serif display/headings + restrained sans-serif UI/body;
- purple is Waya selection/focus/accent;
- charcoal is KORO storefront action emphasis;
- status uses icon/text as well as color.

Do not add decorative gradients, giant radii, floating SaaS cards, excessive shadows, random centered sections, or arbitrary accent colors.

## SPACING AND ALIGNMENT
Use the documented 4px-based spacing scale. Prefer existing values instead of arbitrary pixel numbers.

Keep page title, tabs, sections, cards, tables, filters and footers on shared axes. Do not independently recenter sections.

Respect the existing content gutters and max-width rules:
- dashboard gutters: 16/20/24px by density/viewport;
- mobile: 16px;
- tablet/large: 24px;
- KORO storefront max width: 1280px;
- readable settings regions stay left-anchored and do not stretch unnecessarily;
- data-heavy pages may use wider fluid regions.

## SETTINGS
Treat Settings as a complete pattern, not merely a form.

Preserve:
- settings shell and navigation;
- readable left-anchored content;
- section title/description/control hierarchy;
- preference rows;
- toggles/selects/connected-account rows;
- theme/appearance patterns;
- save/pending/unsaved changes behavior;
- validation;
- security/session states;
- danger zones;
- responsive stacking.

Do not redesign Settings into unrelated card layouts.

## GLOBAL SEARCH
Treat Global Search as a first-class command/search system distinct from KORO storefront search.

Preserve:
- trigger and shortcut affordance;
- modal/overlay behavior;
- desktop scale and mobile full-height mode;
- input focus management;
- recent/suggested/grouped results;
- result row anatomy;
- metadata and icons/avatars;
- active keyboard result state;
- filters/scopes;
- loading skeleton;
- empty state;
- error/retry state;
- arrow-key navigation;
- Enter activation;
- Escape close;
- focus return to trigger;
- virtual-keyboard-safe mobile behavior.

Do not simplify global search into a normal text field.

## CARDS AND STATS
Do not make every content block a raised card.

Cards generally use:
- tonal/panel surface;
- hairline border if needed;
- 6–8px radius;
- 12–16px padding;
- little or no static shadow;
- hover elevation only when the entire card is interactive.

Stats/metrics:
- value is dominant;
- label is muted;
- trend/status is secondary;
- use tabular numerals where alignment matters;
- responsive collapse must preserve comparison.

## TABLES AND DATA PAGES
Use semantic tables at larger widths and responsive labeled row-cards on narrow screens.

Preserve:
- hairline separators;
- quiet header/pagination;
- row hover and selected states;
- checkbox selection;
- bulk actions;
- anchored filters;
- applied-filter summary;
- skeleton loading rows;
- empty/error states;
- detail drawer behavior where relevant.

## FORMS
Fields keep visible labels, supporting/error text, semantic invalid states and visible focus. Placeholder is never the only label.

Every action/control must define:
- default
- hover
- active/pressed
- focus-visible
- selected/current when relevant
- disabled
- loading/pending
- success/error where relevant

Do not conflate hover, selected and focus.

## RESPONSIVE BEHAVIOR
Use the design-system breakpoints and respond to content constraints, not device names alone.

At every width:
- no essential action depends on hover;
- menus/popovers remain within viewport;
- long text truncates without hiding icons/actions;
- primary controls remain touch-safe;
- full-height overlays use `100dvh`;
- safe-area insets are respected;
- virtual keyboard must not hide active input or critical actions.

## ACCESSIBILITY
Every interaction must work with keyboard, pointer and touch.

Maintain:
- visible focus;
- semantic labels;
- accessible icon-only buttons;
- aria-selected/current/pressed where appropriate;
- status cues beyond color;
- reduced-motion support;
- focus management in dialogs, drawers and global search;
- correct tab semantics;
- readable error and recovery states.

## IMPLEMENTATION DISCIPLINE
- Use shared tokens instead of raw values whenever a token exists.
- Use shared primitives instead of duplicating markup/styles.
- Keep Waya core and KORO extension boundaries clear.
- If you discover a repeated value/pattern missing from the system, propose a named token/pattern rather than scattering the value through the code.
- If legacy code conflicts with the documented design system, prefer the documented system unless the existing behavior is clearly intentional and product-specific.
- Fix `--shadow-card` drift by using the canonical card-elevation token.
- Keep command-search component-scoped color tokens, but alias shared spacing/radius/motion to core tokens where practical.

## DO NOT
- Do not redesign approved UI.
- Do not introduce generic SaaS styling.
- Do not add random gradients.
- Do not use giant rounded containers.
- Do not add heavy shadows to static cards.
- Do not invent arbitrary spacing/font sizes.
- Do not center every section.
- Do not crop important product imagery to force decorative fills.
- Do not create a second version of an existing pattern.
- Do not remove states, responsive behavior or accessibility to make implementation shorter.

## FINAL SELF-CHECK
Before finishing, verify:
1. The screen uses the correct shared tokens.
2. Spacing follows the scale.
3. Alignment matches existing shell axes.
4. Existing components/patterns were reused where possible.
5. Settings/Global Search behavior is preserved when used.
6. Cards/stats use the approved density and hierarchy.
7. All interaction states exist.
8. Keyboard, pointer and touch work.
9. Mobile/tablet/desktop layouts are intentional.
10. No new visual language has been introduced.

Build the requested feature only after applying these rules.
