import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../supabase.js'
import { BRAND } from '../brand.js'

// Build the client-facing link in the chosen language. English is the bare
// link; Spanish carries ?lang=es, which the review page reads to localize.
const clientLink = (token, lang) =>
  `${window.location.origin}/r/${token}${lang === 'es' ? '?lang=es' : ''}`

const label = (s) => (s === 'approved' ? 'Approved' : s === 'changes' ? 'Changes requested' : 'Pending')
const guessName = (key) => key.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).trim()
function toast(msg) {
  let t = document.getElementById('bms-toast')
  if (!t) { t = document.createElement('div'); t.id = 'bms-toast'; t.className = 'toast'; document.body.appendChild(t) }
  t.textContent = msg; t.classList.add('show')
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2000)
}
// Group reviews by client entity (client_id), preserving the incoming
// (newest-first) order so the most recently active clients surface first.
function groupByClient(reviews, clients) {
  const nameById = new Map((clients || []).map((c) => [c.id, c.name]))
  const groups = []
  const idx = new Map()
  reviews.forEach((r) => {
    const key = r.client_id || 'none'
    if (!idx.has(key)) {
      idx.set(key, groups.length)
      groups.push({
        id: r.client_id || null,
        client: r.client_id ? (nameById.get(r.client_id) || r.client_name || 'Client') : 'Unassigned',
        items: [],
      })
    }
    groups[idx.get(key)].items.push(r)
  })
  return groups
}

export default function Admin() {
  const [session, setSession] = useState(undefined) // undefined = still loading

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  if (session === undefined) return <div className="center-msg">Loading…</div>
  if (!session) return <Login />
  return <Dashboard session={session} />
}

function Login() {
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  async function go() {
    setBusy(true); setErr('')
    const { error } = await supabase.auth.signInWithPassword({ email, password: pw })
    if (error) setErr(error.message)
    setBusy(false)
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-brand">
          {BRAND.logoDarkUrl ? <img src={BRAND.logoDarkUrl} alt={BRAND.name} className="logo-img" /> : <b>{BRAND.name}</b>}
          <span className="muted">{BRAND.product}</span>
        </div>
        <h1>Agency sign in</h1>
        <input className="inp" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input className="inp" type="password" placeholder="Password" value={pw} onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && go()} />
        {err && <div className="err">{err}</div>}
        <button className="btn brand full" disabled={busy} onClick={go}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <p className="muted sm">Add team members in your Supabase dashboard → Authentication → Users.</p>
      </div>
    </div>
  )
}

function Dashboard({ session }) {
  const [reviews, setReviews] = useState(null)
  const [clients, setClients] = useState([])
  const [view, setView] = useState({ name: 'list' })

  const load = useCallback(async () => {
    const [{ data: revs }, { data: cls }] = await Promise.all([
      supabase.from('reviews').select('*').order('created_at', { ascending: false }),
      supabase.from('clients').select('id,name').order('name'),
    ])
    setReviews(revs || [])
    setClients(cls || [])
  }, [])
  useEffect(() => { load() }, [load])

  return (
    <div className="adm">
      <header className="adm-bar">
        <div className="adm-brand">
          {BRAND.logoUrl ? <img src={BRAND.logoUrl} className="logo-img" alt="" /> : <b>{BRAND.name}</b>}
          <span className="sep">/</span><span>{BRAND.product}</span>
        </div>
        <div className="adm-r">
          <span className="muted sm">{session.user.email}</span>
          <button className="lnk" onClick={() => supabase.auth.signOut()}>Sign out</button>
        </div>
      </header>
      <main className="adm-main">
        {view.name === 'list' && (
          <ReviewList reviews={reviews} clients={clients} onNew={() => setView({ name: 'new' })} onOpen={(r) => setView({ name: 'feedback', review: r })} reload={load} />
        )}
        {view.name === 'new' && (
          <NewReview clients={clients} onDone={() => { setView({ name: 'list' }); load() }} onCancel={() => setView({ name: 'list' })} />
        )}
        {view.name === 'feedback' && (
          <Feedback review={view.review} back={() => { setView({ name: 'list' }); load() }} />
        )}
      </main>
    </div>
  )
}

