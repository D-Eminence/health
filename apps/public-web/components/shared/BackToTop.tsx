'use client'

import { useEffect, useState } from 'react'
import { cx } from '@hid/ui'
import { HealthIcon } from './HealthIcon'

/**
 * Back to top.
 *
 * These pages are long, and the primary navigation is at the top, so a reader
 * who has reached the pricing table has a long way back. Appears once the
 * reader is roughly a screen down, matching the approved design.
 *
 * It is a real button with a label, not an unlabelled arrow, and it respects
 * a reduced-motion preference by jumping rather than animating.
 */
export function BackToTop() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const update = () => setVisible(window.scrollY > window.innerHeight * 0.9)

    update()
    // Passive: this listener never calls preventDefault, and saying so keeps
    // it off the scrolling critical path.
    window.addEventListener('scroll', update, { passive: true })
    return () => window.removeEventListener('scroll', update)
  }, [])

  const toTop = () => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' })
  }

  return (
    <button
      type="button"
      onClick={toTop}
      aria-label="Back to top"
      // Hidden from everything, not just from sight, while it is not offered.
      hidden={!visible}
      className={cx(
        'fixed right-4 bottom-4 z-40 grid h-[38px] w-[38px] place-items-center rounded-(--radius-button) border border-brand bg-brand text-white transition-colors hover:bg-brand-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand sm:right-7 sm:bottom-7',
        // Above the Support chat launcher, which shares the corner (48px tall, 16 to 20px up): on a phone it covered
        // the round launcher, and a tap on the chat icon scrolled to the top.
        '[:root:has(.hid-chat-launcher)_&]:bottom-[calc(max(20px,env(safe-area-inset-bottom))+60px)]',
      )}
    >
      <HealthIcon name="up" size={16} />
    </button>
  )
}
