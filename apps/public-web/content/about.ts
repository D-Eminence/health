import { findProduct } from './products'
import { HEALTH_ID_MODULES, type HealthIDModule } from './module-showcase'
import { ROUTES } from './site'

export const ABOUT_PRODUCTS = [
  { slug: 'identity', name: 'Health Identity', summary: 'A persistent digital identity that connects a patient to their healthcare journey.' },
  { slug: 'ehr', name: 'Health ID EHR', summary: 'Encounter-based clinical records, notes, vitals, diagnoses and documents.' },
  { slug: 'laboratory', name: 'Health ID Laboratory', summary: 'Laboratory workflow management from test request to verified result.' },
  { slug: 'pharmacy', name: 'Health ID Pharmacy', summary: 'Prescription work items, dispensing records and reversals.' },
  { slug: 'migrate', name: 'Health ID Migrate', summary: 'Document-level OCR extraction, validation and controlled publication.' },
  { slug: 'outreach', name: 'Health ID Outreach', summary: 'Campaign members and field registration cases linked to existing identities.' },
  { slug: 'api', name: 'Health ID API', summary: 'Infrastructure for connecting existing healthcare systems to the Health ID ecosystem.' },
].map(product => ({ ...product, mark: findProduct(product.slug)?.mark ?? 'ID' }))

export const ABOUT_MODULES: readonly HealthIDModule[] = ABOUT_PRODUCTS.flatMap(product => {
  const module = HEALTH_ID_MODULES.find(item => item.slug === product.slug)
  return module ? [{ ...module, name: product.name, shortName: product.slug === 'ehr' ? 'EMR' : module.shortName, statement: product.name, description: product.summary, href: ROUTES.product(product.slug), cta: `Explore ${product.name}` }] : []
})

export const FRAGMENTATION = ['Patients repeat the same information.', 'Records are difficult to retrieve.', 'Healthcare teams work with incomplete context.', 'Paper archives become harder to manage.', 'Hospitals struggle to digitize without abandoning years of existing records.', 'Different healthcare systems cannot easily work together.']
export const APPROACH = [
  { title: 'Use Health ID as your clinical system.', label: 'Use Health ID', body: 'Facilities can use Health ID EHR and add supported laboratory, pharmacy and document workflows.' },
  { title: 'Use a product independently.', label: 'Add Health ID modules', body: 'Laboratories, pharmacies, outreach teams, and migration projects can use selected Health ID products without adopting the full EMR.' },
  { title: 'Connect an existing system.', label: 'Connect your existing system', body: 'Organizations that already have healthcare software can connect through Health ID APIs and integrations.' },
]
export const FOLDER_SECTIONS = ['Encounters', 'Clinical notes', 'Vitals', 'Diagnoses', 'Prescriptions', 'Lab requests', 'Documents']
export const MIGRATION_STEPS = ['Source Document', 'OCR Job', 'Extraction', 'Human Validation', 'Patient Confirmation', 'Publication', 'Clinical Record']
export const CARE_STEPS = ['Patient lookup', 'Access check', 'Encounter', 'Clinical note', 'Lab request', 'Result review', 'Prescription', 'Dispensing']
export const WORKFLOW_CONTEXT = ['What needs their attention', 'What they need to do next', 'What information came from the previous stage', 'What information they need to pass forward']
export const DEPARTMENTS = ['Patient identity', 'Outpatient encounters', 'Clinical notes', 'Vitals', 'Laboratory', 'Pharmacy', 'Emergency record', 'OCR migration', 'Outreach']
export const CONNECTED_SYSTEMS = ['Existing EHR', 'Laboratory System', 'Pharmacy System', 'Outreach Tool', 'Care App']
export const TRUST_PRINCIPLES = ['Role-based access', 'Patient access controls where applicable', 'Audit trails', 'Emergency access logging', 'Organization and facility isolation', 'Secure record sharing', 'Original-record traceability for migrated data', 'Controlled staff permissions']
export const AUDIENCES = [
  { title: 'Hospitals', body: 'Identity, EHR, laboratory, pharmacy and document workflows.' },
  { title: 'Clinics', body: 'Patient identity, registration, consultation, and modular operations.' },
  { title: 'Laboratories', body: 'Standalone or connected laboratory workflows.' },
  { title: 'Pharmacies', body: 'Prescription work items and documented dispensing.' },
  { title: 'Outreach Organizations', body: 'Healthcare programs beyond facility walls.' },
  { title: 'Care networks', body: 'Supported identity lookup and access checks across authorised facilities.' },
  { title: 'Health-Tech Companies', body: 'API access and integration into the wider ecosystem.' },
]
export const TEAM: readonly { name: string; role: string; bio?: string; linkedin?: string; photo?: string }[] = [
  { name: 'Ibrahim Umar', role: 'Lead Software Developer', bio: 'Leads software development for the Health ID platform.', linkedin: 'https://www.linkedin.com/in/ibrahim-umar-eminence', photo: '/brand/team-ibrahim.jpeg' },
  { name: 'Akorede Ibrahim', role: 'Product Engineer', bio: 'Turns product ideas into practical experiences for healthcare teams.', linkedin: 'https://www.linkedin.com/in/ibrahim-akorede-30912b356/', photo: '/brand/team-akorede.jpg' },
  { name: 'Abeki Faridat', role: 'Product Manager', bio: 'Guides product planning and development around healthcare needs.', linkedin: 'https://www.linkedin.com/in/fareedah-akindele', photo: '/brand/team-abeki.jpeg' },
  { name: 'Hikmah Owoade', role: 'Marketing and Growth Strategist', linkedin: 'https://www.linkedin.com/in/hikmah-abdulhakeem-5121471b8', photo: '/brand/team-hikmah.jpeg' },
  { name: 'Abdulrahman Umar', role: 'Full stack Developer', linkedin: 'https://www.linkedin.com/in/abdulrahman-umar-5b081521b', photo: '/brand/team-abdulrahman.png' },
  { name: 'Rukayat Ololade Abdulsalam', role: 'Health Systems Coordinator', bio: 'Health Economics and Health Systems Management with a focus on digital health and health systems improvement.', linkedin: 'https://www.linkedin.com/in/rukayat-abdulsalam-', photo: '/brand/team-rukayat.png' },
  { name: 'Owolabi Olayinka', role: 'DevOps Engineer', bio: 'DevOps engineer with hands-on experience in AWS, Terraform, Docker, Kubernetes, and CI/CD through personal projects.', linkedin: 'https://www.linkedin.com/in/olayinka-owolabi-9169a4220', photo: '/brand/team-olayinka.png' },
  { name: 'Naomi Dem', role: 'SDR/BDR', bio: 'Sales development experience across client acquisition, lead generation, pipeline management, and CRM building.', linkedin: 'https://www.linkedin.com/in/naomi-dem-374808270/', photo: '/brand/team-naomi.jpeg' },
]
