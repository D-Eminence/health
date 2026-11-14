'use client'

import type { ReactNode } from 'react'
import { ToastProvider } from '@hid/ui'

/** Client boundary for the application-wide, reusable Waya feedback queue. */
export function FeedbackProvider({ children }: { readonly children: ReactNode }) {
  // Public pages expose a fixed Back-to-top control in the lower-right corner.
  // Reserving its vertical footprint preserves the standard toast anchor
  // without making either target obscure the other.
  return <ToastProvider bottomOffset={56}>{children}</ToastProvider>
}
