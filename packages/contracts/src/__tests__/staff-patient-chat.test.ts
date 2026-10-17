import { describe,expect,it } from 'vitest'
import { assertEndpointAllowed } from '../boundaries'
const endpoints=['ehr.staffPatientChatAvailability','ehr.staffPatientChat','ehr.staffPatientChatHistory','ehr.staffPatientChatSource']
describe('hospital chat route boundaries',()=>{
  it.each(endpoints)('permits %s only in provider patient contexts',endpoint=>{
    for(const app of ['staff-web','ehr-web'] as const)expect(()=>assertEndpointAllowed(app,endpoint)).not.toThrow()
    for(const app of ['patient-web','public-web','admin-web','lab-web','pharmacy-web','ocr-web','outreach-web'] as const)
      expect(()=>assertEndpointAllowed(app,endpoint)).toThrow()
  })
  it('continues to deny patient-self chat routes to hospital contexts',()=>{
    for(const endpoint of ['ehr.patientChat','ehr.patientChatHistory','ehr.patientChatSource'])
      expect(()=>assertEndpointAllowed('staff-web',endpoint)).toThrow()
  })
})
