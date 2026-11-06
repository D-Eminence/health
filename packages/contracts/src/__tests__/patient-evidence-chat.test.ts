import {expect,it} from 'vitest'
import {parseStagingChatHistory,parseStagingPatientChat as parsePatientChat} from '../stagingChat'
const source={number:1,kind:'prescription',id:'22222222-2222-4222-8222-222222222222',version:'3',title:'Recorded prescription',recordedAt:'2026-10-01',effectiveAt:null,provenance:'Clinician prescription',quality:'active'}
it('accepts typed references and declared gaps while stripping unexpected private source fields',()=>{
 const value=parsePatientChat({status:'ready',answer:'Recorded medicine [1].',sources:[{...source,hash:'private-binding'}],coverage:{complete:false,unavailable:['Lab service unavailable'],pendingDocuments:1,recordCount:3,selectedCount:1}})
 expect(value.sources[0]).toMatchObject(source);expect(JSON.stringify(value.sources)).not.toContain('hash');expect(value.coverage?.complete).toBe(false)
});
it.each([{...source,kind:'unknown'},{...source,id:'other'},{...source,recordedAt:'invalid date'}])('rejects malformed source references',s=>{
 expect(()=>parsePatientChat({status:'ready',answer:'Answer',sources:[s]})).toThrow()
});
it('retains compatibility with existing note-only saved replies',()=>{
 expect(parsePatientChat({status:'ready',answer:'Old answer [1].',sources:[{number:1,noteId:'legacy-note',revisionNo:1,title:'Visit',signedAt:'2026-10-01'}]}).sources).toHaveLength(1)
});
it.each([1,4,5,7,8])('accepts valid version %s record UUIDs',version=>{
 const id=`22222222-2222-${version}222-8222-222222222222`;
 expect(parsePatientChat({status:'ready',answer:'Answer [1]',sources:[{...source,id}]}).sources[0]).toMatchObject({id})
});
// Where a source's facts came from (the owner's decision 25): kept when it is one the screens can say, left out when
// it isn't (a newer service never stops the answer showing), and absent from a service before the chat source labels.
it.each(['patient','health_worker','scanned_paper','health_id_profile'] as const)('keeps a source\'s origin %s',origin=>{
 expect(parsePatientChat({status:'ready',answer:'Answer [1]',sources:[{...source,origin,originLabel:'Server words'}]}).sources[0]).toEqual({...source,origin})
});
it.each(['clinician',7,null,'']) ('leaves out an origin the screens cannot say (%s) without refusing the answer',origin=>{
 const value=parsePatientChat({status:'ready',answer:'Answer [1]',sources:[{...source,origin}]})
 expect(value.sources[0]).toEqual(source);expect('origin' in value.sources[0]!).toBe(false)
});
it('reads a source without an origin as before',()=>{
 expect(parsePatientChat({status:'ready',answer:'Answer [1]',sources:[source]}).sources[0]).toEqual(source)
});
// Records the patient added themselves (hid-system 0116): a source kind of both chats. Without it one such source would
// make the answer, and every saved conversation that cites it, unreadable for the patient and for staff.
const added={number:2,kind:'patient_entry',id:'22222222-2222-4222-8222-222222222297',version:'1',title:'Amoxicillin 500 mg',
 recordedAt:'2026-10-02T09:00:00.000Z',effectiveAt:'2026-10-01T00:00:00.000Z',provenance:'Record added by the patient, not checked by a health worker',quality:'patient-reported'}
it('reads a record the patient added as a source, with its origin',()=>{
 const value=parsePatientChat({status:'ready',answer:'You take amoxicillin [2] and a prescription [1].',sources:[source,{...added,origin:'patient',originLabel:'You added this'}]})
 expect(value.sources[1]).toEqual({...added,origin:'patient'})
});
it('reads a saved conversation that cites a record the patient added, beside one saved before 0116',()=>{
 const reply=(sources:unknown[])=>({status:'ready',answer:'Answer [1]',sources})
 const history=parseStagingChatHistory({retentionDays:30,limit:10,exchanges:[
  {id:'33333333-3333-4333-8333-333333333331',question:'What medicine do I take?',createdAt:'2026-11-04T10:00:00.000Z',reply:reply([{...added,number:1,origin:'patient'}])},
  {id:'33333333-3333-4333-8333-333333333332',question:'What did the doctor prescribe?',createdAt:'2026-10-04T10:00:00.000Z',reply:reply([source])},
 ]})
 expect(history.exchanges.map(exchange=>exchange.reply.sources[0])).toEqual([{...added,number:1,origin:'patient'},source])
});
