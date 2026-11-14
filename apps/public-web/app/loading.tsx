import { Skeleton } from '@hid/ui'

/** Shared by the route fallback and the brief navigation loading screen. */
export default function Loading() {
  return (
    <div role="status" aria-live="polite" className="mx-auto flex min-h-[50dvh] w-full max-w-[1440px] flex-col justify-center gap-4 bg-surface px-4 sm:px-5 lg:px-6">
      <span className="sr-only">Loading Health ID</span>
      <Skeleton className="h-3 w-20" />
      <Skeleton className="h-10 w-full max-w-[30rem]" />
      <Skeleton className="h-4 w-full max-w-[42rem]" />
    </div>
  )
}
