// A production build must also supply a connected service adapter.
declare const __HEALTH_ID_DEMO__: boolean;
export const DEMO_MODE =
  typeof __HEALTH_ID_DEMO__ === "undefined" ? true : __HEALTH_ID_DEMO__;
