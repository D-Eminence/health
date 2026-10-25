import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import BlogPage from '../app/blog/page'

// The page frame (navigation, footer, dialogs) needs the app router; the blog list does not.
vi.mock('@/components/layout/SiteNav', () => ({ ProviderNav: () => null }))
vi.mock('@/components/layout/SiteFooter', () => ({ SiteFooter: () => null }))
vi.mock('@/components/shared/BackToTop', () => ({ BackToTop: () => null }))
vi.mock('@/components/shared/DemoDialog', () => ({ DemoDialog: () => null }))
import { BLOG_POSTS, findBlogPost, readingMinutes } from '../content/blog'
import { ROUTES } from '../content/site'

describe('blog', () => {
  it('has well-formed posts with unique addresses, newest first', () => {
    expect(BLOG_POSTS.length).toBeGreaterThan(0)
    expect(new Set(BLOG_POSTS.map(post => post.slug)).size).toBe(BLOG_POSTS.length)
    for (const post of BLOG_POSTS) {
      expect(post.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
      expect(post.published).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(Number.isNaN(Date.parse(post.published))).toBe(false)
      expect(post.title.trim()).not.toBe('')
      expect(post.summary.length).toBeLessThanOrEqual(200)
      expect(post.body.length).toBeGreaterThan(0)
      expect(readingMinutes(post)).toBeGreaterThanOrEqual(1)
    }
    const dates = BLOG_POSTS.map(post => post.published)
    expect([...dates].sort().reverse()).toEqual(dates)
  })

  it('finds a post by its address and nothing else', () => {
    const first = BLOG_POSTS[0]!
    expect(findBlogPost(first.slug)).toBe(first)
    expect(findBlogPost('no-such-post')).toBeUndefined()
    expect(ROUTES.blogPost(first.slug)).toBe(`/blog/${first.slug}`)
  })

  /**
   * The facility guide is the public pre-read for the portal's facility sign-up, which production runs on the Novu
   * backend: three steps (the portal's NOVU_STEPS in apps/patient-web/src/staff/routes/ProviderEnrollment.tsx; apps
   * cannot import each other, so the names are repeated here), no authenticator, and no review queue before activation.
   */
  it('describes facility sign-up as the portal runs it in production', () => {
    const guide = findBlogPost('setting-up-your-facility-what-you-need')!
    const text = [guide.title, guide.summary, ...guide.body.map(block => block.type === 'list' ? block.items.join(' ') : block.text)]
      .join(' ')
    expect(text).not.toMatch(/authenticator/i)
    expect(text).not.toMatch(/four steps|for review instead/i)
    expect(guide.summary).toMatch(/in three steps\./)
    const stepsHeading = guide.body.findIndex(block => block.type === 'h2' && block.text === 'The three steps')
    const steps = guide.body[stepsHeading + 1]
    expect(steps?.type).toBe('list')
    expect(steps?.type === 'list' ? steps.items.map(item => item.split('.')[0]) : null)
      .toEqual(['Organization', 'Email confirmation', 'Password'])
    // What the portal's fine print promises, and where a sign-up that can't finish automatically goes.
    expect(text).toContain('Health ID support also checks every new facility within one working day of its sign-up.')
    expect(text).toContain('Setup then stops and asks you to contact Health ID support.')
  })

  it('lists every post on the index, each linking to its page', () => {
    render(<BlogPage />)
    expect(screen.getByRole('heading', { level: 1, name: 'Notes from Health ID.' })).toBeTruthy()
    for (const post of BLOG_POSTS) {
      const link = screen.getByRole('link', { name: post.title })
      expect(link.getAttribute('href')).toBe(`/blog/${post.slug}`)
    }
  })
})
