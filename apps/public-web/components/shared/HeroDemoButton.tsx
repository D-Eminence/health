import type { AnchorHTMLAttributes } from 'react'

type HeroDemoButtonProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
  href?: string
  size?: 'sm' | 'md'
  variant?: 'primary' | 'secondary'
}

/**
 * Shared by demo and patient actions. On hover or keyboard focus,
 * its white arrow panel expands across the Health ID blue button.
 */
export function HeroDemoButton({ href = '#demo', className, size = 'md', variant = 'primary', children = 'Book a demo', ...props }: HeroDemoButtonProps) {
  const chevrons = [0, 1, 2, 3, 4]

  return (
    <a {...props} href={href} data-variant={variant} className={`hero-demo-button${size === 'sm' ? ' hero-demo-button--sm' : ''}${className ? ` ${className}` : ''}`}>
      <span className="hero-demo-button-panel" aria-hidden="true">
        <span className="hero-demo-button-arrow"><DottedChevron /></span>
        <span className="hero-demo-button-trail">
          {chevrons.map(index => <span className="hero-demo-button-trail-chevron" data-index={index} key={index}><DottedChevron /></span>)}
        </span>
      </span>
      <span className="hero-demo-button-label">{children}</span>
    </a>
  )
}

function DottedChevron() {
  return <svg width="20" height="28" viewBox="0 0 20 28" fill="none" focusable="false">
    <circle cx="4" cy="4" r="2" fill="currentColor" />
    <circle cx="10" cy="9" r="2" fill="currentColor" />
    <circle cx="16" cy="14" r="2" fill="currentColor" />
    <circle cx="10" cy="19" r="2" fill="currentColor" />
    <circle cx="4" cy="24" r="2" fill="currentColor" />
  </svg>
}
