import { createElement } from 'react'
import { EhrIcon } from '@hid/ui/ehr'
import type { EhrBluePage } from '../frame/types'
import { BlueHome } from './BlueHome'

/** Home: live cards from today's Overview and work pages, and each demo role's sample dashboard ("View as"). */
export const pages: EhrBluePage[] = [
  { path: '', group: '', label: 'Home', icon: createElement(EhrIcon, { name: 'home' }), status: 'partial', element: createElement(BlueHome) },
]
