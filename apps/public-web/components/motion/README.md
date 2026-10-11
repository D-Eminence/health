Motion sources: https://github.com/starc007/ui-components
Guidance: https://beui.dev/docs/motion-patterns

shared-layout-bg.tsx, bouncy-accordion.tsx and button/stateful.tsx (built on button/base.tsx) are adapted from the public Be UI components.
Their ease (lib/ease.ts) and class-name (lib/utils.ts) helpers are kept under lib/. lib/hooks/use-hover-capable.ts is no longer imported by any component.
Reveal.tsx follows the Be UI content-reveal recipe with reduced-motion support.
The application has no tilt or glare effects and uses short reveals.
