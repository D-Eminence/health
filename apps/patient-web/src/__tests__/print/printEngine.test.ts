import { describe, expect, it } from 'vitest'
import { printsAddressAnyway } from '../../print/printEngine'

/*
 * Which browsers print their own web address round a page whatever the page asks: WebKit (Safari, and every browser on
 * an iPhone or iPad). Chrome, Edge and Firefox leave it off a page with no margin.
 */

const AGENTS = {
  chrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
  edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0',
  chromeMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
  chromeAndroid: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36',
  samsung: 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/27.0 Chrome/125.0.0.0 Mobile Safari/537.36',
  firefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:145.0) Gecko/20100101 Firefox/145.0',
  firefoxMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:145.0) Gecko/20100101 Firefox/145.0',
  safariMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Safari/605.1.15',
  safariIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Mobile/15E148 Safari/604.1',
  chromeIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/142.0.0.0 Mobile/15E148 Safari/604.1',
  firefoxIpad: 'Mozilla/5.0 (iPad; CPU OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/145.0 Mobile/15E148 Safari/605.1.15',
  jsdom: 'Mozilla/5.0 (linux) AppleWebKit/537.36 (KHTML, like Gecko) jsdom/27.0.0',
}

describe('which browsers print their own address anyway', () => {
  it('not Chrome, Edge, other Chromium browsers or Firefox: no page margin keeps their header and footer off', () => {
    for (const agent of [AGENTS.chrome, AGENTS.edge, AGENTS.chromeMac, AGENTS.chromeAndroid, AGENTS.samsung, AGENTS.firefox, AGENTS.firefoxMac]) {
      expect(printsAddressAnyway({ userAgent: agent }), agent).toBe(false)
    }
  })

  it('Safari on a Mac, and every browser on an iPhone or iPad (all WebKit)', () => {
    for (const agent of [AGENTS.safariMac, AGENTS.safariIphone, AGENTS.chromeIphone, AGENTS.firefoxIpad]) {
      expect(printsAddressAnyway({ userAgent: agent }), agent).toBe(true)
    }
  })

  it('an iPad asking for the desktop site, which names itself a Mac that can be touched', () => {
    expect(printsAddressAnyway({ userAgent: AGENTS.safariMac, maxTouchPoints: 5 })).toBe(true)
    expect(printsAddressAnyway({ userAgent: AGENTS.chromeMac, maxTouchPoints: 5 })).toBe(false)
  })

  it('anything else prints the page itself', () => {
    expect(printsAddressAnyway({ userAgent: AGENTS.jsdom })).toBe(false)
    expect(printsAddressAnyway({ userAgent: '' })).toBe(false)
    expect(printsAddressAnyway(undefined)).toBe(false)
  })
})
