export default {
  fetch(request) {
    const incoming = new URL(request.url)
    if (incoming.hostname !== 'www.healthidentitydirectory.com') {
      return new Response('Misdirected request', { status: 421 })
    }
    const target = new URL('https://healthidentitydirectory.com')
    target.pathname = incoming.pathname
    target.search = incoming.search
    return new Response(null, { status: 308, headers: {
      location: target.toString(),
      'cache-control': 'public, max-age=300',
      'referrer-policy': 'strict-origin-when-cross-origin',
      'x-content-type-options': 'nosniff',
    } })
  },
}
