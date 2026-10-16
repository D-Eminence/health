/**
 * The Health ID blog.
 *
 * Posts live here as structured content, like the rest of the site's copy:
 * no CMS, no Markdown runtime, and every claim checked against what the product
 * does today. To publish a post, add an entry to POSTS; the index, the post page,
 * site search and the sitemap of static pages pick it up.
 *
 * A body is a list of blocks so the post page controls the typography. Keep
 * paragraphs short and write for the reader named in `topic`.
 */

export type BlogTopic = 'Patients' | 'Providers' | 'Product'

export type BlogBlock =
  | { readonly type: 'p'; readonly text: string }
  | { readonly type: 'h2'; readonly text: string }
  | { readonly type: 'list'; readonly items: readonly string[] }
  | { readonly type: 'quote'; readonly text: string }

export interface BlogPost {
  /** Lower case words joined by hyphens; it becomes the address /blog/<slug>. */
  readonly slug: string
  readonly title: string
  /** One or two sentences, shown on the index, in search and as the page description. */
  readonly summary: string
  readonly topic: BlogTopic
  /** ISO date, YYYY-MM-DD. */
  readonly published: string
  readonly author: string
  readonly body: readonly BlogBlock[]
}

export const BLOG_PAGE = {
  eyebrow: 'Blog',
  title: 'Notes from Health ID.',
  lede: 'How connected records work, what patients control, and what facilities need to get started.',
} as const

const POSTS: readonly BlogPost[] = [
  {
    slug: 'a-health-id-is-not-a-key-to-your-records',
    title: 'A Health ID is not a key to your records',
    summary: 'Having someone’s Health ID does not let a provider open their medical history. Here is what does, and how patients stay in control.',
    topic: 'Patients',
    published: '2026-10-16',
    author: 'Health ID team',
    body: [
      { type: 'p', text: 'Your Health ID identifies you. It stays with you as you move between participating hospitals, clinics, laboratories and pharmacies, so your care history can follow you instead of starting again at every front desk.' },
      { type: 'p', text: 'Identifying you is not the same as opening your records. A provider who has your Health ID can find you, but your medical history stays protected until access is properly authorised.' },
      { type: 'h2', text: 'What opens a record' },
      { type: 'p', text: 'Access follows the Health ID access and consent workflow. In everyday care, that means you provide your access PIN to the team treating you. Access is then scoped to the information needed for that care, and given to staff whose role calls for it.' },
      { type: 'list', items: [
        'Your Health ID lets a provider identify you.',
        'Your access PIN, or another approved authorisation, is what allows access to your information.',
        'Staff see only what their role and the care being provided require.',
      ] },
      { type: 'h2', text: 'When you cannot give permission' },
      { type: 'p', text: 'Emergencies happen. Approved emergency access can support urgent clinical care when a patient cannot give normal authorisation. It is a documented exception, not a shortcut, and it is recorded like every other access.' },
      { type: 'h2', text: 'Seeing who looked' },
      { type: 'p', text: 'Every access to your record is attributable to the person who made it. In your Health ID you can review who accessed your information and when, and respond to supported access requests.' },
      { type: 'quote', text: 'Keeping a record is different from giving someone access to it.' },
      { type: 'p', text: 'Getting a Health ID is free for patients.' },
    ],
  },
  {
    slug: 'setting-up-your-facility-what-you-need',
    title: 'Setting up your facility: what you need',
    summary: 'A hospital, clinic, laboratory or pharmacy can set itself up on Health ID in four steps. This is what to have ready before you start.',
    topic: 'Providers',
    published: '2026-10-16',
    author: 'Health ID team',
    body: [
      { type: 'p', text: 'Facilities join Health ID by verifying their CAC registration. Verified organisations can activate straight away, without waiting for a routine review by the Health ID team.' },
      { type: 'h2', text: 'Have these ready' },
      { type: 'list', items: [
        'Your CAC registration number, starting RC, BN or IT, exactly as it appears on your certificate.',
        'The name and email address of the person who will administer your facility on Health ID. They will need to open that email during setup.',
        'A phone with an authenticator app installed, for the administrator’s sign-in.',
      ] },
      { type: 'h2', text: 'The four steps' },
      { type: 'list', items: [
        'Organization. Choose your facility type and the first product you need, then enter your CAC number and administrator details. We check the number against the official registry.',
        'Email confirmation. The administrator enters the six-digit code we send to their email.',
        'Password. The administrator chooses a password of at least 12 characters.',
        'Authenticator. The administrator links an authenticator app, then enters the Provider Portal.',
      ] },
      { type: 'h2', text: 'When a person needs to look' },
      { type: 'p', text: 'If your CAC number is already linked to an organisation on Health ID, or the registry check needs a person to resolve it, your application goes to the Health ID team for review instead of activating automatically.' },
      { type: 'p', text: 'Laboratories start with Health ID Laboratory and pharmacies with Health ID Pharmacy. Hospitals, clinics and other providers can start with EHR, Laboratory, Pharmacy or Migrate.' },
    ],
  },
  {
    slug: 'why-every-access-is-recorded',
    title: 'Why every access is recorded',
    summary: 'Audit history is how patients see who opened their record and how facilities show that access was appropriate.',
    topic: 'Product',
    published: '2026-10-16',
    author: 'Health ID team',
    body: [
      { type: 'p', text: 'Connected records only work if people trust them. Patients need to know their information is opened for their care and nothing else. Facilities need to be able to show that it was.' },
      { type: 'h2', text: 'What is recorded' },
      { type: 'p', text: 'Record access and important clinical actions remain attributable to the users who performed them. Who acted, when, and on what is kept, so a question about access can be answered from the record instead of from memory.' },
      { type: 'h2', text: 'Who sees it' },
      { type: 'list', items: [
        'Patients can review who accessed their information and when.',
        'Facility administrators with audit permission can review their facility’s events. Patient identifiers and free-text reasons are withheld from that view.',
      ] },
      { type: 'h2', text: 'Access is still limited first' },
      { type: 'p', text: 'Audit is the second line, not the first. Staff receive access appropriate to their responsibilities, and access can be limited to the information required for the care being provided. The audit history shows that those limits held.' },
    ],
  },
]

/** Newest first; posts on the same day keep their order here. */
export const BLOG_POSTS: readonly BlogPost[] = [...POSTS]
  .map((post, index) => ({ post, index }))
  .sort((a, b) => b.post.published.localeCompare(a.post.published) || a.index - b.index)
  .map(entry => entry.post)

export function findBlogPost(slug: string): BlogPost | undefined {
  return BLOG_POSTS.find(post => post.slug === slug)
}

/** About 220 words a minute, never less than one. */
export function readingMinutes(post: BlogPost): number {
  const words = post.body.reduce((count, block) => {
    const text = block.type === 'list' ? block.items.join(' ') : block.text
    return count + text.split(/\s+/).filter(Boolean).length
  }, 0)
  return Math.max(1, Math.round(words / 220))
}

export function formatPublished(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
}
