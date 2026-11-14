import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Section, Wrap } from '@hid/ui'
import { ProviderNav } from '@/components/layout/SiteNav'
import { SiteFooter } from '@/components/layout/SiteFooter'
import { BackToTop } from '@/components/shared/BackToTop'
import { DemoDialog } from '@/components/shared/DemoDialog'
import { BLOG_POSTS, findBlogPost, formatPublished, readingMinutes, type BlogBlock } from '@/content/blog'
import { ROUTES } from '@/content/site'

interface PageProps {
  readonly params: Promise<{ readonly slug: string }>
}

/** Every post is known at build time, so all of them are pre-rendered. */
export function generateStaticParams() {
  return BLOG_POSTS.map(post => ({ slug: post.slug }))
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params
  const post = findBlogPost(slug)
  if (!post) return {}
  return {
    title: post.title,
    description: post.summary,
    openGraph: { type: 'article', title: post.title, description: post.summary, publishedTime: post.published },
  }
}

function Block({ block }: { readonly block: BlogBlock }) {
  switch (block.type) {
    case 'h2':
      return <h2 className="mt-12 text-[22px] font-semibold leading-snug text-ink">{block.text}</h2>
    case 'list':
      return (
        <ul className="mt-5 grid list-disc gap-2.5 pl-5 text-[17px]/[1.7] text-text marker:text-faint">
          {block.items.map(item => <li key={item}>{item}</li>)}
        </ul>
      )
    case 'quote':
      return (
        <blockquote className="my-10 font-display text-[clamp(1.5rem,2.6vw,1.875rem)] leading-[1.25] text-balance text-ink">
          {block.text}
        </blockquote>
      )
    case 'p':
      return <p className="mt-5 text-[17px]/[1.7] text-text">{block.text}</p>
  }
}

export default async function BlogPostPage({ params }: PageProps) {
  const { slug } = await params
  const post = findBlogPost(slug)

  // An unknown slug is a 404, not an empty page.
  if (!post) notFound()

  const others = BLOG_POSTS.filter(other => other.slug !== post.slug).slice(0, 2)

  return (
    <>
      <ProviderNav />
      <main id="main">
        <Section labelledBy="post-title">
          <Wrap>
            <article className="mx-auto max-w-[680px]">
              <Link href={ROUTES.blog} className="text-sm font-medium text-muted hover:text-brand">← All posts</Link>
              <p className="mt-10 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-faint">
                <span className="font-semibold text-brand">{post.topic}</span>
                <span aria-hidden="true">·</span>
                <time dateTime={post.published}>{formatPublished(post.published)}</time>
                <span aria-hidden="true">·</span>
                <span>{readingMinutes(post)} min read</span>
              </p>
              <h1 id="post-title" className="mt-4 font-display text-[clamp(2.25rem,4.6vw,3.25rem)] leading-[1.06] tracking-[-0.02em] text-balance text-ink">
                {post.title}
              </h1>
              <p className="mt-5 text-lg/relaxed text-muted">{post.summary}</p>
              <p className="mt-6 border-b border-line pb-8 text-sm text-muted">By {post.author}</p>

              <div className="pt-3">
                {post.body.map((block, index) => <Block key={index} block={block} />)}
              </div>
            </article>

            {others.length > 0 && (
              <aside aria-labelledby="more-posts" className="mx-auto mt-20 max-w-[680px] border-t border-line-strong pt-10">
                <h2 id="more-posts" className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">More from the blog</h2>
                <ul className="mt-6 grid gap-8 sm:grid-cols-2">
                  {others.map(other => (
                    <li key={other.slug}>
                      <p className="text-[13px] font-semibold text-brand">{other.topic}</p>
                      <Link href={ROUTES.blogPost(other.slug)} className="mt-1.5 block text-[17px] font-semibold leading-snug text-ink hover:text-brand">
                        {other.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              </aside>
            )}
          </Wrap>
        </Section>
      </main>
      <SiteFooter cta />
      <BackToTop />
      <DemoDialog />
    </>
  )
}
