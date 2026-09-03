import { getEnvironment } from '@/lib/env'

/**
 * Rendered on the server. It reads configuration, never a person's data: this
 * application has no authenticated session and no access to a clinical service.
 */
export default function HomePage() {
  const environment = getEnvironment()

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-4 px-6">
      <h1 className="text-3xl font-semibold tracking-tight">Health ID</h1>
      <p className="text-muted">
        Public web application shell. Content is out of scope for this task; the architecture is not.
      </p>
      <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
        <dt className="text-muted">Environment</dt>
        <dd>{environment.name}</dd>
        <dt className="text-muted">Gateway</dt>
        <dd className="font-mono text-xs">{environment.apiBaseUrl}</dd>
      </dl>
    </main>
  )
}
