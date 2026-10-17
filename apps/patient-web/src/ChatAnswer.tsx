import type { PatientChatCoverage, PatientChatSource, PatientChatSourceKind, PatientChatStoredReply } from '@hid/contracts'

const KIND_LABELS: Record<PatientChatSourceKind, string> = {
  encounter: 'Visit', note: 'Clinical note', diagnosis: 'Diagnosis', prescription: 'Prescription',
  lab_result: 'Lab result', vital: 'Vital signs', document: 'Document',
}

function sourceDate(source: PatientChatSource): string {
  const value = source.effectiveOn ?? source.recordedOn
  if (!value) return 'Date not recorded'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return 'Date not recorded'
  // A calendar date keeps its day in every timezone.
  return parsed.toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

/** The anchor a reference marker points at, one per answer. */
const sourceAnchor = (answerId: string, number: number) => `chat-source-${answerId}-${number}`

function Coverage({ coverage }: { coverage: PatientChatCoverage }) {
  const partial = !coverage.complete
  const withheld = coverage.withheld
  if (!partial && withheld.length === 0) return null
  return <p className="record-chat-preparing">
    {partial && <>This answer used {coverage.selectedCount} of {coverage.recordCount} released records, so it may be incomplete. </>}
    {withheld.length > 0 && <>These record types are not released to you yet and were not read: {withheld.join(', ')}.</>}
  </p>
}

/**
 * An answer as hid-system returns it (ADR-068): plain text blocks, never markup. A `record` block cites the
 * numbered sources below it; an `explanation` or `safety` block cites none. A refused or unchecked answer
 * (`declined`, `unverified`) is a fixed text and cites nothing.
 */
export function ChatAnswer({ answerId, reply, coverage }: { answerId: string; reply: PatientChatStoredReply; coverage?: PatientChatCoverage }) {
  const fixed = reply.status === 'declined' || reply.status === 'unverified'
  return <div className="record-chat-answer-blocks">
    {reply.blocks.map((block, index) => <div key={index} className={`record-chat-block record-chat-block-${block.kind}${fixed ? ' record-chat-block-fixed' : ''}`}>
      {block.kind === 'safety' && <span className="record-chat-block-label">Important</span>}
      <p>{block.text}</p>
      {block.kind === 'record' && block.references.length > 0 && <p className="record-chat-references">
        <span className="record-chat-block-label">From</span>
        {block.references.map(number => <a key={number} href={`#${sourceAnchor(answerId, number)}`}
          aria-label={`Record reference ${number}`}>[{number}]</a>)}
      </p>}
    </div>)}
    {coverage && <Coverage coverage={coverage} />}
    {reply.sources.length > 0 && <details className="record-chat-sources" open>
      <summary>{reply.sources.length} record {reply.sources.length === 1 ? 'reference' : 'references'}</summary>
      <ul>{reply.sources.map(source => <li key={source.number} id={sourceAnchor(answerId, source.number)}>
        <span className="record-chat-source-number">[{source.number}]</span>
        <div><strong>{source.title}</strong><span>{KIND_LABELS[source.kind]} · {sourceDate(source)}</span></div>
      </li>)}</ul>
    </details>}
  </div>
}
