import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { BarBreakdown, Button, Checkbox, Dialog, DonutChart, InputField, LineChart, Tabs } from '.'

describe('design-system primitives', () => {
  it('exposes button variants and prevents repeat submission while loading', () => {
    render(<Button variant="accent" loading>Save changes</Button>)
    const button = screen.getByRole('button', { name: 'Save changes' })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
    expect(button).toHaveClass('ui-button--accent')
  })

  it('connects field errors to the input', () => {
    render(<InputField label="Email" error="Enter a valid email" />)
    const input = screen.getByRole('textbox', { name: 'Email' })
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAccessibleDescription('Enter a valid email')
  })

  it('uses one controlled checkbox state', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Checkbox label="Light mode" checked onChange={onChange} />)
    const checkbox = screen.getByRole('checkbox', { name: 'Light mode' })
    expect(checkbox).toHaveAttribute('aria-checked', 'true')
    await user.click(checkbox)
    expect(onChange).toHaveBeenCalledWith(false)
  })

  it('changes tabs with controlled state', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Tabs value="general" onChange={onChange} items={[{ id: 'general', label: 'General' }, { id: 'team', label: 'Team' }]} />)
    expect(screen.getByRole('tab', { name: 'General' })).toHaveAttribute('aria-selected', 'true')
    await user.click(screen.getByRole('tab', { name: 'Team' }))
    expect(onChange).toHaveBeenCalledWith('team')
  })

  it('labels analytics and closes dialogs with Escape', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<><LineChart title="Orders chart" labels={['A', 'B']} max={10} series={[{ label: 'Orders', tone: 'orders', values: [2, 8] }]} /><Dialog open title="Confirm action" onClose={onClose}>Details</Dialog></>)
    expect(screen.getByRole('group', { name: 'Orders chart' })).toBeInTheDocument()
    await user.hover(screen.getByRole('button', { name: 'A. Orders: 2' }))
    expect(screen.getByRole('tooltip')).toHaveTextContent('Orders2')
    expect(screen.getByRole('dialog', { name: 'Confirm action' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('reveals exact pie and brokerage values on interaction', async () => {
    const user = userEvent.setup()
    render(<><DonutChart title="Order status" values={[{ label: 'Successful', value: 85.5, display: '1.10M (85.5%)', tone: 'success' }, { label: 'Failed', value: 14.5, display: '186K (14.5%)', tone: 'failed' }]} /><BarBreakdown total="$284.6M" items={[{ label: 'Buying power', value: '$91,412,210', percent: 32.1 }]} /></>)
    const success = screen.getByRole('button', { name: 'Successful: 1.10M (85.5%)' })
    await user.hover(success)
    expect(screen.getByRole('tooltip')).toHaveTextContent('Successful1.10M (85.5%)')
    await user.unhover(success)
    await user.hover(screen.getByText('Buying power').closest<HTMLElement>('.ui-bar')!)
    expect(screen.getByRole('tooltip')).toHaveTextContent('Buying power$91,412,210 · 32.1%')
  })
})
