/**
 * The clinic switch: whether the blue EHR opens at every facility (blueFacilities.ts blueForAll), once the clinical and
 * the department pages are both merged. Until then, and while this is false, only the four demo facilities open it, so
 * those pages can merge for the demo tenant without moving any real clinic. Switching the clinics over is a one-line PR
 * that sets this to true, once the switch review is clean.
 */
export const BLUE_FOR_ALL = false
