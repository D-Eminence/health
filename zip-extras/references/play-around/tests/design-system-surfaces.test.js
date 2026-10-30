import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = path => readFileSync(resolve(path), 'utf8')

describe('design system surface and border hierarchy', () => {
  it('keeps pale panel fills and low-contrast dark equivalents in shared tokens', () => {
    const tokens = read('src/styles/product-tokens.css')

    expect(tokens).toContain('--color-surface-panel: #f8f8f8;')
    expect(tokens).toContain('--color-surface-panel: #121212;')
    expect(tokens).toContain('--color-border: #f0f0f0;')
    expect(tokens).toContain('--color-border: #242424;')
    expect(tokens).toContain('--color-surface-selected: #242424;')
  })

  it('reserves hairlines for structure, 1px for controls, and 2px for focus', () => {
    const tokens = read('src/styles/product-tokens.css')
    const stylesheets = [
      'settings-dashboard/styles.css',
      'settings-dashboard/dashboard-pages.css',
      'settings-dashboard/sidebar-system.css',
      'settings-dashboard/theme-preview.css',
      'settings-dashboard/toast-system.css',
      'settings-dashboard/home-dashboard.css',
      'src/components/command-search/command-search.css',
    ].map(read).join('\n')

    expect(tokens).toContain('--border-width-hairline: 0.5px;')
    expect(tokens).toContain('--border-width-control: 1px;')
    expect(tokens).toContain('--border-width-focus: 2px;')
    expect(stylesheets).toContain('var(--border-width-hairline)')
    expect(stylesheets).toContain('var(--border-width-control)')
    expect(stylesheets).not.toMatch(/border(?:-[a-z]+)?:\s*1\.5px\b/)
  })

  it('documents the same system rules used by the implementation', () => {
    const documentation = read('docs/DESIGN_SYSTEM.md')

    expect(documentation).toContain('`--border-width-hairline` = 0.5px')
    expect(documentation).toContain('`--color-surface-panel`')
    expect(documentation).toContain('top-right on desktop')
  })

  it('keeps sidebar hover and current rows theme-aware', () => {
    const sidebar = read('settings-dashboard/sidebar-system.css')
    const base = read('settings-dashboard/styles.css')

    expect(sidebar).toMatch(/\.sidebar-system \.nav-item\[aria-current="page"\][\s\S]*?background: var\(--color-surface-selected\);/)
    expect(sidebar).toMatch(/\.sidebar-system \.nav-item\[aria-current="page"\][\s\S]*?color: var\(--color-text\);/)
    expect(base).toMatch(/\.nav-item\[aria-current="page"\]\{background:var\(--color-surface-selected\);color:var\(--color-text\)\}/)
    expect(sidebar).not.toContain('background: #efefef;')
  })

  it('does not allow hardcoded neutral colors in dashboard component styles', () => {
    const dashboardStyles = [
      'settings-dashboard/styles.css',
      'settings-dashboard/refinements.css',
      'settings-dashboard/sidebar-system.css',
      'settings-dashboard/theme-preview.css',
      'settings-dashboard/toast-system.css',
      'settings-dashboard/dashboard-pages.css',
      'settings-dashboard/home-dashboard.css',
    ].map(read).join('\n')

    expect(dashboardStyles).not.toMatch(/#[0-9a-f]{3,8}\b/i)
    expect(dashboardStyles).not.toMatch(/rgba?\(/i)
    expect(dashboardStyles).toContain('html[data-theme="dark"] .table-avatar')
  })
})
