'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { usePathname } from 'next/navigation'
import Loading from './loading'

const LOADING_DURATION_MS = 1200

export default function Template({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  return <PageReveal key={pathname}>{children}</PageReveal>
}

function PageReveal({ children }: { children: ReactNode }) {
  const reduce = useReducedMotion()
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const timer = window.setTimeout(() => setLoading(false), LOADING_DURATION_MS)
    return () => window.clearTimeout(timer)
  }, [])

  return <>
    {loading && <div className="route-loading"><Loading /></div>}
    <motion.div
      className={loading ? 'route-content hidden' : 'route-content'}
      initial={{ opacity: 1 }}
      animate={{ opacity: loading && !reduce ? 0 : 1 }}
      transition={{ duration: 0.18 }}
    >{children}</motion.div>
    <noscript><style>{'.route-loading{display:none}.route-content.hidden{display:block!important}'}</style></noscript>
  </>
}
