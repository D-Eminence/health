import type { ReactNode } from 'react'

/**
 * The sidebar's decorative icons for these pages, drawn inline in the target's
 * stroke style (the target's icon names in brackets). Each is hidden from assistive
 * technology: the page's label names it.
 */
function Icon({ children }: { readonly children: ReactNode }) {
  return (
    <svg className="hid-ehr-dept-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {children}
    </svg>
  )
}

/** Laboratory (flask). */
export const FlaskIcon = () => <Icon><path d="M9 3h6M10 3v6L4.5 18.5A1.7 1.7 0 0 0 6 21h12a1.7 1.7 0 0 0 1.5-2.5L14 9V3" /><path d="M7.5 15h9" /></Icon>
/** Pharmacy (pill). */
export const PillIcon = () => <Icon><rect x="3" y="8.5" width="18" height="7" rx="3.5" transform="rotate(-45 12 12)" /><path d="m8.5 8.5 7 7" /></Icon>
/** Migrate (document upload). */
export const UploadIcon = () => <Icon><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M12 17v-6M9.5 13.5 12 11l2.5 2.5" /></Icon>
/** Outreach (megaphone). */
export const OutreachIcon = () => <Icon><path d="M3 11v2a1 1 0 0 0 1 1h3l6 4V6L7 10H4a1 1 0 0 0-1 1z" /><path d="M17 9a4 4 0 0 1 0 6M7 14l1 5h2.5" /></Icon>
/** Staff & access (users). */
export const UsersIcon = () => <Icon><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.2A6.5 6.5 0 0 1 21.5 20" /></Icon>
/** Audit & Compliance (history). */
export const HistoryIcon = () => <Icon><path d="M3 12a9 9 0 1 0 2.6-6.4L3 8" /><path d="M3 3v5h5M12 7v5l3 2" /></Icon>
/** Facility profile (building). */
export const BuildingIcon = () => <Icon><rect x="4" y="3" width="16" height="18" rx="1.5" /><path d="M9 7h1M14 7h1M9 11h1M14 11h1M9 15h1M14 15h1M10 21v-3h4v3" /></Icon>
/** HR & Credentials (badge). */
export const BadgeIcon = () => <Icon><path d="M12 3 4 6v6c0 4.5 3.4 8.2 8 9 4.6-.8 8-4.5 8-9V6z" /><path d="m9 12 2 2 4-4" /></Icon>
/** Patient billing (receipt). */
export const ReceiptIcon = () => <Icon><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" /><path d="M9 8h6M9 12h6M9 16h3" /></Icon>
/** Insurance & Claims, Policies (shield). */
export const ShieldIcon = () => <Icon><path d="M12 3 4 6v6c0 4.5 3.4 8.2 8 9 4.6-.8 8-4.5 8-9V6z" /></Icon>
/** Service catalogue (tag). */
export const TagIcon = () => <Icon><path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z" /><circle cx="7.5" cy="7.5" r="1.5" /></Icon>
/** Stock, Procurement (box). */
export const BoxIcon = () => <Icon><path d="m3 7.5 9-4.5 9 4.5v9L12 21l-9-4.5z" /><path d="m3 7.5 9 4.5 9-4.5M12 12v9" /></Icon>
/** Quality & Safety (flag). */
export const FlagIcon = () => <Icon><path d="M5 21V4M5 4h11l-2 4 2 4H5" /></Icon>
/** Shifts & Roster (clock). */
export const ClockIcon = () => <Icon><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></Icon>
/** Dispatch (truck). */
export const TruckIcon = () => <Icon><path d="M2 6h11v10H2zM13 9h4l4 4v3h-8" /><circle cx="6.5" cy="17.5" r="1.8" /><circle cx="17" cy="17.5" r="1.8" /></Icon>
/** Vehicle configuration (vehicle with settings). */
export const VehicleIcon = () => <Icon><path d="M3 15V9l2-4h10l2 4v6z" /><circle cx="7" cy="16.5" r="1.6" /><circle cx="13" cy="16.5" r="1.6" /><circle cx="19" cy="18" r="2" /><path d="M19 14.5v1.5M19 20v1.5M15.5 18H17M21 18h1.5" /></Icon>
