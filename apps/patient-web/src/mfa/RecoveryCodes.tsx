import { useState, type ButtonHTMLAttributes, type ComponentType, type Ref } from 'react'
import { saveFile } from '../download'

/** A portal's own button. `primary` marks the step's main action; the others are secondary. */
export type RecoveryCodesButton = ComponentType<{ primary?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>>

export interface RecoveryCodesProps {
  codes: readonly string[]
  onDone: () => void
  doneLabel?: string
  /** What the codes cannot do in this portal, said after what they do. */
  limits?: string
  /** The name of the file Download codes saves. */
  fileName: string
  /** The heading's id, which names the section; unique on the page. */
  headingId: string
  headingAs?: 'h1' | 'h2'
  /** Given when the step is the page: its heading can then take focus. */
  headingRef?: Ref<HTMLHeadingElement>
  classNames: { root: string; list: string; actions: string; success: string; error: string; checkbox: string }
  Button: RecoveryCodesButton
}

/**
 * Shows recovery codes the backend returned, once. They live only in the
 * caller's state and are discarded when the person continues. The platform
 * console and the provider portal each draw it with their own classes, button
 * and file name.
 */
export function RecoveryCodes({ codes, onDone, doneLabel = 'Continue', limits, fileName, headingId, headingAs: Heading = 'h2',
  headingRef, classNames, Button }: RecoveryCodesProps) {
  const [saved, setSaved] = useState(false)
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const text = `${codes.join('\n')}\n`

  async function copy() {
    try { await navigator.clipboard.writeText(text); setCopyState('copied') }
    catch { setCopyState('failed') }
  }

  return <section className={classNames.root} aria-labelledby={headingId}>
    <Heading id={headingId} ref={headingRef} tabIndex={headingRef ? -1 : undefined}>Save your backup codes</Heading>
    <p>These {codes.length} codes are shown only now. Each one signs you in once if you lose your phone.
      {limits ? ` ${limits}` : ''} Write them down or print them, and keep them where only you can reach.</p>
    <ol className={classNames.list}>{codes.map(code => <li key={code}><code>{code}</code></li>)}</ol>
    <div className={classNames.actions}>
      <Button onClick={() => void copy()}>Copy codes</Button>
      <Button onClick={() => saveFile(new Blob([text], { type: 'text/plain' }), fileName)}>Download codes</Button>
    </div>
    {copyState === 'copied' && <p role="status" className={classNames.success}>Codes copied.</p>}
    {copyState === 'failed' && <p role="alert" className={classNames.error}>Copying doesn’t work here. Download the codes or write them down.</p>}
    <label className={classNames.checkbox}><input type="checkbox" checked={saved} onChange={event => setSaved(event.target.checked)} />
      I have saved these backup codes somewhere safe</label>
    <Button primary disabled={!saved} onClick={onDone}>{doneLabel}</Button>
  </section>
}
