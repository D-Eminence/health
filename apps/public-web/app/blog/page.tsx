import type { Metadata } from 'next'
import Link from 'next/link'
import { Section, Wrap } from '@hid/ui'
import { ProviderNav } from '@/components/layout/SiteNav'
import { SiteFooter } from '@/components/layout/SiteFooter'
import { BackToTop } from '@/components/shared/BackToTop'
import { DemoDialog } from '@/components/shared/DemoDialog'
import { BLOG_PAGE, BLOG_POSTS, formatPublished, readingMinutes, type BlogPost } from '@/content/blog'
import { ROUTES } from '@/content/site'
import { EarnBand } from '@/components/referral/EarnBand'

export const metadata: Metadata = {
  title: 'Blog',
  description: BLOG_PAGE.lede,
}

function PostMeta({ post }: { readonly post: BlogPost }) {
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-faint">
      <span className="font-semibold text-brand">{post.topic}</span>
      <span aria-hidden="true">·</span>
      <time dateTime={post.published}>{formatPublished(post.published)}</time>
      <span aria-hidden="true">·</span>
      <span>{readingMinutes(post)} min read</span>
    </p>
  )
}

/** The blog index: the newest post first and larger, then the rest as a quiet list. */
export default function BlogPage() {
  const [latest, ...rest] = BLOG_POSTS

  return (
    <>
      <ProviderNav />
      <main id="main">
        <Section labelledBy="blog-title">
          <Wrap>
            <div className="mx-auto max-w-[760px]">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">{BLOG_PAGE.eyebrow}</p>
              <h1 id="blog-title" className="mt-4 font-display text-[clamp(2.5rem,5vw,3.5rem)] leading-[1.05] tracking-[-0.02em] text-balance text-ink">
                {BLOG_PAGE.title}
              </h1>
              <p className="mt-4 max-w-[560px] text-base/relaxed text-muted">{BLOG_PAGE.lede}</p>

              {latest ? (
                <>
                  <article className="mt-14 border-t border-line-strong pt-10">
                    <PostMeta post={latest} />
                    <h2 className="mt-3 font-display text-[clamp(1.875rem,3.4vw,2.5rem)] leading-[1.1] tracking-[-0.015em] text-balance text-ink">
                      <Link href={ROUTES.blogPost(latest.slug)} className="hover:text-brand">{latest.title}</Link>
                    </h2>
                    <p className="mt-3 max-w-[620px] text-[15px]/relaxed text-muted">{latest.summary}</p>
                    <Link href={ROUTES.blogPost(latest.slug)} className="mt-5 inline-block text-sm font-semibold text-brand underline-offset-4 hover:underline"
                      aria-label={`Read ${latest.title}`}>
                      Read the post
                    </Link>
                  </article>

                  {rest.length > 0 && (
                    <ul className="mt-12 border-t border-line-strong">
                      {rest.map(post => (
                        <li key={post.slug} className="border-b border-line py-8">
                          <article>
                            <PostMeta post={post} />
                            <h2 className="mt-2 text-xl font-semibold leading-snug text-ink">
                              <Link href={ROUTES.blogPost(post.slug)} className="hover:text-brand">{post.title}</Link>
                            </h2>
                            <p className="mt-2 max-w-[620px] text-[15px]/relaxed text-muted">{post.summary}</p>
                          </article>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              ) : (
                <p className="mt-14 border-t border-line-strong pt-10 text-[15px] text-muted">No posts yet. Check back soon.</p>
              )}
            </div>
          </Wrap>
        </Section>
        <EarnBand />
      </main>
      <SiteFooter cta />
      <BackToTop />
      <DemoDialog />
    </>
  )
}
