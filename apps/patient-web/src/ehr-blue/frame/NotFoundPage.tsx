import { Compass } from 'lucide-react'
import { Button, EmptyState } from '../../kasuwa/ui'

/**
 * An address no blue page takes, inside the frame: classic's catch-all route's words (staff/App.tsx: "Page not found",
 * "This provider page is unavailable.", "Go to provider overview →") and its one way back, to the Overview, which is
 * Home here and is listed on every site (parity report 21). Sent Home without a word, staff could not tell a mistyped
 * or out-of-date link from a page they lost. The address itself is never shown: it may hold a record's reference.
 */
export function NotFoundPage() {
  return <EmptyState titleAs="h1" icon={Compass} title="Page not found" description="This provider page is unavailable."
    action={<Button to="/provider">Go to provider overview</Button>} />
}
