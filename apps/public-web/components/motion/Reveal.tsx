'use client'

import type { ReactNode } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { EASE_OUT } from '@/lib/ease'

/** Be UI content-reveal recipe: one short entrance per meaningful surface. */
export function Reveal({ children, className, delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const reduce = useReducedMotion()
  return <motion.div className={className}
    initial={{ opacity: 0, y: reduce ? 0 : 12 }}
    whileInView={{ opacity: 1, y: 0 }}
    viewport={{ once: true, amount: 0.12 }}
    transition={{ duration: reduce ? 0.12 : 0.28, delay: reduce ? 0 : delay, ease: EASE_OUT }}
  >{children}</motion.div>
}
