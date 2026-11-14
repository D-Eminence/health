import { ProductDashboard } from '@/components/shared/ProductDashboard'
import { findProductDetail } from '@/content/product-details'

/** The provider hero uses the same illustrative clinical workspace as EHR. */
export function FacilityDashboard() {
  const product = findProductDetail('ehr')
  return product ? <ProductDashboard product={product} /> : null
}
