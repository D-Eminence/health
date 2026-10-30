import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { isHidApiError } from '@hid/http'
import { useSession } from '../session'
import { usePatientResource } from './usePatientResource'
import { useActionFocus } from './actionFocus'
import { learnWebPushServed, useWebPushServed } from '../webPushServed'
import { withSubscribed, withoutSubscription, type WebPushState } from '../webPush'
import { isAppleBrowserTab, runningInstalled } from '../deviceKind'
import { promptInstall, useInstallPrompt } from '../installPrompt'
import type * as PushDeviceModule from '../pushDevice'
import type { BrowserPushSubscription, PushSupport } from '../pushDevice'

/*
 * The Notifications page's two device sections (contract b6-contract.md §11.4-11.5): "Notifications on this device", payload-free Web
 * Push to this phone or computer (hid-system 0097), and "Install the Health ID app". The push section is hidden
 * entirely, saying nothing, until Identity's GET identity/me/web-push answers 200: a backend before 0097, or one whose
 * push keys are not configured, answers 404. The browser's push APIs live in ../pushDevice, loaded only then.
 */

type PushDevice = typeof PushDeviceModule

/** Loaded on demand: a page that never offers push never loads the module that can register a worker. */
const loadDevice = (): Promise<PushDevice> => import('../pushDevice')

interface DeviceReading {
  readonly support: PushSupport
  readonly permission: NotificationPermission
  readonly subscription: BrowserPushSubscription | null
}

type SectionState = 'unsupported' | 'ios-install-needed' | 'denied' | 'on' | 'off'

async function readDevice(device: PushDevice): Promise<DeviceReading> {
  const support = device.support()
  if (support !== 'supported') return { support, permission: 'default', subscription: null }
  return { support, permission: device.permission(), subscription: await device.browserSubscription() }
}

/** The section's state, in the contract's order: the first that applies. */
function stateOf(server: WebPushState, device: DeviceReading): SectionState {
  if (device.support === 'unsupported') return 'unsupported'
  if (device.support === 'ios-install-needed') return 'ios-install-needed'
  if (device.permission === 'denied') return 'denied'
  const digest = device.subscription?.endpointDigest
  const match = digest === undefined ? undefined : server.subscriptions.find(item => item.endpointDigest === digest)
  return match?.thisSignIn && match.keyCurrent ? 'on' : 'off'
}

const WHAT_IT_SAYS = 'It only says "You have a new notification."'

function stateText(state: SectionState): string {
  switch (state) {
    case 'unsupported': return 'This browser can\'t show Health ID notifications.'
    case 'ios-install-needed': return 'On iPhone or iPad, first add Health ID to your Home Screen (tap Share, then Add to Home Screen). Then turn this on there.'
    case 'denied': return `Notifications are blocked. To allow them, open this browser's settings for ${location.host}.`
    case 'on': return `On. You get an alert here for each new notification. ${WHAT_IT_SAYS}`
    case 'off': return `Get an alert here for each new notification. ${WHAT_IT_SAYS}`
  }
}

const TURNED_ON = 'Notifications are on for this device.'
const NOT_TURNED_ON = 'Notifications were not turned on.'
const TURN_ON_FAILED = 'Couldn’t turn on notifications. Try again.'
const TURN_OFF_FAILED = 'Couldn’t turn off notifications. Try again.'
const TURNED_OFF = 'Notifications are off for this device.'
const TURNED_OFF_LATE = TURNED_OFF

type TurnOnOutcome = 'on' | 'denied' | 'dismissed'

/**
 * "Notifications on this device" (contract §11.4). The switch asks for the browser's permission only when the patient
 * turns it on (a permission another app left on this host is not consent, so the switch still starts off), subscribes
 * this browser, and hands the subscription to Identity, which keeps it for this sign-in only.
 */
