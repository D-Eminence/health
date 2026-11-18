import { BookOpen, MessageCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { EhrButton } from '@hid/ui/ehr'
import { Drawer } from '../../kasuwa/interactive'
import { Button } from '../../kasuwa/ui'
import type { PageGuide } from './pageGuides'

/**
 * The Guide (owner, 18 Nov 2026): in the top bar on every page, it opens beside the page with what this page is for
 * and how to use it, so nobody has to look for help. "?" opens it from the keyboard too. All guides (the Help page)
 * and the support chat are one step from it.
 */
export function PageGuideButton({ guide, label, onAllGuides, onSupport, look = 'ehr' }: {
  /** The open page's guide (pageGuides.ts guideFor), or null where none is written. */
  readonly guide: PageGuide | null
  /** The page's own name, as the menu says it. */
  readonly label: string
  /** All guides, where the app has a page of them. */
  readonly onAllGuides?: () => void
  /** The EHR's top-bar button, or the patient portal's. */
  readonly look?: 'ehr' | 'portal'
  /** The support chat, where this build offers it. */
  readonly onSupport?: () => void
}) {
  const [open, setOpen] = useState(false)
  // "?" anywhere but in a field opens the guide.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== '?' || event.ctrlKey || event.metaKey || event.altKey) return
      const target = event.target as HTMLElement | null
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return
      event.preventDefault()
      setOpen(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return (
    <>
      {look === 'ehr' ? <EhrButton variant="secondary" icon={<BookOpen size={18} strokeWidth={1.65} />} aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <span className="hid-ehr-blue-label">Guide</span>
      </EhrButton> : <Button variant="ghost" icon={BookOpen} aria-haspopup="dialog" onClick={() => setOpen(true)}>Guide</Button>}
      <Drawer open={open} onClose={() => setOpen(false)} title={`Guide: ${label}`}
        footer={onAllGuides || onSupport ? <div className="flex flex-wrap gap-2">
          {onAllGuides ? <Button onClick={() => { setOpen(false); onAllGuides() }}>All guides</Button> : null}
          {onSupport ? <Button icon={MessageCircle} onClick={() => { setOpen(false); onSupport() }}>Chat with support</Button> : null}
        </div> : undefined}>
        {guide ? <div className="flex flex-col gap-5">
          <p className="m-0 text-sm text-ink">{guide.purpose}</p>
          <section aria-labelledby="page-guide-steps">
            <h3 id="page-guide-steps" className="m-0 mb-2 text-sm font-semibold text-ink">How to use it</h3>
            <ol className="m-0 list-decimal space-y-2 pl-5 text-sm text-ink-2 marker:font-semibold marker:text-ink">
              {guide.steps.map(step => <li key={step}>{step}</li>)}
            </ol>
          </section>
          {guide.tips?.length ? <section aria-labelledby="page-guide-tips">
            <h3 id="page-guide-tips" className="m-0 mb-2 text-sm font-semibold text-ink">Good to know</h3>
            <ul className="m-0 list-disc space-y-2 pl-5 text-sm text-ink-2">
              {guide.tips.map(tip => <li key={tip}>{tip}</li>)}
            </ul>
          </section> : null}
          <p className="m-0 text-[12px] text-ink-3">Press ? on any page to open its guide.</p>
        </div>
        : <p className="m-0 text-sm text-ink-2">This page has no guide yet.{onAllGuides ? ' All guides lists the steps for the work your role does.' : ''}</p>}
      </Drawer>
    </>
  )
}
