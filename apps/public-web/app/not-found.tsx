import Link from 'next/link'
import { Logo } from '@/components/layout/Logo'

export default function NotFound() {
  return <main id="main" className="flex min-h-screen flex-col items-center justify-center gap-5 bg-surface-tint px-5 text-center">
    <Logo variant="full" />
    <h1 className="font-display text-4xl text-ink">Page not found</h1>
    <p className="max-w-md text-muted">The Health ID page you requested is unavailable.</p>
    <Link href="/" className="inline-flex min-h-11 items-center rounded-(--radius-button) bg-brand px-5 font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand">Go to Health ID</Link>
  </main>
}
