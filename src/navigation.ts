import { Database } from "./model";
import { allModules } from "./catalog";
import { can } from "./service";

export type NavigationItem = {
  id: string;
  title: string;
  group: string;
  icon: string;
  children?: { id: string; title: string }[];
};
const labels: Record<string, string> = {
  journey: "Patient visits",
  nursing: "Nursing observations",
  "nursing-tasks": "Nursing tasks",
  surgery: "Theatre & Procedures",
  ambulance: "Dispatch",
  billing: "Patient billing",
  consent: "External record access",
  inventory: "Stock",
  procurement: "Procurement",
  policies: "Policies",
};
export const moduleTitle = (id: string) =>
  labels[id] || allModules.find((m) => m.id === id)?.title || id;
const icons: Record<string, string> = {
  patients: "user",
  appointments: "calendar",
  journey: "route",
  triage: "activity",
  consult: "stethoscope",
  lab: "flask",
  pharmacy: "pill",
  radiology: "scan",
  inpatient: "bed",
  wards: "ward",
  nursing: "notes",
  "nursing-tasks": "check",
  emergency: "alert",
  maternity: "heart",
  surgery: "scissors",
  icu: "monitor",
  dental: "tooth",
  billing: "receipt",
  insurance: "shield",
  supply: "box",
  referrals: "share",
  ambulance: "truck",
  bloodbank: "droplet",
  telemedicine: "video",
  shifts: "clock",
  hr: "badge",
  quality: "flag",
  consent: "lock",
  services: "tag",
  "ward-config": "wardSettings",
  vehicles: "vehicleSettings",
};
const settings = ["services", "ward-config", "vehicles"];
export const navigationRegistry: NavigationItem[] = [
  { id: "dashboard", title: "Home", group: "Home", icon: "home" },
  ...allModules
    .filter((m) => !["inventory", "procurement", "policies"].includes(m.id))
    .map((m) => ({
      id: m.id,
      title: moduleTitle(m.id),
      group: settings.includes(m.id)
        ? "Settings"
        : ["shifts", "hr"].includes(m.id)
          ? "People"
          : ["billing", "insurance"].includes(m.id)
            ? "Finance"
            : m.group,
      icon: icons[m.id] || "file",
      ...(m.id === "insurance"
        ? {
            children: [
              { id: "insurance", title: "Claims" },
              { id: "policies", title: "Policies" },
            ],
          }
        : {}),
    })),
  {
    id: "supply",
    title: "Supply",
    group: "Supply",
    icon: "box",
    children: [
      { id: "inventory", title: "Stock" },
      { id: "procurement", title: "Procurement" },
    ],
  },
  {
    id: "platform",
    title: "Facility review",
    group: "Administration",
    icon: "review",
  },
  { id: "staff", title: "Staff & access", group: "People", icon: "users" },
  {
    id: "reports",
    title: "Reports & Analytics",
    group: "Insight",
    icon: "chart",
  },
  {
    id: "audit",
    title: "Audit & Compliance",
    group: "Insight",
    icon: "history",
  },
  {
    id: "facility",
    title: "Facility profile",
    group: "Settings",
    icon: "building",
  },
  { id: "setup", title: "Facility settings", group: "Settings", icon: "edit" },
  {
    id: "subscription",
    title: "Facility subscription",
    group: "Settings",
    icon: "subscription",
  },
];
export function navigation(db: Database): NavigationItem[] {
  return navigationRegistry.flatMap((item) => {
    if (item.children) {
      const children = item.children.filter((c) => can(db, c.id));
      return children.length ? [{ ...item, children }] : [];
    }
    return can(db, item.id) ? [item] : [];
  });
}
export function destination(item: NavigationItem) {
  return "/" + (item.children?.[0]?.id || item.id);
}
export function activeItem(item: NavigationItem, current: string) {
  return item.id === current || !!item.children?.some((c) => c.id === current);
}
