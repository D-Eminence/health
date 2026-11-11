import {render,screen} from '@testing-library/react'
import {describe,expect,it} from 'vitest'
import {RecordAnswer,cleanAssistantText} from '../RecordAnswer'

const EN='–', EM='—'

it('renders bold text and lists while escaping HTML and keeping arbitrary links inert',()=>{
 const {container}=render(<RecordAnswer text={'See **Records page**.\n\n- One\n- Two\n\n<img src=x onerror=alert(1)> [bad](javascript:alert(1))'} />)
 expect(screen.getByText('Records page').tagName).toBe('STRONG')
 expect(container.querySelectorAll('li')).toHaveLength(2)
 expect(container.querySelector('img')).toBeNull();expect(container.querySelector('a')).toBeNull()
 expect(container.textContent).toContain('<img src=x onerror=alert(1)>')
})

it('renders headings, paragraphs, bullets and numbered lists as separate elements',()=>{
 const {container}=render(<RecordAnswer text={[
  '## First diagnosis','The earliest diagnosis on record is **iron deficiency anaemia**.','It was recorded at a clinic visit.',
  '','### Details','Recorded on: 21 September 2026','- Seen at **Synthetic Clinic**','* Treated with iron tablets',
  '1. Ask for a repeat blood count','2. Book a follow-up',
 ].join('\n')} />)
 expect(screen.getByRole('heading',{level:3,name:'First diagnosis'})).toBeTruthy()
 expect(screen.getByRole('heading',{level:4,name:'Details'})).toBeTruthy()
 expect(screen.getByText('iron deficiency anaemia').tagName).toBe('STRONG')
 const paragraphs=container.querySelectorAll('p')
 expect(paragraphs).toHaveLength(2)
 expect(paragraphs[0]?.textContent).toBe('The earliest diagnosis on record is iron deficiency anaemia.\nIt was recorded at a clinic visit.')
 expect(screen.getByText('Recorded on:').tagName).toBe('STRONG')
 expect(container.querySelectorAll('ul > li')).toHaveLength(2)
 expect(container.querySelectorAll('ol > li')).toHaveLength(2)
 expect(screen.getByText('Synthetic Clinic').tagName).toBe('STRONG')
})

it('shows a list that follows a lead-in line, keeps numbering and turns a lone bold line into a heading',()=>{
 const {container}=render(<RecordAnswer text={'**Medicines**\nCurrent medicines:\n- Ferrous sulfate\n- Folic acid\n\n3. Third step\n4. Fourth step'} />)
 expect(screen.getByRole('heading',{level:4,name:'Medicines'})).toBeTruthy()
 expect(container.querySelectorAll('ul > li')).toHaveLength(2)
 expect(container.querySelector('ol')?.getAttribute('start')).toBe('3')
 expect(screen.getByText('Current medicines:').tagName).toBe('P')
})

it('never builds elements from model HTML inside headings or lists',()=>{
 const {container}=render(<RecordAnswer text={'## <script>alert(1)</script>\n- <img src=x onerror=alert(1)>\n1. <a href="javascript:alert(1)">x</a>'} />)
 expect(container.querySelector('script,img,a')).toBeNull()
 expect(container.textContent).toContain('<script>alert(1)</script>')
})

describe('dash cleanup',()=>{
 it('follows the server rules',()=>{
  expect(cleanAssistantText(`Seen 2024${EN}2025 and on days 3 ${EN} 5.`)).toBe('Seen 2024 to 2025 and on days 3 to 5.')
  expect(cleanAssistantText(`No records were found ${EM} the earliest is anaemia.`)).toBe('No records were found, the earliest is anaemia.')
  expect(cleanAssistantText(`A well${EN}known${EM}word`)).toBe('A well-known-word')
  expect(cleanAssistantText(`${EM} first point\n${EN} second point`)).toBe('- first point\n- second point')
 })
 it('removes every en and em dash from rendered answers, including old saved ones',()=>{
  const {container}=render(<RecordAnswer text={`## Summary ${EM} first diagnosis\nRecorded 2025${EN}2026 ${EM} see notes.\n${EM} Item`} />)
  expect(container.textContent).not.toMatch(/[‒-―−]/)
  expect(screen.getByRole('heading',{name:'Summary, first diagnosis'})).toBeTruthy()
  expect(screen.getByText('Recorded 2025 to 2026, see notes.')).toBeTruthy()
  expect(container.querySelectorAll('li')).toHaveLength(1)
 })
})
