import {render,screen} from '@testing-library/react'
import {expect,it} from 'vitest'
import {RecordAnswer} from '../RecordAnswer'
it('renders bold text and lists while escaping HTML and keeping arbitrary links inert',()=>{
 const {container}=render(<RecordAnswer text={'See **Records page**.\n\n- One\n- Two\n\n<img src=x onerror=alert(1)> [bad](javascript:alert(1))'} />)
 expect(screen.getByText('Records page').tagName).toBe('STRONG')
 expect(container.querySelectorAll('li')).toHaveLength(2)
 expect(container.querySelector('img')).toBeNull();expect(container.querySelector('a')).toBeNull()
 expect(container.textContent).toContain('<img')
});
