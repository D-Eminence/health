import { useEffect,useRef,useState } from 'react'
import type { StagingPatientChatSource } from '@hid/contracts'
import { useSession } from './session'
/**
 * Where a source's facts came from (the source's `origin`, parsed by @hid/contracts), in the screen's own words (the
 * owner's decision 25): to the patient, "You added this", "Recorded by a health worker" or "From a scanned paper record";
 * to a clinician, the same about the patient. Anything else says nothing.
 */
const ORIGIN_WORDS:Readonly<Record<string,{patient:string;staff:string}>>={
  patient:{patient:'You added this',staff:'Added by the patient'},
  health_worker:{patient:'Recorded by a health worker',staff:'Recorded by a health worker'},
  scanned_paper:{patient:'From a scanned paper record',staff:'From a scanned paper record'},
  health_id_profile:{patient:'From your Health ID profile',staff:'From the patient’s Health ID profile'},
}
export function originText(origin:unknown,staff=false):string|null {
  const words=typeof origin==='string'&&Object.hasOwn(ORIGIN_WORDS,origin)?ORIGIN_WORDS[origin]:undefined
  return words?(staff?words.staff:words.patient):null
}
function fields(value:unknown,depth=0):React.ReactNode {
  if(value===null||value===undefined)return 'Not recorded'
  if(typeof value!=='object')return String(value)
  if(depth>=6)return 'Additional structured details are available in Records.'
  if(Array.isArray(value))return <ul>{value.map((v,i)=><li key={i}>{fields(v,depth+1)}</li>)}</ul>
  return <dl className="chat-source-fields">{Object.entries(value).map(([k,v])=><div key={k}><dt>{k.replace(/([a-z])([A-Z])/g,'$1 $2').replace(/_/g,' ')}</dt><dd>{fields(v,depth+1)}</dd></div>)}</dl>
}
export function ChatSource({source}:{source:StagingPatientChatSource}) {
  const {api}=useSession()
  return <ChatSourceContent source={source} loadSource={api.chatSource} />
}
export function ChatSourceContent({source,loadSource,staff=false}:{source:StagingPatientChatSource;loadSource:(kind:string,id:string,signal?:AbortSignal)=>Promise<Record<string,unknown>>;staff?:boolean}) {
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
  // Said only when the service says where the facts came from; a service before the chat source labels shows as before.
  const origin='kind' in source&&'origin' in source?originText(source.origin,staff):null
  return <li><span className="record-chat-source-number">[{source.number}]</span><div><strong>{source.title}</strong>
    {origin&&<span className="record-chat-source-origin">{origin}</span>}
    <span>{'kind' in source?`${source.provenance} · ${source.quality}`:`Revision ${source.revisionNo} · Signed`}
      {date?' · '+new Date(date).toLocaleDateString('en-NG',{day:'numeric',month:'short',year:'numeric'}):' · Date not recorded'}</span>
    {'kind' in source&&<button type="button" onClick={()=>void open()} disabled={loading}>{loading?'Loading record…':'View source record'}</button>}
    {error&&<p role="alert">{error}</p>}{detail&&<details open><summary>Source details</summary>{fields(detail.fields)}</details>}
  </div></li>
}
