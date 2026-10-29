import { Field } from "./catalog";
import { Fields, departments, str } from "./model";
import { nigeria } from "./nigeria";
const f = (
  key: string,
  label: string,
  type: Field["type"] = "text",
  required = true,
): Field => ({ key, label, type, required });
const choices = (
  key: string,
  label: string,
  options: string[],
  multiple = false,
): Field => ({ key, label, options, multiple, required: true });
export const registrationSteps = [
  "Your account",
  "Facility details",
  "Regulatory identity",
  "Platform setup",
  "Agreements",
];
export const productChoices = [
  "Identity",
  "EHR",
  "Migrate",
  "Pharmacy",
  "Lab",
  "Medical Outreach",
  "API/Connect",
];
export function facilityFields(
  step: number,
  data: Fields,
  profile = false,
): Field[] {
  if (step === 0)
    return [
      f("name", "Full name"),
      f("phone", "Phone", "tel"),
      f("email", "Email", "email"),
      ...(!profile
        ? [
            f("password", "Password", "password"),
            f("confirm", "Confirm password", "password"),
          ]
        : []),
      choices("facilityRole", "Role at the facility", [
        "Owner",
        "Medical Director",
        "Administrator",
        "Other authorised representative",
      ]),
    ];
  if (step === 1)
    return [
      f("facilityName", "Facility name"),
      choices("facilityType", "Facility type", [
        "Hospital",
        "Clinic",
        "Maternity home",
        "Diagnostic lab",
        "Pharmacy",
        "Specialist centre",
      ]),
      choices("ownership", "Ownership", [
        "Public",
        "Private",
        "Faith-based",
        "NGO",
      ]),
      choices("careLevel", "Level of care", [
        "Primary",
        "Secondary",
        "Tertiary",
      ]),
      f("address", "Address"),
      choices("state", "State", Object.keys(nigeria)),
      choices("lga", "Local government area", nigeria[str(data.state)] || []),
      f("gps", "GPS pin (latitude, longitude)", "text", false),
      f("facilityPhone", "Facility phone", "tel"),
      f("facilityEmail", "Facility email", "email"),
      f("beds", "Bed count", "number"),
      f("hours", "Operating hours"),
      choices("emergency24", "24-hour emergency", ["Yes", "No"]),
      choices("departments", "Departments", departments, true),
      f("services", "Services offered", "textarea"),
    ];
  if (step === 2)
    return [
      f("licence", "State Ministry of Health licence number"),
      f(
        "registryId",
        "National facility registry ID (optional)",
        "text",
        false,
      ),
      f("cac", "CAC registration number"),
      f("directorName", "Medical Director's full name"),
      f("mdcn", "MDCN number"),
      f("nhia", "NHIA accreditation (optional)", "text", false),
      f("operatingLicence", "Operating licence (image/PDF, max 2 MB)", "file"),
      f("cacCertificate", "CAC certificate (image/PDF, max 2 MB)", "file"),
      f("proofAddress", "Proof of address (image/PDF, max 2 MB)", "file"),
    ];
  if (step === 3)
    return [
      f("staffCount", "Expected number of staff", "number"),
      choices("products", "Products to start with", productChoices, true),
      choices("migrating", "Migrating existing records?", ["Yes", "No"]),
      ...(data.migrating === "Yes"
        ? [f("migrationSource", "Existing records source")]
        : []),
      choices(
        "interoperability",
        "Need interoperability with other facilities?",
        ["Yes", "No"],
      ),
      ...(data.interoperability === "Yes"
        ? [
            f(
              "connections",
              "External labs, pharmacies or facilities",
              "textarea",
            ),
          ]
        : []),
    ];
  return [
    f("terms", "I accept the demonstration Terms of Service", "checkbox"),
    f(
      "dpa",
      "I accept the demonstration Data Processing Agreement",
      "checkbox",
    ),
    f(
      "ndpa",
      "I acknowledge data protection and patient consent responsibilities",
      "checkbox",
    ),
    f("authorised", "I am authorised to register this facility", "checkbox"),
  ];
}
export function facilityErrors(step: number, data: Fields, profile = false) {
  const errors: Record<string, string> = {};
  for (const f of facilityFields(step, data, profile)) {
    const value = data[f.key];
    if (
      f.required &&
      (value === undefined ||
        value === "" ||
        (f.type === "checkbox" && !value) ||
        (Array.isArray(value) && !value.filter(Boolean).length))
    )
      errors[f.key] = "This field is required.";
    if (f.type === "email" && value && !/^\S+@\S+\.\S+$/.test(str(value)))
      errors[f.key] = "Enter a valid email address.";
    if (
      f.options &&
      value &&
      (Array.isArray(value)
        ? value.some((v) => !f.options!.includes(v))
        : !f.options.includes(str(value)))
    )
      errors[f.key] = "Choose a listed option.";
    if (
      f.type === "file" &&
      value &&
      (!/^data:(image\/(png|jpeg|webp|gif)|application\/pdf);base64,/.test(
        str(value),
      ) ||
        str(value).length > 2800000)
    )
      errors[f.key] = "Use an image or PDF no larger than 2 MB.";
  }
  for (const key of step === 0
    ? ["phone"]
    : step === 1
      ? ["facilityPhone"]
      : [])
    if (
      data[key] &&
      !/^(?:\+234|234|0)[789]\d{9}$/.test(
        str(data[key]).replace(/[\s()-]/g, ""),
      )
    )
      errors[key] =
        "Use a Nigerian number, e.g. 08012345678 or +2348012345678.";
  if (step === 0 && !profile) {
    if (str(data.password).length < 8)
      errors.password = "Use at least eight characters.";
    if (data.password !== data.confirm)
      errors.confirm = "Passwords do not match.";
  }
  if (
    step === 1 &&
    (!Number.isInteger(Number(data.beds)) || Number(data.beds) < 0)
  )
    errors.beds = "Enter a whole number of zero or more.";
  if (step === 1 && data.gps) {
    const coords = str(data.gps).split(",").map(Number);
    if (
      coords.length !== 2 ||
      !coords.every(Number.isFinite) ||
      Math.abs(coords[0]) > 90 ||
      Math.abs(coords[1]) > 180
    )
      errors.gps = "Enter latitude, longitude.";
  }
  if (
    step === 3 &&
    (!Number.isInteger(Number(data.staffCount)) || Number(data.staffCount) < 1)
  )
    errors.staffCount = "Enter at least one staff member.";
  return errors;
}
export function safeProfile(data: Fields) {
  const { password, confirm, ...safe } = data;
  return safe;
}
