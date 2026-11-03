import { usesNovuBackend } from '../backendContract'
import type { RecordSection } from '../api'

/**
 * The record sections each backend sends: Novu (production) serves encounters and notes, and imported history with
 * them; hid-system main serves all seven. The Records page's tabs, its opening line and Home's tiles follow this, so a
 * section comes back on every one of them once the backend sends it and this list names it.
 */
export const sectionsShown = (): RecordSection[] => usesNovuBackend() ? ['encounters', 'notes']
  : ['encounters', 'notes', 'vitals', 'diagnoses', 'prescriptions', 'labRequests', 'documents']
