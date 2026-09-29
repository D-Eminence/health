import type { AnchorHTMLAttributes } from 'react'
import { HealthIcon } from './HealthIcon'

type HeroDemoButtonProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
  href?: string
  size?: 'sm' | 'md'
  variant?: 'primary' | 'secondary'
}

/**
 * Shared by demo and patient actions. The small Hugeicons cue reinforces that
 * this is a navigation action without turning the control into a decoration.
 */
export function HeroDemoButton({ href = '#demo', className, size = 'md', variant = 'primary', children = 'Book a demo', ...props }: HeroDemoButtonProps) {
  return (
    <a {...props} href={href} data-variant={variant} className={`hero-demo-button${size === 'sm' ? ' hero-demo-button--sm' : ''}${className ? ` ${className}` : ''}`}>
      <span className="hero-demo-button-panel" aria-hidden="true">
        <span className="hero-demo-button-arrow"><HealthIcon name="arrow" size={16} /></span>
      </span>
      <span className="hero-demo-button-label">{children}</span>
    </a>
  )
}
