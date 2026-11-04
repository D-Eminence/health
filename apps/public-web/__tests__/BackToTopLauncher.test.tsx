import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { BackToTop } from '@/components/shared/BackToTop'

/**
 * Back to top and the Support chat launcher share the bottom-right corner. On a phone the launcher is a 48px round
 * icon (packages/ui tokens.css), and Back to top, 38px and later in the page at the same z-index, covered it: a tap on
 * the chat icon scrolled to the top. Where the launcher is on the page, Back to top sits above it.
 */
describe('Back to top beside the Support chat launcher', () => {
  it('sits above the launcher wherever the launcher is on the page', () => {
    // Hidden until the page is scrolled a screen down; its classes are the same either way.
    const { container } = render(<BackToTop />)
    const button = container.querySelector('button[aria-label="Back to top"]')!
    expect(button.getAttribute('class')!.split(/\s+/))
      .toContain('[:root:has(.hid-chat-launcher)_&]:bottom-[calc(max(20px,env(safe-area-inset-bottom))+60px)]')
  })
})
