import type { PharmacyWorkItem } from '../../../staff/api'

/**
 * The medicine's form, worked out from what the prescription says (its name, dose unit and route), so the queue can lead
 * with a picture of what to pick. Pharmacy sends no image or dosage form of its own yet (BACKEND-NEEDS.md, "Pharmacy
 * items need an optional drug image/cover URL"); until it does, a plain line drawing of the form stands in.
 */
export type DrugForm = 'tablet' | 'capsule' | 'syrup' | 'injection' | 'cream' | 'inhaler' | 'drops' | 'other'

const RULES: ReadonlyArray<readonly [DrugForm, RegExp]> = [
  ['inhaler', /\b(inhaler|inhal\w*|puffs?|nebuli[sz]\w*|mdi|rotacaps?)\b/],
  ['injection', /\b(inj\w*|ampoules?|amps?|vials?|i\.?v\.?|i\.?m\.?|s\.?c\.?|subcut\w*|intravenous|intramuscular|infusion)\b/],
  ['cream', /\b(creams?|ointments?|oint|gels?|lotions?|topical|paste|apply)\b/],
  ['drops', /\b(drops?|gtts?|eye|ear|nasal|ophthalmic|otic)\b/],
  ['syrup', /\b(syrups?|suspensions?|susp|elixirs?|solutions?|liquid|mixtures?|ml|millilit\w*|tsp|teaspoons?|sachets?)\b/],
  ['capsule', /\b(caps?|capsules?)\b/],
  ['tablet', /\b(tabs?|tablets?|caplets?|pills?|oral|po)\b/],
]

export function drugFormOf(item: Pick<PharmacyWorkItem, 'medication' | 'doseUnit' | 'routeCode'>): DrugForm {
  // The medicine's own name first ("Salbutamol 100 mcg inhaler"), then its unit and route ("2 puffs", "oral").
  for (const text of [item.medication.display, item.doseUnit ?? '', item.routeCode ?? '']) {
    const lower = text.toLowerCase()
    const hit = RULES.find(([, rule]) => rule.test(lower))
    if (hit) return hit[0]
  }
  return 'other'
}

const NUMBER = String.raw`(?:\d+(?:\.\d+)?|\.\d+)`
const UNIT = String.raw`(?:mg|mcg|µg|micrograms?|g|ml|iu|units?|%)`
/** "500 mg", "80/480 mg", "100 mcg/dose", "0.5%": the strength written in the medicine's name. */
const STRENGTH = new RegExp(String.raw`(?<![\w.])${NUMBER}(?:\s*\/\s*${NUMBER})?\s*${UNIT}(?:\s*\/\s*${NUMBER}?\s*(?:ml|g|dose|actuation|puff))?(?![\w])`, 'i')

/**
 * The medicine's name and its strength, split so the name can lead large and the strength sit with the form. Nothing
 * is changed but a missing leading zero (".5 mg" is "0.5 mg"); when no strength is written, the whole name is the name.
 */
export function nameAndStrength(display: string): { name: string; strength: string | null } {
  const match = STRENGTH.exec(display)
  if (!match) return { name: display, strength: null }
  const name = (display.slice(0, match.index) + display.slice(match.index + match[0].length)).replace(/\s{2,}/g, ' ').trim()
  const strength = match[0].trim().replace(/(^|\/\s*)\./g, '$10.')
  return name ? { name, strength } : { name: display, strength: null }
}

export const FORM_WORD: Readonly<Record<DrugForm, string>> = {
  tablet: 'Tablet', capsule: 'Capsule', syrup: 'Liquid', injection: 'Injection', cream: 'Cream', inhaler: 'Inhaler', drops: 'Drops',
  other: 'Medicine',
}
