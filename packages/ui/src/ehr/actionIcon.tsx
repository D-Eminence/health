'use client'

/**
 * The icon an EHR action button carries when it names none (owner, 18 Nov 2026: every action shows what it does at a
 * glance). Chosen from the action's own words, the first rule that matches winning: what is made (a prescription, a lab
 * request) before the verb (new, save, print). Quiet buttons and anything not worded as an action get none.
 */

import { HugeiconsIcon } from '@hugeicons/react'
import ArrowRight01Icon from '@hugeicons/core-free-icons/ArrowRight01Icon'
import Cancel01Icon from '@hugeicons/core-free-icons/Cancel01Icon'
import Download04Icon from '@hugeicons/core-free-icons/Download04Icon'
import EyeIcon from '@hugeicons/core-free-icons/EyeIcon'
import FloppyDiskIcon from '@hugeicons/core-free-icons/FloppyDiskIcon'
import Medicine02Icon from '@hugeicons/core-free-icons/Medicine02Icon'
import Money03Icon from '@hugeicons/core-free-icons/Money03Icon'
import Note01Icon from '@hugeicons/core-free-icons/Note01Icon'
import PackageReceiveIcon from '@hugeicons/core-free-icons/PackageReceiveIcon'
import PencilEdit01Icon from '@hugeicons/core-free-icons/PencilEdit01Icon'
import PlusSignIcon from '@hugeicons/core-free-icons/PlusSignIcon'
import PrinterIcon from '@hugeicons/core-free-icons/PrinterIcon'
import RefreshIcon from '@hugeicons/core-free-icons/RefreshIcon'
import ScanIcon from '@hugeicons/core-free-icons/ScanIcon'
import Search01Icon from '@hugeicons/core-free-icons/Search01Icon'
import SentIcon from '@hugeicons/core-free-icons/SentIcon'
import TestTube01Icon from '@hugeicons/core-free-icons/TestTube01Icon'
import Tick02Icon from '@hugeicons/core-free-icons/Tick02Icon'
import Upload04Icon from '@hugeicons/core-free-icons/Upload04Icon'
import type { ReactNode } from 'react'

type IconData = Parameters<typeof HugeiconsIcon>[0]['icon']

const RULES: readonly (readonly [RegExp, IconData])[] = [
  [/^(new|add|create)\b.*\bprescription/i, Medicine02Icon],
  [/^(new|add|create)\b.*\blab\b/i, TestTube01Icon],
  [/^(new|add|create)\b.*\bradiology/i, ScanIcon],
  [/^(new|add|create)\b.*\breferral/i, SentIcon],
  [/^add\b.*\bnotes?\b/i, Note01Icon],
  [/^(new|add|create|invite|register a new)\b/i, PlusSignIcon],
  [/^(save|keep)\b/i, FloppyDiskIcon],
  [/^print\b/i, PrinterIcon],
  [/^upload\b/i, Upload04Icon],
  [/^download|^export\b/i, Download04Icon],
  [/^(refresh|reload|check again|try again)\b/i, RefreshIcon],
  [/^(find|search|look up|load)\b/i, Search01Icon],
  [/^(send|ask|request|refer|share)\b/i, SentIcon],
  [/^(sign|edit|correct|change|update|amend|rename)\b/i, PencilEdit01Icon],
  [/^(cancel|close|end|remove|delete|void|reject|deny|decline|revoke|discard|retract|mark .* in error)\b/i, Cancel01Icon],
  [/^(take payment|pay|record payment|refund)\b/i, Money03Icon],
  [/^receive\b/i, PackageReceiveIcon],
  [/^(view|see|show|quick view|preview)\b/i, EyeIcon],
  [/^(approve|confirm|accept|verify|check|dispense|release|register|complete|finish|done|mark .* (done|ready))\b/i, Tick02Icon],
  [/^(open|continue|start|next|go to|begin|assign|transfer|admit|discharge|issue|collect)\b/i, ArrowRight01Icon],
]

/** The words a button says, when its label is plain text. */
function wordsOf(children: ReactNode): string | null {
  if (typeof children === 'string') return children
  if (Array.isArray(children) && children.every(child => typeof child === 'string' || typeof child === 'number')) return children.join('')
  return null
}

/** The icon for an action worded `children`, or null. */
export function actionIcon(children: ReactNode): ReactNode {
  const words = wordsOf(children)?.trim()
  if (!words) return null
  const icon = RULES.find(([pattern]) => pattern.test(words))?.[1]
  return icon ? <HugeiconsIcon icon={icon} size={16} strokeWidth={1.8} aria-hidden /> : null
}
