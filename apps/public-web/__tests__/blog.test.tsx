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

  it('lists every post on the index, each linking to its page', () => {
    render(<BlogPage />)
    expect(screen.getByRole('heading', { level: 1, name: 'Notes from Health ID.' })).toBeTruthy()
    for (const post of BLOG_POSTS) {
      const link = screen.getByRole('link', { name: post.title })
      expect(link.getAttribute('href')).toBe(`/blog/${post.slug}`)
    }
  })
})
