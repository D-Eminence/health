import type { SVGProps } from 'react'

export type IconName = 'arrow' | 'bag' | 'bank' | 'bolt' | 'box' | 'calendar' | 'cart' | 'chat' | 'check' | 'chevron' | 'clock' | 'close' | 'coin' | 'credit' | 'download' | 'error' | 'info' | 'lock' | 'menu' | 'minus' | 'moon' | 'pending' | 'plus' | 'refresh' | 'search' | 'shield' | 'star' | 'success' | 'sun' | 'trash' | 'trend' | 'truck' | 'user' | 'warning'

const paths: Record<IconName, string> = {
  arrow: 'M5 12h14m-5-5 5 5-5 5',
  bag: 'M6 8h12l1 12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1L6 8Zm3 0V7a3 3 0 0 1 6 0v1',
  bank: 'M3 21h18M4 18h16M4 10h16M6 6h12M3 10l9-7 9 7M6 18v-4M10 18v-4M14 18v-4M18 18v-4',
  bolt: 'M13 2 3 14h9l-1 8 10-12h-9l1-8Z',
  box: 'M3.5 8 12 4l8.5 4v8L12 20l-8.5-4V8ZM3.5 8 12 12m0 0 8.5-4M12 12v8',
  calendar: 'M7 3v3m10-3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v14H4V6a1 1 0 0 1 1-1z',
  cart: 'M3 3h2l2.4 12.2a1.5 1.5 0 0 0 1.5 1.3h8.6a1.5 1.5 0 0 0 1.4-1.1L21 8H6M9.5 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2Zm8 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z',
  chat: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z',
  check: 'm5 12 4 4L19 6',
  chevron: 'm9 18 6-6-6-6',
  clock: 'M12 7v5l3 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z',
  close: 'M6 6l12 12M18 6 6 18',
  coin: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18ZM12 7v10M9.5 9.5h4a1.5 1.5 0 0 1 0 3h-4a1.5 1.5 0 0 0 0 3h4',
  credit: 'M2 7a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7Zm0 0h20M6 14h4',
  download: 'M12 3v11m0 0 4-4m-4 4-4-4M5 14v5h14v-5',
  error: 'M15 9 9 15m0-6 6 6M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z',
  info: 'M12 11v6m0-10h.01M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z',
  lock: 'M5 11h14v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8ZM7 11V7a5 5 0 0 1 10 0v4',
  menu: 'M4 7h16M4 12h16M4 17h16',
  minus: 'M5 12h14',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z',
  pending: 'M8 3h8M8 21h8M9 3c0 4 1 6 3 9-2 3-3 5-3 9m6-18c0 4-1 6-3 9 2 3 3 5 3 9',
  plus: 'M12 5v14M5 12h14',
  refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',
  search: 'm20 20-4.2-4.2M10.7 18a7.3 7.3 0 1 1 0-14.6 7.3 7.3 0 0 1 0 14.6z',
  shield: 'M12 3l7 3v6c0 4.4-3 7.4-7 9-4-1.6-7-4.6-7-9V6l7-3Z',
  star: 'm12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8L3.5 9.7l5.9-.8L12 3.5Z',
  success: 'm8.5 12 2.2 2.2 4.8-5M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z',
  sun: 'M12 3v2M12 19v2M5.6 5.6 7 7M17 17l1.4 1.4M3 12h2M19 12h2M5.6 18.4 7 17M17 7l1.4-1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  trash: 'M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m3 0v12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V7M10 11v6M14 11v6',
  trend: 'm4 16 5-5 4 4 7-8M15 7h5v5',
  truck: 'M3 7h11v9H3zM14 10h4l3 3v3h-7M7 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm10 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z',
  user: 'M12 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm-7 9a7 7 0 0 1 14 0',
  warning: 'M12 8v5m0 4h.01M12 3 2 7 7 10H3L10 3h2z',
}

export function Icon({ name, ...props }: { name: IconName } & SVGProps<SVGSVGElement>) {
  return <svg className="ui-icon" aria-hidden="true" viewBox="0 0 24 24" {...props}><path d={paths[name]} /></svg>
}
