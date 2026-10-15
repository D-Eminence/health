import { useEffect,useRef,useState } from 'react'
import type { PatientChatSource } from '@hid/contracts'
import { useSession } from './session'
function fields(value:unknown,depth=0):React.ReactNode {
  if(value===null||value===undefined)return 'Not recorded'
  if(typeof value!=='object')return String(value)
  if(depth>=6)return 'Additional structured details are available in Records.'
  if(Array.isArray(value))return <ul>{value.map((v,i)=><li key={i}>{fields(v,depth+1)}</li>)}</ul>
  return <dl className="chat-source-fields">{Object.entries(value).map(([k,v])=><div key={k}><dt>{k.replace(/([a-z])([A-Z])/g,'$1 $2').replace(/_/g,' ')}</dt><dd>{fields(v,depth+1)}</dd></div>)}</dl>
}
export function ChatSource({source}:{source:PatientChatSource}) {
  const {api}=useSession()
  return <ChatSourceContent source={source} loadSource={api.chatSource} />
}
export function ChatSourceContent({source,loadSource}:{source:PatientChatSource;loadSource:(kind:string,id:string,signal?:AbortSignal)=>Promise<Record<string,unknown>>}) {
  const [detail,setDetail]=useState<Record<string,unknown>|null>(null);const [error,setError]=useState('');
  const [loading,setLoading]=useState(false);const flight=useRef<AbortController|null>(null)
  useEffect(()=>()=>flight.current?.abort(),[])
  const open=async()=>{
    if(!('kind' in source))return
    flight.current?.abort();const controller=new AbortController();flight.current=controller
    setLoading(true);setError('');setDetail(null)
    try{const value=await loadSource(source.kind,source.id,controller.signal);if(!controller.signal.aborted){
      if(value.version!==source.version)setError('This record has changed since the answer was saved. These are its current details.')
      setDetail(value)
    }}
    catch{if(!controller.signal.aborted)setError('This source could not be loaded. It may have changed or become unavailable.')}
    finally{if(!controller.signal.aborted)setLoading(false)}
  }
  const date='kind' in source?source.effectiveAt??source.recordedAt:source.signedAt
  return <li><span className="record-chat-source-number">[{source.number}]</span><div><strong>{source.title}</strong>
    <span>{'kind' in source?`${source.provenance} · ${source.quality}`:`Revision ${source.revisionNo} · Signed`}
      {date?' · '+new Date(date).toLocaleDateString('en-NG',{day:'numeric',month:'short',year:'numeric'}):' · Date not recorded'}</span>
    {'kind' in source&&<button type="button" onClick={()=>void open()} disabled={loading}>{loading?'Loading record…':'View source record'}</button>}
    {error&&<p role="alert">{error}</p>}{detail&&<details open><summary>Source details</summary>{fields(detail.fields)}</details>}
  </div></li>
}