export function DeviceNotificationsCard() {
  const { api } = useSession()
  const load = useCallback((signal?: AbortSignal) => api.webPush(signal).then(value => {
    learnWebPushServed(true)
    return value
  }, (caught: unknown) => {
    if (isHidApiError(caught) && caught.status === 404) { learnWebPushServed(false); return null }
    throw caught
  }), [api])
  // Kept for the account under its own name: `load` is made again each time the card is.
  const server = usePatientResource<WebPushState | null>(load, 'web-push')
  const served = useWebPushServed()
  const [reading, setReading] = useState<DeviceReading | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const control = useRef<HTMLButtonElement>(null)
  const rekeyed = useRef(false)
  const working = useRef(false)
  const focusAfter = useActionFocus()
  const data = server.data
  const { replace } = server
  const offered = served === true && data !== null

  // This browser's side, read once Identity offers push, and again when the patient comes back to the page (after
  // allowing notifications in the browser's site settings, for one).
  useEffect(() => {
    if (!offered) return
    let current = true
    const read = () => {
      if (working.current) return
      void loadDevice().then(readDevice).then(value => { if (current && !working.current) setReading(value) }, () => { /* stays as it was */ })
    }
    read()
    const visible = () => { if (document.visibilityState === 'visible') read() }
    document.addEventListener('visibilitychange', visible)
    return () => { current = false; document.removeEventListener('visibilitychange', visible) }
  }, [offered])

  /** Subscribes this browser and saves it with Identity; a key changed meanwhile (409) is read again, once. */
  const subscribe = useCallback(async (start: WebPushState): Promise<TurnOnOutcome> => {
    const device = await loadDevice()
    let state = start
    let createdHere = false
    try {
      for (let attempt = 0; ; attempt += 1) {
        const result = await device.turnOn({ applicationServerKey: state.applicationServerKey, keyId: state.keyId })
        if (result.outcome !== 'subscribed') return result.outcome
        createdHere ||= result.created
        try {
          const saved = await api.saveWebPushSubscription({ ...result.subscription, keyId: result.keyId })
          replace(withSubscribed(state, saved, new Date().toISOString()))
          return 'on'
        } catch (cause) {
          if (attempt > 0 || !isHidApiError(cause) || cause.code !== 'WEB_PUSH_KEY_CHANGED') throw cause
          state = await api.webPush()
          replace(state)
        }
      }
    } catch (cause) {
      if (createdHere) await device.turnOffBrowser()
      throw cause
    }
  }, [api, replace])

  // The key was rotated since this sign-in subscribed: move it to the new key without asking (the same patient, the
  // same sign-in, permission already given). The old row goes by the one-per-sign-in rule.
  useEffect(() => {
    if (!data || !reading || rekeyed.current || working.current) return
    const { subscription } = reading
    if (reading.support !== 'supported' || reading.permission !== 'granted' || !subscription) return
    const match = data.subscriptions.find(item => item.endpointDigest === subscription.endpointDigest)
    if (!match?.thisSignIn || match.keyCurrent) return
    rekeyed.current = true
    working.current = true
    void subscribe(data).catch(() => 'failed' as const).then(async () => {
      try { setReading(await readDevice(await loadDevice())) } catch { /* stays as it was */ }
    }).finally(() => { working.current = false })
  }, [data, reading, subscribe])

  if (served !== true || data === null || reading === null) return null
  const state = stateOf(data, reading)
  const on = state === 'on'
  const withSwitch = state === 'denied' || state === 'on' || state === 'off'

  const toggle = async () => {
    if (busy || working.current) return
    working.current = true
    setBusy(true); setError(null); setNotice(null)
    let device: PushDevice | null = null
    let outcome: DeviceReading['permission'] | null = null
    try {
      device = await loadDevice()
      if (on) {
        const current = await device.browserSubscription()
        let late = false
        if (current) {
          // Whatever Identity answers, this browser stops: Identity stops trying on its own (contract D5, D8).
          try { await api.removeWebPushSubscription(current.endpoint) } catch { late = true }
          replace(withoutSubscription(data, current.endpointDigest))
        }
        await device.turnOffBrowser()
        setNotice(late ? TURNED_OFF_LATE : TURNED_OFF)
      } else {
        const result = await subscribe(data)
        if (result === 'on') setNotice(TURNED_ON)
        else if (result === 'denied') outcome = 'denied'
        else setNotice(NOT_TURNED_ON)
      }
    } catch {
      setError(on ? TURN_OFF_FAILED : TURN_ON_FAILED)
    } finally {
      let next: DeviceReading | null = null
      try { next = device ? await readDevice(device) : null } catch { /* stays as it was */ }
      if (next) setReading(outcome === 'denied' ? { ...next, permission: 'denied' } : next)
      working.current = false
      setBusy(false)
      focusAfter(() => (control.current && !control.current.disabled ? control.current : heading.current))
    }
  }

  return <div className="patient-card" aria-labelledby="device-notifications-heading">
    <h2 ref={heading} tabIndex={-1} id="device-notifications-heading">Notifications on this device</h2>
    {error && <p role="alert" className="patient-inline-error">{error}</p>}
    <div role="status">{notice && <p className="patient-inline-success">{notice}</p>}</div>
    <p id="device-notifications-state">{stateText(state)}</p>
    {withSwitch && <>
      <button ref={control} type="button" role="switch" aria-checked={on} className="patient-switch"
        aria-labelledby="device-notifications-heading" aria-describedby="device-notifications-state device-notifications-sign-out"
        aria-busy={busy || undefined} disabled={busy || state === 'denied'} onClick={() => void toggle()}>
        <span className="patient-switch-track" aria-hidden="true"><span className="patient-switch-thumb" /></span>
        <span aria-hidden="true">{on ? 'On' : 'Off'}</span>
      </button>
      <p id="device-notifications-sign-out" className="patient-field-hint">Signing out turns this off.</p>
    </>}
  </div>
}

/**
 * "Install the Health ID app" (contract §11.5), shown only in a browser tab, never in the installed app: a button
 * where the browser has offered installing, or in an iPhone or iPad browser (not an app's built-in web view) the
 * Home Screen steps; otherwise nothing. Once the patient has chosen, the section goes, and focus goes to `afterward`.
 */
export function InstallAppCard({ afterward }: { afterward: RefObject<HTMLElement | null> }) {
  const offer = useInstallPrompt()
  const [installed] = useState(runningInstalled)
  const [apple] = useState(() => isAppleBrowserTab())
  const [busy, setBusy] = useState(false)
  const focusAfter = useActionFocus()
  if (installed || (!offer && !apple)) return null

  const install = async () => {
    if (busy) return
    setBusy(true)
    try { await promptInstall() } finally { setBusy(false); focusAfter(() => afterward.current) }
  }

  return <div className="patient-card" aria-labelledby="install-app-heading">
    <h2 id="install-app-heading">Install the Health ID app</h2>
    {offer ? <>
      <p>Open Health ID like an app on this device.</p>
      <button type="button" className="patient-secondary-button" disabled={busy} onClick={() => void install()}>Install Health ID</button>
    </> : <p>Tap the Share button, then Add to Home Screen.</p>}
  </div>
}
