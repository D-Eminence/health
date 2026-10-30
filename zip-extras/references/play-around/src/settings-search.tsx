import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { CommandSearch } from './components/command-search'
import { globalSearchFilters, globalSearchGroups, globalSearchResults } from './global-search-data'
import './styles/product-tokens.css'
import './styles/tokens.css'

const mount = document.getElementById('global-search-root')

if (mount) {
  const isMac = /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent)

  createRoot(mount).render(
    <StrictMode>
      <CommandSearch
        trigger={
          <button className="global-search" type="button" aria-label="Open search">
            <svg className="svg-icon" aria-hidden="true" viewBox="0 0 24 24">
              <path d="m20 20-4.2-4.2M10.7 18a7.3 7.3 0 1 1 0-14.6 7.3 7.3 0 0 1 0 14.6z" />
            </svg>
            <span>Search user name, ID, tran...</span>
            <kbd>{isMac ? '⌘ K' : 'Ctrl K'}</kbd>
          </button>
        }
        placeholder="Search user, order, transaction…"
        filters={globalSearchFilters}
        groups={globalSearchGroups}
        results={globalSearchResults}
        maxResults={6}
        onResultSelect={item => console.info('Selected', item)}
      />
    </StrictMode>,
  )
}
