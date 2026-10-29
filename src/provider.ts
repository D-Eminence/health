import { Hospital, str } from "./model";

export const providerTypes = [
  "Hospital",
  "Clinic",
  "Maternity home",
  "Diagnostic lab",
  "Pharmacy",
  "Specialist centre",
] as const;
export type ProviderType = (typeof providerTypes)[number];
export function providerType(h: Hospital): ProviderType | undefined {
  const registered = str(h.registrationProfile?.facilityType);
  if (providerTypes.includes(registered as ProviderType))
    return registered as ProviderType;
  const legacy: Record<string, ProviderType> = {
    "Community Hospital": "Hospital",
    "Specialist Hospital": "Hospital",
    "Multi-Branch Hospital": "Hospital",
    "Teaching Hospital": "Hospital",
    Clinic: "Clinic",
    "Maternity Centre": "Maternity home",
    "Diagnostic Centre": "Diagnostic lab",
    "Specialist Clinic": "Specialist centre",
  };
  return legacy[h.type];
}
const shared = [
  "billing",
  "insurance",
  "policies",
  "inventory",
  "procurement",
  "shifts",
  "hr",
  "quality",
  "services",
];
const outpatient = [
  "patients",
  "appointments",
  "journey",
  "triage",
  "consult",
  "nursing",
  "nursing-tasks",
  "maternity",
  "pharmacy",
  "lab",
  "referrals",
  "consent",
  "telemedicine",
];
export function providerAllows(h: Hospital, module: string) {
  const type = providerType(h);
  if (type === "Hospital") return true;
  if (type === "Clinic")
    return ![
      "inpatient",
      "wards",
      "ward-config",
      "icu",
      "bloodbank",
      "surgery",
      "ambulance",
      "vehicles",
    ].includes(module);
  if (type === "Maternity home")
    return [...shared, ...outpatient].includes(module);
  if (type === "Diagnostic lab")
    return [
      ...shared,
      "patients",
      "lab",
      "radiology",
      "referrals",
      "consent",
    ].includes(module);
  if (type === "Pharmacy")
    return [...shared, "patients", "pharmacy", "consent"].includes(module);
  if (type === "Specialist centre")
    return [
      ...shared,
      ...outpatient,
      "radiology",
      "emergency",
      "surgery",
      "dental",
    ].includes(module);
  return false;
}
