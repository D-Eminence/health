import { Loader } from '@/components/motion/loader'

/** Shared by the route fallback and the brief navigation loading screen. */
export default function Loading() {
  return <div className="flex min-h-[70dvh] flex-col items-center justify-center gap-5 bg-white">
    <Loader variant="helix" size={48} speed={1.2} label="Loading Health ID" className="text-brand" />
    <p aria-hidden="true" className="text-sm font-medium text-muted">Loading Health ID</p>
  </div>
}
