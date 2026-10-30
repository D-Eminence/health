import { Icon } from '../../components/ui'

export type CheckoutStepId = 'information' | 'delivery' | 'payment' | 'confirmation'

const STEPS: { id: CheckoutStepId; label: string; num: number }[] = [
  { id: 'information', label: 'Information', num: 1 },
  { id: 'delivery', label: 'Delivery', num: 2 },
  { id: 'payment', label: 'Payment', num: 3 },
  { id: 'confirmation', label: 'Confirmation', num: 4 },
]

export function CheckoutSteps({ current }: { current: CheckoutStepId }) {
  const currentIdx = STEPS.findIndex((s) => s.id === current)
  return (
    <ol className="koro-checkout-steps" aria-label="Checkout progress">
      {STEPS.map((s, i) => {
        const state = i < currentIdx ? 'done' : i === currentIdx ? 'active' : ''
        return (
          <li
            key={s.id}
            className={
              state === 'active' ? 'koro-step koro-step--active' : state === 'done' ? 'koro-step koro-step--done' : 'koro-step'
            }
            aria-current={i === currentIdx ? 'step' : undefined}
          >
            <span className="num">{state === 'done' ? <Icon name="check" /> : s.num}</span>
            <span className="label">{s.label}</span>
          </li>
        )
      })}
    </ol>
  )
}
