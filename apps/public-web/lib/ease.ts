// Shared motion tokens. They mirror the Waya CSS custom properties and keep
// component movement predictable rather than springy or decorative.

export const EASE_STANDARD = [0.2, 0, 0, 1] as const;
export const EASE_OUT = [0.22, 1, 0.36, 1] as const;

/** CSS string form of EASE_OUT for inline style transitions. */
export const EASE_OUT_CSS = "cubic-bezier(0.22, 1, 0.36, 1)";