function ReviewList({ reviews, clients, onNew, onOpen, reload }) {
  async function copy(r, lang) {
    try {
      await navigator.clipboard.writeText(clientLink(r.share_token, lang))
      toast(lang === 'es' ? 'Spanish client link copied' : 'English client link copied')
    } catch { toast('Copy failed') }
  }
  async function del(r) {
    if (!confirm('Delete this review and all of its feedback? This cannot be undone.')) return
    await supabase.from('reviews').delete().eq('id', r.id)
    reload()
  }
  async function rename(g) {
    const next = window.prompt(`Rename client “${g.client}” — this updates it on all ${g.items.length} of their reviews.`, g.client)
    if (next == null) return
    const t = next.trim()
    if (!t || t === g.client) return
    const { error } = await supabase.rpc('rpc_rename_client', { p_client_id: g.id, p_name: t })
    if (error) { toast(error.message || 'Rename failed') } else { toast('Client renamed'); reload() }
  }

  if (reviews === null) return <div className="center-msg">Loading…</div>
  const groups = groupByClient(reviews, clients)
  return (
    <>
      <div className="adm-head"><h1>Reviews</h1><button className="btn brand" onClick={onNew}>+ New review</button></div>
      {reviews.length === 0 && <div className="empty-card">No reviews yet. Create one and send the link to your client.</div>}
      {groups.map((g) => (
        <section className="cgroup" key={g.id || 'unassigned'}>
          <div className="cgroup-h">
            <h2>{g.client}</h2>
            <span className="cgroup-count">{g.items.length} review{g.items.length > 1 ? 's' : ''}</span>
            {g.id && <button className="cgroup-edit" title="Rename client" onClick={() => rename(g)}>Rename</button>}
          </div>
          <div className="cards">
            {g.items.map((r) => (
              <div className="rcard" key={r.id}>
                <div className="rcard-main" onClick={() => onOpen(r)}>
                  <b>{r.title} {r.status === 'completed' && <span className="badge approved">Completed</span>}</b>
                  <div className="muted sm">{new Date(r.created_at).toLocaleDateString()}</div>
                </div>
                <div className="rcard-act">
                  <span className="copy-split">
                    <span className="copy-split-label">Copy link</span>
                    <button className="btn lite" onClick={() => copy(r, 'en')} title="Copy English client link">EN</button>
                    <button className="btn lite" onClick={() => copy(r, 'es')} title="Copy Spanish client link">ES</button>
                  </span>
                  <button className="btn lite" onClick={() => onOpen(r)}>View feedback</button>
                  <button className="icon-del" title="Delete" onClick={() => del(r)}>✕</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </>
  )
}

function NewReview({ clients = [], onDone, onCancel }) {
  const [title, setTitle] = useState('')
  const [clientSel, setClientSel] = useState('')   // '' = none · a client id · '__new__'
  const [newClient, setNewClient] = useState('')
  const [html, setHtml] = useState('')
  const [sections, setSections] = useState([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  function parse(htmlStr) {
    try {
      const doc = new DOMParser().parseFromString(htmlStr, 'text/html')
      const els = [...doc.querySelectorAll('section[id], [data-review-section]')]
      const seen = new Set()
      const out = []
      els.forEach((el) => {
        const key = el.id || el.getAttribute('data-review-section')
        if (!key || seen.has(key)) return
        seen.add(key)
        out.push({ section_key: key, name: guessName(key), blurb: '' })
      })
      return out
    } catch { return [] }
  }
  function onFile(e) {
    const f = e.target.files[0]
    if (!f) return
    const fr = new FileReader()
    fr.onload = () => { setHtml(fr.result); setSections(parse(fr.result)) }
    fr.readAsText(f)
  }
  function onHtmlChange(v) { setHtml(v); if (v.length > 200) setSections(parse(v)) }
  const upd = (i, k, val) => setSections((s) => s.map((x, j) => (j === i ? { ...x, [k]: val } : x)))
  const add = () => setSections((s) => [...s, { section_key: '', name: '', blurb: '' }])
  const rm = (i) => setSections((s) => s.filter((_, j) => j !== i))

  async function save() {
    setErr('')
    if (!title.trim()) { setErr('Add a review title.'); return }
    const valid = sections.filter((s) => s.section_key.trim() && s.name.trim())
    if (valid.length === 0) { setErr('Add at least one section (a key and a name).'); return }
    // Resolve the chosen client to a real entity.
    let clientId = null
    let clientName = null
    if (clientSel === '__new__') {
      const cname = newClient.trim()
      if (!cname) { setErr('Enter the new client’s name, or choose “No client”.'); return }
      const dupe = clients.find((c) => c.name.toLowerCase() === cname.toLowerCase())
      if (dupe) { setErr(`“${dupe.name}” already exists — pick it from the list instead.`); return }
      setBusy(true)
      const { data: nc, error: ce } = await supabase.from('clients').insert({ name: cname }).select('id,name').single()
      if (ce) { setErr(ce.message); setBusy(false); return }
      clientId = nc.id; clientName = nc.name
    } else if (clientSel) {
      const picked = clients.find((c) => c.id === clientSel)
      clientId = picked ? picked.id : null
      clientName = picked ? picked.name : null
      setBusy(true)
    } else {
      setBusy(true)
    }
    const { data: rev, error } = await supabase
      .from('reviews')
      .insert({ title: title.trim(), client_id: clientId, client_name: clientName, page_html: html || null })
      .select().single()
    if (error) { setErr(error.message); setBusy(false); return }
    const rows = valid.map((s, i) => ({
      review_id: rev.id, section_key: s.section_key.trim(), name: s.name.trim(),
      blurb: s.blurb.trim() || null, sort_order: i
    }))
    const { error: e2 } = await supabase.from('review_sections').insert(rows)
    setBusy(false)
    if (e2) { setErr(e2.message); return }
    onDone()
  }

  return (
    <div className="form-wrap">
      <button className="back" onClick={onCancel}>‹ Back</button>
      <h1>New review</h1>
      <div className="grid2">
        <label className="fld"><span>Review title</span>
          <input className="inp" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Dental Tourism Landing Page" /></label>
        <div className="fld"><span>Client</span>
          <select className="inp select" value={clientSel} onChange={(e) => setClientSel(e.target.value)}>
            <option value="">No client</option>
            {clients.length > 0 && (
              <optgroup label="Existing clients">
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </optgroup>
            )}
            <option value="__new__">+ Add a new client…</option>
          </select>
          {clientSel === '__new__' && (
            <input className="inp" style={{ marginTop: 8 }} value={newClient} autoFocus
              onChange={(e) => setNewClient(e.target.value)} placeholder="New client name, e.g. Let's Smile Dentistry" />
          )}
          <span className="fld-hint">Groups this review with the client’s other reviews.</span>
        </div>
      </div>
      <label className="fld"><span>Page HTML <em className="muted">— paste the deliverable, or upload a .html file</em></span>
        <textarea className="inp mono" rows={6} value={html} onChange={(e) => onHtmlChange(e.target.value)} placeholder="<!doctype html> …" /></label>
      <input type="file" accept=".html,text/html" onChange={onFile} />
      <div className="sec-edit">
        <div className="sec-edit-h">
          <b>Reviewable sections</b>
          <span className="muted sm">{sections.length} detected — each “key” must match a <code>&lt;section id&gt;</code> on the page</span>
        </div>
        {sections.map((s, i) => (
          <div className="sec-row" key={i}>
            <input className="inp" placeholder="section id (key)" value={s.section_key} onChange={(e) => upd(i, 'section_key', e.target.value)} />
            <input className="inp" placeholder="Display name" value={s.name} onChange={(e) => upd(i, 'name', e.target.value)} />
            <input className="inp" placeholder="Short description (optional)" value={s.blurb} onChange={(e) => upd(i, 'blurb', e.target.value)} />
            <button className="icon-del" onClick={() => rm(i)}>✕</button>
          </div>
        ))}
        <button className="btn lite" onClick={add}>+ Add section</button>
      </div>
      {err && <div className="err">{err}</div>}
      <div className="form-foot">
        <button className="btn lite" onClick={onCancel}>Cancel</button>
        <button className="btn brand" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Create review'}</button>
      </div>
    </div>
  )
}

function Feedback({ review, back }) {
  const token = review.share_token
  const [data, setData] = useState(null)
  const [drafts, setDrafts] = useState({})

  const load = useCallback(async () => {
    const { data: res } = await supabase.rpc('rpc_get_review', { p_token: token })
    setData(res)
  }, [token])
  useEffect(() => { load(); const t = setInterval(load, 12000); return () => clearInterval(t) }, [load])

  if (!data) return <div className="center-msg">Loading…</div>
  const { sections, comments } = data
  const approved = sections.filter((s) => s.status === 'approved').length

  async function reply(key) {
    const b = (drafts[key] || '').trim()
    if (!b) return
    setDrafts((d) => ({ ...d, [key]: '' }))
    await supabase.rpc('rpc_add_comment', { p_token: token, p_section_key: key, p_author_name: BRAND.name, p_author_role: 'agency', p_body: b })
    load()
  }
  async function setStatus(key, st) { await supabase.rpc('rpc_set_status', { p_token: token, p_section_key: key, p_status: st }); load() }
  async function toggle(id) { await supabase.rpc('rpc_toggle_resolve', { p_token: token, p_comment_id: id }); load() }
  function copyLink(lang) {
    try {
      navigator.clipboard.writeText(clientLink(token, lang))
      toast(lang === 'es' ? 'Spanish client link copied' : 'English client link copied')
    } catch { toast('Copy failed') }
  }
  function copyReport() {
    const out = [review.title, `${approved}/${sections.length} sections approved`, '']
    sections.forEach((s, i) => {
      out.push(`${i + 1}. ${s.name} — ${label(s.status).toUpperCase()}`)
      comments.filter((c) => c.section_key === s.section_key).forEach((c) =>
        out.push(`   • [${c.author_role === 'agency' ? BRAND.name : 'Client'} ${c.author_name || ''}${c.resolved ? ' · resolved' : ''}] ${c.body}`))
    })
    try { navigator.clipboard.writeText(out.join('\n')); toast('Report copied') } catch { toast('Copy failed') }
  }
  // Build a self-contained Markdown "change brief": LLM framing + per-section
  // feedback + the full current page HTML, ready to paste into a model to drive
  // edits. Mirrors copyReport's author-role formatting.
  function buildBrief() {
    const rev = data.review
    const statusText = rev.status === 'completed' ? 'Completed' : 'In review'
    const out = [
      `# Page change brief — ${review.title}`,
      '',
      `- **Client:** ${rev.client_name || '—'}`,
      `- **Review status:** ${statusText}`,
      `- **Approved:** ${approved}/${sections.length} sections`,
      `- **Generated:** ${new Date().toLocaleString()}`,
      '',
      '## Instructions',
      '',
      'You are updating the HTML page included at the end of this document. Apply the',
      "client's requested changes section by section. Each section below maps to a",
      '`<section id="…">` in the page HTML via its id. Implement every "changes requested"',
      'item; leave approved sections unchanged unless a requested change depends on them.',
      'Preserve the existing structure, styling, and ids unless a change requires otherwise.',
      '',
      '## Feedback by section',
      '',
    ]
    sections.forEach((s, i) => {
      out.push(`### ${i + 1}. ${s.name} (id: \`${s.section_key}\`) — ${label(s.status).toUpperCase()}`)
      if (s.blurb) out.push(`_${s.blurb}_`)
      const cs = comments.filter((c) => c.section_key === s.section_key)
      if (cs.length === 0) out.push('_No comments._')
      else cs.forEach((c) =>
        out.push(`- [${c.author_role === 'agency' ? BRAND.name : 'Client'} ${c.author_name || ''}${c.resolved ? ' · resolved' : ''}] ${c.body}`))
      out.push('')
    })
    out.push('## Current page HTML', '')
    if (rev.page_html) {
      // A literal ``` inside page_html could in theory break this fence; acceptable
      // for an internal tool where the agency controls the deliverable.
      out.push('```html', rev.page_html, '```')
    } else if (rev.page_url) {
      out.push(`Page URL: ${rev.page_url}`)
    } else {
      out.push('_No page is attached to this review._')
    }
    return out.join('\n')
  }
  function downloadBrief() {
    try {
      const slug = (review.title || 'review').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'review'
      const blob = new Blob([buildBrief()], { type: 'text/markdown' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = `change-brief-${slug}.md`
      document.body.appendChild(a); a.click(); a.remove()
      URL.revokeObjectURL(url)
      toast('Change brief downloaded')
    } catch { toast('Download failed') }
  }

  return (
    <div className="fb">
      <button className="back" onClick={back}>‹ All reviews</button>
      <div className="fb-head">
        <div><h1>{review.title}</h1><div className="muted">{review.client_name || '—'}</div></div>
        <div className="fb-actions">
          <span className="prog2"><span className="bar"><span style={{ width: (approved / sections.length * 100) + '%' }} /></span>{approved}/{sections.length} approved</span>
          <span className="copy-split">
            <span className="copy-split-label">Copy link</span>
            <button className="btn lite" onClick={() => copyLink('en')} title="Copy English client link">EN</button>
            <button className="btn lite" onClick={() => copyLink('es')} title="Copy Spanish client link">ES</button>
          </span>
          <button className="btn lite" onClick={copyReport}>Copy report</button>
          <button className={'btn ' + (review.status === 'completed' ? 'brand' : 'lite')} onClick={downloadBrief}>Download change brief</button>
        </div>
      </div>
      <div className="fb-sections">
        {sections.map((s, i) => {
          const cs = comments.filter((c) => c.section_key === s.section_key)
          return (
            <div className="fb-sec" key={s.section_key}>
              <div className="fb-sec-h">
                <span className={'badge ' + s.status}>{label(s.status)}</span>
                <b>{i + 1}. {s.name}</b>
                <div className="fb-st">
                  <button className="mini ap" onClick={() => setStatus(s.section_key, 'approved')}>Approve</button>
                  <button className="mini ch" onClick={() => setStatus(s.section_key, 'changes')}>Changes</button>
                  <button className="mini pe" onClick={() => setStatus(s.section_key, 'pending')}>Reset</button>
                </div>
              </div>
              <div className="fb-cmts">
                {cs.length === 0 && <div className="muted sm">No comments.</div>}
                {cs.map((c) => (
                  <div className={'fb-cmt' + (c.resolved ? ' done' : '')} key={c.id}>
                    <span className={'rt ' + (c.author_role === 'agency' ? 'ag' : 'cl')}>{c.author_role === 'agency' ? BRAND.name : 'Client'}</span>
                    <b>{c.author_name || '—'}</b>
                    <span className="cx">{c.body}</span>
                    <button className="res" onClick={() => toggle(c.id)}>{c.resolved ? 'reopen' : 'resolve'}</button>
                  </div>
                ))}
                <div className="reply">
                  <input className="inp" placeholder={`Reply as ${BRAND.name}…`} value={drafts[s.section_key] || ''}
                    onChange={(e) => setDrafts((d) => ({ ...d, [s.section_key]: e.target.value }))}
                    onKeyDown={(e) => e.key === 'Enter' && reply(s.section_key)} />
                  <button className="btn lite" onClick={() => reply(s.section_key)}>Send</button>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
