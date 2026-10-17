import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { StagingStaffPatientChat as StaffPatientChat } from '../StagingStaffPatientChat'
import { HidApiError } from '@hid/http'
const api=vi.hoisted(()=>({patientChat:vi.fn(),patientChatHistory:vi.fn(),clearPatientChatHistory:vi.fn(),patientChatSource:vi.fn()}))
vi.mock('../../api',()=>({staffApi:api}))
const empty={exchanges:[],retentionDays:30,limit:10}
const props={facilityId:'facility-a',facilityName:'Synthetic hospital',patientId:'patient-a',patientName:'Synthetic A',hid:'HID-AAAAAA'}
beforeEach(()=>{vi.resetAllMocks();api.patientChatHistory.mockResolvedValue(empty);api.clearPatientChatHistory.mockResolvedValue({cleared:true})})
const open=()=>fireEvent.click(screen.getByRole('button',{name:'Ask about this patient'}))
describe('embedded hospital patient chat',()=>{
  it('opens within the selected patient context without needing an encounter and restores the staff history',async()=>{
    api.patientChatHistory.mockResolvedValue({...empty,exchanges:[{id:'saved',question:'Saved A question',reply:{status:'ready',answer:'Saved A answer',sources:[]}}]})
    render(<StaffPatientChat {...props} />);expect(api.patientChatHistory).not.toHaveBeenCalled();open()
    expect(await screen.findByText('Saved A answer')).toBeTruthy()
    expect(screen.getByText(/Synthetic A · HID-AAAAAA · Synthetic hospital/)).toBeTruthy()
    expect(api.patientChatHistory).toHaveBeenCalledWith('facility-a','patient-a',expect.any(AbortSignal))
  })
  it('aborts and discards a late history response when the staff/patient/facility scope is replaced',async()=>{
    let finish!:(value:unknown)=>void
    api.patientChatHistory.mockImplementation((_f,patient)=>patient==='patient-a'?new Promise(resolve=>{finish=resolve}):Promise.resolve(empty))
    const view=render(<StaffPatientChat key="a" {...props} />);open()
    await waitFor(()=>expect(finish).toBeTypeOf('function'))
    const signal=api.patientChatHistory.mock.calls[0]![2] as AbortSignal
    view.rerender(<StaffPatientChat key="b" {...props} facilityId="facility-b" patientId="patient-b" patientName="Synthetic B" />);open()
    await screen.findByText('Review this patient’s records');expect(signal.aborted).toBe(true)
    await act(async()=>finish({...empty,exchanges:[{id:'old',question:'Private A question',reply:{status:'ready',answer:'Private A answer',sources:[]}}]}))
    expect(screen.queryByText('Private A answer')).toBeNull()
  })
  it('cancels a pending answer when changing patient and cannot render that answer in the next patient',async()=>{
    let finish!:(value:unknown)=>void
    api.patientChat.mockImplementation(()=>new Promise(resolve=>{finish=resolve}))
    const view=render(<StaffPatientChat key="a" {...props} />);open()
    const input=await screen.findByLabelText('Your question')
    await waitFor(()=>expect(screen.queryByText('Loading your saved conversation…')).toBeNull())
    fireEvent.change(input,{target:{value:'Summarize A records'}});fireEvent.click(screen.getByRole('button',{name:'Send question'}))
    await waitFor(()=>expect(finish).toBeTypeOf('function'))
    const signal=api.patientChat.mock.calls[0]![3] as AbortSignal
    view.rerender(<StaffPatientChat key="b" {...props} patientId="patient-b" patientName="Synthetic B" />);open()
    await act(async()=>finish({status:'ready',answer:'Only patient A answer',sources:[]}))
    expect(signal.aborted).toBe(true);expect(screen.queryByText('Only patient A answer')).toBeNull()
    expect(screen.queryByText('Summarize A records')).toBeNull()
  })
  it('clears only the selected staff patient conversation and recovers from a history load failure',async()=>{
    api.patientChatHistory.mockRejectedValue(new Error('temporary'))
    render(<StaffPatientChat {...props} />);open()
    await screen.findByRole('button',{name:'Retry loading conversation'})
    fireEvent.click(screen.getByRole('button',{name:'New conversation'}))
    await waitFor(()=>expect(api.clearPatientChatHistory).toHaveBeenCalledWith('facility-a','patient-a',expect.any(AbortSignal)))
    await waitFor(()=>expect(screen.queryByRole('button',{name:'Retry loading conversation'})).toBeNull())
  })
  it('removes visible messages when a subsequent request discovers consent was revoked',async()=>{
    api.patientChatHistory.mockResolvedValue({...empty,exchanges:[{id:'saved',question:'Saved question',reply:{status:'ready',answer:'Previously authorized answer',sources:[]}}]})
    api.patientChat.mockRejectedValue(new HidApiError(403,'Access ended'))
    render(<StaffPatientChat {...props} />);open()
    await screen.findByText('Previously authorized answer')
    fireEvent.change(screen.getByLabelText('Your question'),{target:{value:'Follow up'}})
    fireEvent.click(screen.getByRole('button',{name:'Send question'}))
    await screen.findByText('Patient access has ended or changed. Reopen the patient through governed access.')
    expect(screen.queryByText('Previously authorized answer')).toBeNull()
  })
})
