import type { ReactNode } from 'react'

export type CommandSearchItem = {
  id: string; label: string; description?: string; category: string; icon?: ReactNode; avatar?: string
  metadata?: string[]; keywords?: string[]; href?: string; disabled?: boolean
}
export type CommandSearchFilter = { id: string; label: string; icon?: ReactNode; disabled?: boolean }
export type CommandSearchGroup = { id: string; label: string }
export type CommandSearchVariant = 'default' | 'compact' | 'full-page'
export type CommandSearchProps = {
  open?: boolean; defaultOpen?: boolean; onOpenChange?: (open: boolean) => void; placeholder?: string
  searchValue?: string; defaultSearchValue?: string; onSearchValueChange?: (value: string) => void
  filters?: CommandSearchFilter[]; activeFilters?: string[]; onFiltersChange?: (filters: string[]) => void
  groups?: CommandSearchGroup[]; results?: CommandSearchItem[]; loading?: boolean; error?: boolean | Error
  emptyMessage?: string; searchDebounce?: number; maxResults?: number; onResultSelect?: (item: CommandSearchItem) => void
  onClear?: () => void; onRetry?: () => void; showFooter?: boolean; showFilters?: boolean; trigger?: ReactNode
  keyboardShortcut?: boolean; className?: string; variant?: CommandSearchVariant; renderItem?: (item: CommandSearchItem, active: boolean) => ReactNode
  renderGroup?: (group: CommandSearchGroup) => ReactNode; renderEmpty?: () => ReactNode; renderLoading?: () => ReactNode; renderError?: () => ReactNode
}
