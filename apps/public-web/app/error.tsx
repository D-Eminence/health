'use client'

import Link from 'next/link'
import { Logo } from '@/components/layout/Logo'

export default function Error({ retry }: { readonly retry: () => void }) {
  return <main id="main" className="flex min-h-screen flex-col items-center justify-center gap-5 bg-surface-tint px-5 text-center">
    <Logo variant="full" />
    <h1 className="font-display text-4xl text-ink">This page is unavailable</h1>
    <p className="max-w-md text-muted">We could not load this page. Please try again.</p>
    <div className="flex flex-wrap justify-center gap-3">
      <button type="button" onClick={() => retry()} className="inline-flex min-h-11 items-center rounded-(--radius-button) bg-brand px-5 font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand">Try again</button>
      <Link href="/" className="inline-flex min-h-11 items-center rounded-(--radius-button) border border-line-strong bg-surface px-5 font-semibold text-brand focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand">Go to Health ID</Link>
    </div>
  </main>
}
