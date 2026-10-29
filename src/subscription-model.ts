import { Database, Hospital, Membership, Subscription } from "./model";
export const defaultSubscriptionConfig = {
  trialDays: 21,
  graceDays: 21,
  reminderDays: [14, 7, 3, 1],
  renewalDays: 30,
  provider: "bachs.io (unconfirmed; not connected)",
};
export const DAY = 86400000;
export const simulationNow = (db: Database) => db.simulationTime ?? Date.now();
export const subscriptionAllowed = (m: Membership) =>
  ["Hospital Owner", "Hospital Admin", "Billing Officer"].includes(m.role) &&
  !m.deniedPermissions.includes("subscription.view");
export const pendingFacility = (h: Hospital) =>
  !!h.registrationProfile && h.verification !== "verified";
export function subscriptionState(db: Database, sub: Subscription) {
  if (sub.status === "cancelled") return "cancelled";
  const end = sub.periodEnd ?? sub.trialEnd;
  if (!end) return sub.status;
  const remaining = end - simulationNow(db);
  if (remaining <= 0)
    return simulationNow(db) < end + sub.graceDays * DAY
      ? "grace_period"
      : "expired";
  if (remaining <= 3 * DAY) return "expiring_soon";
  return sub.periodEnd ? "active" : "trialing";
}
export function clinicalReadOnly(db: Database, h: Hospital) {
  const sub = db.subscriptions?.[h.id];
  return !!sub && ["expired", "cancelled"].includes(subscriptionState(db, sub));
}
