/**
 * Small line drawings for empty states (owner, 2026-10-31): original, simple, greys only. They draw in currentColor at
 * set opacities, so they follow the text colour of the light and dark themes; no brand colour, no text. Decorative:
 * the empty state's words carry the meaning, so every drawing is hidden from assistive technology.
 */
import type { ReactNode } from 'react'

export type IllustrationName = 'patient' | 'records' | 'inbox' | 'calendar' | 'flask' | 'pill' | 'search' | 'generic'

/** The soft shadow every drawing stands on. */
const ground = <ellipse cx="60" cy="86" rx="38" ry="4" fill="currentColor" opacity=".08" stroke="none" />

const DRAWINGS: Record<IllustrationName, ReactNode> = {
  // A person's outline with a small search lens: "choose a patient first".
  patient: <>
    {ground}
    <circle cx="50" cy="30" r="12" fill="currentColor" fillOpacity=".06" />
    <path d="M26 78c0-14 10.7-24 24-24s24 10 24 24" fill="currentColor" fillOpacity=".06" />
    <circle cx="82" cy="56" r="10" fill="var(--color-surface, #fff)" opacity=".9" />
    <circle cx="82" cy="56" r="10" />
    <path d="m89.5 63.5 8 8" strokeWidth="2.5" />
  </>,
  // A folder with a document standing in it.
  records: <>
    {ground}
    <path d="M44 20h28l10 10v34H44z" fill="var(--color-surface, #fff)" />
    <path d="M44 20h28l10 10v34H44z" />
    <path d="M72 20v10h10" />
    <path d="M51 38h22M51 45h22M51 52h14" opacity=".5" />
    <path d="M24 44a4 4 0 0 1 4-4h18l6 6h40a4 4 0 0 1 4 4v28a4 4 0 0 1-4 4H28a4 4 0 0 1-4-4z" fill="currentColor" fillOpacity=".06" />
  </>,
  // An empty tray with a check above it: nothing waiting.
  inbox: <>
    {ground}
    <path d="M24 56l10-22h52l10 22v20a4 4 0 0 1-4 4H28a4 4 0 0 1-4-4z" fill="currentColor" fillOpacity=".05" />
    <path d="M24 56h20l4 8h24l4-8h20" />
    <circle cx="60" cy="22" r="10" />
    <path d="m55 22 3.5 3.5L65.5 18" />
  </>,
  calendar: <>
    {ground}
    <rect x="30" y="22" width="60" height="56" rx="6" fill="currentColor" fillOpacity=".05" />
    <path d="M30 36h60" />
    <path d="M44 16v12M76 16v12" strokeWidth="2.5" />
    <g opacity=".45"><path d="M42 48h6M57 48h6M72 48h6M42 60h6M57 60h6" /></g>
    <rect x="70" y="56" width="10" height="9" rx="2" />
  </>,
  // A lab flask with a little liquid.
  flask: <>
    {ground}
    <path d="M52 16h16M54 16v20L36 72a6 6 0 0 0 5.4 8.5h37.2A6 6 0 0 0 84 72L66 36V16" />
    <path d="M44 58h32l6.2 13.2A4 4 0 0 1 78.6 77H41.4a4 4 0 0 1-3.6-5.8z" fill="currentColor" fillOpacity=".08" stroke="none" />
    <path d="M44 58h32" opacity=".5" />
    <circle cx="56" cy="68" r="2" opacity=".5" /><circle cx="66" cy="64" r="1.5" opacity=".5" />
  </>,
  // A capsule and a round tablet.
  pill: <>
    {ground}
    <g transform="rotate(-35 50 50)">
      <rect x="26" y="40" width="48" height="20" rx="10" fill="currentColor" fillOpacity=".05" />
      <path d="M50 40v20" />
    </g>
    <circle cx="84" cy="66" r="11" fill="currentColor" fillOpacity=".05" />
    <path d="M77 66h14" opacity=".5" />
  </>,
  // A lens over empty lines: no results.
  search: <>
    {ground}
    <rect x="26" y="20" width="52" height="58" rx="6" fill="currentColor" fillOpacity=".04" />
    <path d="M36 34h32M36 44h24M36 54h18" opacity=".45" />
    <circle cx="74" cy="56" r="14" fill="var(--color-surface, #fff)" />
    <circle cx="74" cy="56" r="14" />
    <path d="m84 66 10 10" strokeWidth="2.5" />
  </>,
  // Three stacked cards: an empty list.
  generic: <>
    {ground}
    <rect x="34" y="18" width="52" height="16" rx="5" opacity=".4" />
    <rect x="28" y="40" width="64" height="18" rx="5" fill="currentColor" fillOpacity=".05" />
    <rect x="34" y="64" width="52" height="16" rx="5" opacity=".4" />
    <circle cx="40" cy="49" r="4" /><path d="M50 49h30" opacity=".5" />
  </>,
}

export function Illustration({ name, className }: { name: IllustrationName; className?: string }) {
  return <svg viewBox="0 0 120 96" width="120" height="96" aria-hidden="true" focusable="false" fill="none" stroke="currentColor"
    strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={['shrink-0 text-ink-3', className].filter(Boolean).join(' ')}>
    {DRAWINGS[name]}
  </svg>
}
