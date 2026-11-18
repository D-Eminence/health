/**
 * Suggestions as a clinician types (owner, 18 Nov 2026: typing "mal" should offer Malaria, so nothing common is typed
 * out in full). Each list is offered by the field's own browser suggestions (a datalist): free text is always allowed,
 * and nothing is sent unless the clinician saves it.
 *
 * Codes are given only where they are certain: diagnoses carry their WHO ICD-10 code, and the commonest lab tests their
 * LOINC code. Picking one of those names fills its code and code system; anything else leaves the code to the clinician.
 */

export interface CodedTerm {
  readonly name: string
  readonly code?: string
}

/** Common diagnoses at a Nigerian outpatient clinic, with their WHO ICD-10 codes. */
export const DIAGNOSES: readonly CodedTerm[] = [
  { name: 'Malaria, unspecified', code: 'B54' },
  { name: 'Plasmodium falciparum malaria, unspecified', code: 'B50.9' },
  { name: 'Plasmodium falciparum malaria with cerebral complications', code: 'B50.0' },
  { name: 'Typhoid fever', code: 'A01.0' },
  { name: 'Acute upper respiratory infection, unspecified', code: 'J06.9' },
  { name: 'Acute pharyngitis, unspecified', code: 'J02.9' },
  { name: 'Acute tonsillitis, unspecified', code: 'J03.9' },
  { name: 'Acute bronchitis, unspecified', code: 'J20.9' },
  { name: 'Pneumonia, unspecified', code: 'J18.9' },
  { name: 'Asthma, unspecified', code: 'J45.9' },
  { name: 'Otitis media, unspecified', code: 'H66.9' },
  { name: 'Conjunctivitis, unspecified', code: 'H10.9' },
  { name: 'Essential (primary) hypertension', code: 'I10' },
  { name: 'Hypertensive heart disease without (congestive) heart failure', code: 'I11.9' },
  { name: 'Heart failure, unspecified', code: 'I50.9' },
  { name: 'Stroke, not specified as haemorrhage or infarction', code: 'I64' },
  { name: 'Type 2 diabetes mellitus without complications', code: 'E11.9' },
  { name: 'Type 1 diabetes mellitus without complications', code: 'E10.9' },
  { name: 'Urinary tract infection, site not specified', code: 'N39.0' },
  { name: 'Gastroenteritis and colitis of unspecified origin', code: 'A09.9' },
  { name: 'Cholera, unspecified', code: 'A00.9' },
  { name: 'Gastritis, unspecified', code: 'K29.7' },
  { name: 'Functional dyspepsia', code: 'K30' },
  { name: 'Peptic ulcer, unspecified as acute or chronic, without haemorrhage or perforation', code: 'K27.9' },
  { name: 'Acute appendicitis, other and unspecified', code: 'K35.8' },
  { name: 'Unilateral or unspecified inguinal hernia, without obstruction or gangrene', code: 'K40.9' },
  { name: 'Anaemia, unspecified', code: 'D64.9' },
  { name: 'Iron deficiency anaemia, unspecified', code: 'D50.9' },
  { name: 'Sickle-cell anaemia with crisis', code: 'D57.0' },
  { name: 'Sickle-cell anaemia without crisis', code: 'D57.1' },
  { name: 'Unspecified human immunodeficiency virus [HIV] disease', code: 'B24' },
  { name: 'Respiratory tuberculosis unspecified, without mention of bacteriological or histological confirmation', code: 'A16.9' },
  { name: 'Sepsis, unspecified', code: 'A41.9' },
  { name: 'Lassa fever', code: 'A96.2' },
  { name: 'Measles without complication', code: 'B05.9' },
  { name: 'Varicella without complication', code: 'B01.9' },
  { name: 'Helminthiasis, unspecified', code: 'B83.9' },
  { name: 'Schistosomiasis, unspecified', code: 'B65.9' },
  { name: 'Candidiasis of vulva and vagina', code: 'B37.3' },
  { name: 'Acute vaginitis', code: 'N76.0' },
  { name: 'Hyperplasia of prostate', code: 'N40' },
  { name: 'Chronic kidney disease, unspecified', code: 'N18.9' },
  { name: 'Cellulitis, unspecified', code: 'L03.9' },
  { name: 'Dermatitis, unspecified', code: 'L30.9' },
  { name: 'Allergy, unspecified', code: 'T78.4' },
  { name: 'Volume depletion', code: 'E86' },
  { name: 'Unspecified protein-energy malnutrition', code: 'E46' },
  { name: 'Low back pain', code: 'M54.5' },
  { name: 'Arthrosis, unspecified', code: 'M19.9' },
  { name: 'Epilepsy, unspecified', code: 'G40.9' },
  { name: 'Depressive episode, unspecified', code: 'F32.9' },
  { name: 'Anxiety disorder, unspecified', code: 'F41.9' },
  { name: 'Fever, unspecified', code: 'R50.9' },
  { name: 'Headache', code: 'R51' },
  { name: 'Gestational [pregnancy-induced] hypertension without significant proteinuria', code: 'O13' },
  { name: 'Pre-eclampsia, unspecified', code: 'O14.9' },
  { name: 'Neonatal jaundice, unspecified', code: 'P59.9' },
]

