import { Fragment } from 'react'
// Limited formatting only. React escapes all content; no HTML parser, automatic
// URLs or model-generated link targets are accepted.
function inline(text:string) {
  return text.split(/(\*\*[^*\n]+\*\*)/g).map((part,i)=>part.startsWith('**')&&part.endsWith('**')
    ? <strong key={i}>{part.slice(2,-2)}</strong>:<Fragment key={i}>{part}</Fragment>)
}
export function RecordAnswer({text}:{text:string}) {
  return <div className="record-chat-answer">{text.split(/\n\s*\n/).map((block,i)=>{
    const lines=block.split('\n')
    if(lines.every(line=>/^\s*[-*]\s+/.test(line)))return <ul key={i}>{lines.map((line,j)=><li key={j}>{inline(line.replace(/^\s*[-*]\s+/,''))}</li>)}</ul>
    return <p key={i}>{inline(block)}</p>
  })}</div>
}
