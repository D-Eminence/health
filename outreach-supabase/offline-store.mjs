/**
 * What this phone last read, kept so Outreach opens and works with no signal (owner, 14 Nov 2026: 100% offline):
 * the signed-in person's organisation and its records, in IndexedDB. Cleared on sign-out.
 */
const DB = 'hid-outreach-supabase-kept'
const STORE = 'kept'

function open() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function run(mode, work) {
  const db = await open()
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode)
      const request = work(tx.objectStore(STORE))
      tx.oncomplete = () => resolve(request?.result)
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  } finally { db.close() }
}

export async function keep(key, value) { try { await run('readwrite', store => store.put(value, key)) } catch { /* this phone keeps nothing */ } }
export async function read(key) { try { return (await run('readonly', store => store.get(key))) ?? null } catch { return null } }
export async function forget() { try { await run('readwrite', store => store.clear()) } catch { /* nothing kept */ } }
