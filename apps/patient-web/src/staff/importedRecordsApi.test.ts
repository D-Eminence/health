import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('./env', () => ({ getEnvironment: () => ({ name: 'local', apiBaseUrl: 'https://gateway.test' }) }))

beforeEach(() => vi.resetModules())
afterEach(() => vi.unstubAllGlobals())
describe('hospital imported-history requests', () => {
  it('uses the patient endpoint with facility and purpose headers and no encounter identifier', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ importedRecords: [], limit: 50 }), {
      headers: { 'content-type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetch)
    const { staffApi } = await import('./api')
    await staffApi.importedRecords('facility-a', '11111111-1111-4111-8111-111111111111', 'direct-care')
    const [url, options] = fetch.mock.calls[0]!
    expect(new URL(String(url)).pathname).toBe('/api/v1/ehr/patients/11111111-1111-4111-8111-111111111111/imported-records')
    const headers = new Headers(options.headers)
    expect(headers.get('X-Facility-ID')).toBe('facility-a')
    expect(headers.get('X-Purpose-Of-Use')).toBe('direct-care')
    expect(options.credentials).toBe('include')
  })
})

it('routes hospital chat history and sources through the selected patient, facility and purpose without deduplication',async()=>{
 const fetch=vi.fn().mockImplementation((url:string,_options:RequestInit)=>Promise.resolve(new Response(JSON.stringify(String(url).endsWith('/history')?
   {exchanges:[],retentionDays:30,limit:10}:{kind:'prescription',fields:{}}),{headers:{'content-type':'application/json'}})))
 vi.stubGlobal('fetch',fetch)
 const {staffApi}=await import('./api')
 const patient='11111111-1111-4111-8111-111111111111'
 await staffApi.patientChatHistory('facility-a',patient)
 await staffApi.patientChatHistory('facility-b',patient)
 await staffApi.patientChatSource('facility-a',patient,'prescription','22222222-2222-4222-8222-222222222222')
 expect(fetch).toHaveBeenCalledTimes(3)
 for(const [url,options] of fetch.mock.calls) {
  expect(new URL(String(url)).pathname).toContain('/ehr/patients/'+patient+'/chat/')
  const headers=new Headers(options.headers)
  expect(headers.get('X-Purpose-Of-Use')).toBe('direct-care');expect(options.credentials).toBe('include')
 }
 expect(new Headers(fetch.mock.calls[1]![1].headers).get('X-Facility-ID')).toBe('facility-b')
})
