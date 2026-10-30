# @hid/ui/ehr

The design foundation for the blue Health ID Hospital EHR: tokens and core
primitives, ported in look and behaviour from the read-only `design/ehr-target`
reference. Nothing in the product uses it yet, and it changes nothing in the
live `@hid/ui` entry point.

```tsx
import '@hid/ui/ehr.css'
import { EhrAppShell, EhrSidebar, EhrTopBar, EhrPageHeading } from '@hid/ui/ehr'
```

- **Scope.** Every rule in `ehr.css` sits under `.hid-ehr`, which `EhrAppShell`
  renders (an overlay used without a shell wraps itself in one). Classes are
  `hid-ehr-*`, custom properties `--ehr-*` (declared on `.hid-ehr`, mirrored in
  `tokens.ts`) and keyframes `hid-ehr-*`. No `--color-*` name is defined.
- **Overlays.** `EhrDrawer`, `EhrDialog` and the phone menu portal into the
  shell's overlay layer. While one is open, the workspace and any lower overlay
  are `inert`; the shell clears `inert` before focus returns to the opener.
- **No storage, no viewport script.** Sidebar collapse and group state are
  props or memory. Phone layout is CSS: the rail hides at 768px and below, and
  the top bar's menu button opens the same navigation as a modal panel.
- **Toasts** keep the live `ToastProvider` and its look; the shell isolates its
  stacking context so the live toast region paints above it.
- **Fonts** are self-hosted in `fonts/` with their SIL Open Font License texts.