/** Common lab tests; the LOINC code only where it is certain. */
export const LAB_TESTS: readonly CodedTerm[] = [
  { name: 'Full blood count (CBC panel)', code: '58410-2' },
  { name: 'Haemoglobin', code: '718-7' },
  { name: 'Packed cell volume (haematocrit)', code: '4544-3' },
  { name: 'Random blood glucose', code: '2345-7' },
  { name: 'Fasting blood glucose', code: '1558-6' },
  { name: 'HbA1c', code: '4548-4' },
  { name: 'Erythrocyte sedimentation rate (Westergren)', code: '4537-7' },
  { name: 'Pregnancy test (urine hCG)', code: '2106-3' },
  { name: 'TSH', code: '3016-3' },
  { name: 'PSA', code: '2857-1' },
  { name: 'Blood culture', code: '600-7' },
  { name: 'Urine culture', code: '630-4' },
  { name: 'Blood group (ABO)', code: '883-9' },
  { name: 'Malaria parasite (blood film)' },
  { name: 'Malaria rapid diagnostic test' },
  { name: 'Widal test' },
  { name: 'Urinalysis' },
  { name: 'Haemoglobin genotype' },
  { name: 'HIV screening' },
  { name: 'Hepatitis B surface antigen' },
  { name: 'Hepatitis C antibody' },
  { name: 'Electrolytes, urea and creatinine' },
  { name: 'Liver function test' },
  { name: 'Lipid profile' },
  { name: 'Stool microscopy' },
  { name: 'Sputum for AFB' },
]

/** Common medicines by generic name. */
export const MEDICINES: readonly string[] = [
  'Paracetamol', 'Ibuprofen', 'Diclofenac', 'Tramadol',
  'Artemether-lumefantrine', 'Artesunate', 'Dihydroartemisinin-piperaquine', 'Sulfadoxine-pyrimethamine',
  'Amoxicillin', 'Amoxicillin-clavulanic acid', 'Ampicillin-cloxacillin', 'Cloxacillin', 'Azithromycin', 'Erythromycin',
  'Ciprofloxacin', 'Levofloxacin', 'Doxycycline', 'Ceftriaxone', 'Cefuroxime', 'Gentamicin', 'Metronidazole',
  'Co-trimoxazole', 'Nitrofurantoin', 'Fluconazole', 'Clotrimazole', 'Nystatin', 'Albendazole', 'Mebendazole', 'Praziquantel',
  'Omeprazole', 'Esomeprazole', 'Magnesium trisilicate', 'Hyoscine butylbromide', 'Metoclopramide', 'Loperamide',
  'Oral rehydration salts', 'Zinc sulfate', 'Ferrous sulfate', 'Folic acid', 'Vitamin B complex', 'Vitamin C',
  'Amlodipine', 'Nifedipine', 'Lisinopril', 'Losartan', 'Hydrochlorothiazide', 'Methyldopa', 'Atenolol', 'Furosemide',
  'Metformin', 'Glibenclamide', 'Gliclazide', 'Insulin (soluble)',
  'Salbutamol', 'Prednisolone', 'Hydrocortisone', 'Loratadine', 'Cetirizine', 'Chlorphenamine', 'Promethazine',
  'Carbamazepine', 'Phenobarbital', 'Diazepam', 'Amitriptyline',
  'Tenofovir/lamivudine/dolutegravir', 'Oxytocin', 'Misoprostol', 'Magnesium sulfate',
]

/** How often, in the words a prescription uses. */
export const FREQUENCIES: readonly string[] = [
  'Once daily', 'Twice daily', 'Three times daily', 'Four times daily', 'Every 6 hours', 'Every 8 hours', 'Every 12 hours',
  'At night', 'In the morning', 'When needed', 'Immediately, once', 'Once a week',
]

/** Routes, as the field's own placeholder writes them. */
export const ROUTES: readonly string[] = ['oral', 'intravenous', 'intramuscular', 'subcutaneous', 'topical', 'rectal', 'vaginal', 'inhaled', 'sublingual', 'eye', 'ear', 'nasal']

/** The commonest presenting complaints, offered one tap each under the complaint box. */
export const COMPLAINTS: readonly string[] = [
  'Fever', 'Headache', 'Cough', 'Catarrh', 'Sore throat', 'Body weakness',
  'Abdominal pain', 'Diarrhoea', 'Vomiting', 'Painful urination', 'Chest pain', 'Rash',
]

/** The names of a coded list, for a field's suggestions. */
export const namesOf = (terms: readonly CodedTerm[]): readonly string[] => terms.map(term => term.name)

/** The code of the term named exactly `name` (any case), when it has one. */
export function codeOf(terms: readonly CodedTerm[], name: string): string | null {
  const wanted = name.trim().toLowerCase()
  return terms.find(term => term.name.toLowerCase() === wanted)?.code ?? null
}
