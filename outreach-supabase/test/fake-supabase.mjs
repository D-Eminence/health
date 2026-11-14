/**
 * A stand-in for @supabase/supabase-js used only by the local check (test/vite.check.config.ts): the tables in memory,
 * the query calls gateway.mjs makes, and email-and-password auth with "Confirm email" off. Never part of the real build.
 */
const tables = { outreach_orgs: [{ id: 'org-1', name: 'Ajegunle Health Volunteers' }],
  outreach_access: [{ org_id: 'org-1', email: 'organiser@example.test', name: 'Funke Ade', role: 'organiser' }], outreach_docs: [] }
const users = new Map()
let session = null
try { const kept = sessionStorage.getItem('fake-supabase'); if (kept) Object.assign(tables, JSON.parse(kept).tables), session = JSON.parse(kept).session, JSON.parse(kept).users.forEach(([k, v]) => users.set(k, v)) } catch { /* fresh */ }
const keep = () => { try { sessionStorage.setItem('fake-supabase', JSON.stringify({ tables, session, users: [...users] })) } catch { /* none */ } }
const delay = () => new Promise(resolve => setTimeout(resolve, 30))

class Query {
  constructor(table) { this.table = table; this.filters = []; this.mode = 'select'; this.payload = null; this.window = null; this.one = null; this.returning = false }
  select() { if (this.mode !== 'select') this.returning = true; return this }
  eq(field, value) { this.filters.push(row => row[field] === value); return this }
  order() { return this }
  range(from, to) { this.window = [from, to]; return this }
  maybeSingle() { this.one = 'maybe'; return this }
  single() { this.one = 'single'; return this }
  insert(row) { this.mode = 'insert'; this.payload = row; return this }
  update(changes) { this.mode = 'update'; this.payload = changes; return this }
  then(resolve, reject) { return this.run().then(resolve, reject) }
  async run() {
    await delay()
    const rows = tables[this.table]
    const visible = row => this.table === 'outreach_access' || !session ? true : true
    if (this.mode === 'insert') {
      const key = this.table === 'outreach_docs' ? row => `${row.org_id}|${row.kind}|${row.id}` : row => `${row.org_id}|${row.email}`
      if (rows.some(row => key(row) === key(this.payload))) return { data: null, error: { code: '23505', message: 'duplicate key' } }
      rows.push(JSON.parse(JSON.stringify(this.payload))); keep()
      return { data: null, error: null }
    }
    const matched = rows.filter(row => visible(row) && this.filters.every(filter => filter(row)))
    if (this.mode === 'update') {
      for (const row of matched) Object.assign(row, JSON.parse(JSON.stringify(this.payload)))
      keep()
      return { data: this.returning ? matched.map(row => ({ version: row.version })) : null, error: null }
    }
    let data = matched.map(row => JSON.parse(JSON.stringify(row)))
    if (this.window) data = data.slice(this.window[0], this.window[1] + 1)
    if (this.one) return { data: data[0] ?? null, error: this.one === 'single' && !data[0] ? { message: 'no row' } : null }
    return { data, error: null }
  }
}

export function createClient() {
  return {
    from: table => new Query(table),
    auth: {
      async getSession() { await delay(); return { data: { session } } },
      async signInWithPassword({ email, password }) {
        await delay()
        if (users.get(email) !== password) return { data: {}, error: { message: 'Invalid login credentials' } }
        session = { user: { id: `user-${email}`, email } }; keep()
        return { data: { session }, error: null }
      },
      async signUp({ email, password }) {
        await delay()
        if (users.has(email)) return { data: {}, error: { message: 'User already registered' } }
        users.set(email, password); session = { user: { id: `user-${email}`, email } }; keep()
        return { data: { session }, error: null }
      },
      async signOut() { session = null; keep(); return { error: null } },
    },
  }
}
