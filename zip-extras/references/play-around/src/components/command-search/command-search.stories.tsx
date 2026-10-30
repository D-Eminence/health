import type { CommandSearchProps } from './command-search.types'
export const defaultCommandSearch: CommandSearchProps = { defaultOpen: true, results: [{ id: 'user-1', label: 'Ada Lovelace', category: 'Users', description: 'ada · 0800 000 0000' }] }
export const loadingCommandSearch: CommandSearchProps = { ...defaultCommandSearch, loading: true }
export const emptyCommandSearch: CommandSearchProps = { ...defaultCommandSearch, results: [], emptyMessage: 'No documents found' }
export const errorCommandSearch: CommandSearchProps = { ...defaultCommandSearch, error: true }
export const controlledCommandSearch: CommandSearchProps = { ...defaultCommandSearch, open: true }
