'use client'

import { useEffect, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { ProductDashboard } from '@/components/shared/ProductDashboard'
import type { ProductDetail } from '@/content/product-details'

/** A crop of the same dashboard used in the product hero. */
export function ModuleDashboardPreview({ product }: { product: ProductDetail }) {
  const ref = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(.7)
  const reduce = useReducedMotion()
  useEffect(() => {
    const node = ref.current
    if (!node) return
    const update = () => setScale(Math.max(.5, (node.clientWidth - 48) / 960))
    update()
    const observer = new ResizeObserver(update)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  return <div ref={ref} className="module-showcase-visual">
    <motion.div key={product.slug} className="module-dashboard-reveal" initial={{ opacity: 0, y: reduce ? 0 : 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduce ? 0 : .24 }}>
      <div className="module-dashboard-canvas" style={{ transform: `scale(${scale})` }}>
        <ProductDashboard product={product} />
      </div>
    </motion.div>
  </div>
}
