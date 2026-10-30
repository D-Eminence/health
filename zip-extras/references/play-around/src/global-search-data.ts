import { createElement, type ReactNode } from 'react'
import type { CommandSearchFilterData, CommandSearchGroup, CommandSearchItem } from './components/command-search'

const filterIcon = (path: string): ReactNode => createElement('svg', { className: 'cs-filter-icon', viewBox: '0 0 24 24', 'aria-hidden': true }, createElement('path', { d: path }))
const resultMark = (label: string, className: string): ReactNode => createElement('span', { className: `cs-avatar ${className}`, 'aria-hidden': true }, label)

export const globalSearchFilters: CommandSearchFilterData[] = [
  { id: 'users', label: 'Users', icon: filterIcon('M16 20v-1.8c0-2-1.8-3.7-4-3.7s-4 1.7-4 3.7V20M12 11a3.3 3.3 0 1 0 0-6.6 3.3 3.3 0 0 0 0 6.6M19 8v4M21 10h-4') },
  { id: 'orders', label: 'Orders', icon: filterIcon('M7 4v16M17 4v16M3 8h8M13 16h8M13 8h8M3 16h8') },
  { id: 'transactions', label: 'Transactions', icon: filterIcon('M6 3h12v18l-3-2-3 2-3-2-3 2-3 2zM9 8h6M9 12h6') },
]

export const globalSearchGroups: CommandSearchGroup[] = globalSearchFilters.map(({ id, label }) => ({ id, label }))

export const globalSearchResults: CommandSearchItem[] = [
  { id: 'u1', label: 'Oyeleye Ogunsanya', description: 'Ogunsle · •••••• · 0813 ••••••', category: 'users', icon: resultMark('O', 'cs-avatar--orange'), keywords: ['oyeleye', 'ogunsle', '0813'] },
  { id: 'u2', label: 'Elena Rodriguez', description: 'Rodriguez · •••••• · 0812 ••••••', category: 'users', icon: resultMark('E', 'cs-avatar--teal'), keywords: ['elena', 'rodriguez', '0812'] },
  { id: 'u3', label: 'Victor Chukwuma', description: 'Chukwuma · •••••• · 0809 ••••••', category: 'users', icon: resultMark('V', 'cs-avatar--violet'), keywords: ['victor', 'chukwuma', '0809'] },
  { id: 'o1', label: 'Apple Inc.', description: 'Sara Johnson · $4,000.00 · 10-10-2026', category: 'orders', icon: resultMark('', 'cs-brand--apple'), keywords: ['oyeleye', 'apple', '4000', 'sara'] },
  { id: 'o2', label: 'Adobe Inc.', description: 'Emeka Nwosu · $34,000.00 · 10-10-2026', category: 'orders', icon: resultMark('A', 'cs-brand--adobe'), keywords: ['oyeleye', 'adobe', '34000', 'emeka'] },
  { id: 'o3', label: 'Intel Corporation', description: 'Liam Smith · $600.00 · 10-10-2026', category: 'orders', icon: resultMark('intel', 'cs-brand--intel'), keywords: ['oyeleye', 'intel', '600', 'liam'] },
  { id: 't1', label: 'TXN-90818', description: 'Apple Inc. · $4,000.00 · 10-10-2026', category: 'transactions', avatar: '↗', keywords: ['txn', '90818', 'apple', '4000', '10-10-2026'] },
]
