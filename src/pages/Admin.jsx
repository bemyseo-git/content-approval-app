import { useEffect, useState, useCallback, useRef } from 'react'
import { supabase } from '../supabase.js'
import { BRAND } from '../brand.js'
import { appConfirm, appPrompt } from '../dialog.jsx'

// Build the client-facing review link.
// English is the bare link; Spanish carries ?lang=es, which the review page
// reads to localize the client-facing UI.
const clientLink = (token, lang) => `${window.location.origin}/r/${token}${lang === 'es' ? '?lang=es' : ''}`

const label = (s) => (s === 'approved' ? 'Approved' : s === 'changes' ? 'Changes requested' : 'Pending')
// ---------------------------------------------------------------------------
// Deliverable preparation: one pass that (1) strips site chrome, (2) finds the
// reviewable sections, and (3) makes sure every one of them has an id — the
// review page anchors comments/chips by id, so detected sections must be
// tagged in the stored HTML itself.
// Detection ladder:
//   1. section[id] / [data-review-section]           (explicitly tagged)
//   2. every other <section>/<article>               (id auto-injected)
//   3. big top-level blocks, if the page has neither (id auto-injected)
// Names come from each section's first heading; empty spacers are skipped.
// ---------------------------------------------------------------------------
const GENERIC_CLASSES = new Set(['wrap', 'wrapper', 'container', 'inner', 'row', 'grid', 'alt', 'main', 'content', 'block', 'box'])
const slugify = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/g, '')

function prepareHtml(htmlStr) {
  try {
    const doc = new DOMParser().parseFromString(htmlStr, 'text/html')

    // 1. Strip page-level chrome (never anything inside — or containing — content).
    doc.querySelectorAll('header, footer, nav, [role="banner"], [role="contentinfo"]').forEach((el) => {
      if (el.closest('section, article')) return
      if (el.querySelector('section[id], [data-review-section]')) return
      el.remove()
    })

    // 2. Candidates: all sections/articles + anything explicitly tagged.
    let cands = [...doc.querySelectorAll('section, article, [data-review-section]')]
    // 3. Fallback for section-less pages: big direct children of body/main.
    if (cands.length === 0) {
      let roots = [...doc.body.children]
      const main = doc.body.querySelector(':scope > main, :scope > div:only-child')
      if (main) roots = [...main.children]
      cands = roots.filter((el) => /^(DIV|MAIN|TABLE|UL|OL)$/.test(el.tagName))
    }

    const heading = (el) => {
      const h = el.querySelector('h1, h2, h3, h4')
      if (!h) return ''
      // strip junk that leaks into draft headings: markdown (**, ##, dashes)
      // and literal level labels ("H1:", "h2 -", "H3.")
      return h.textContent.replace(/\s+/g, ' ')
        .replace(/^(?:\s*(?:h[1-6]\s*[:.\-–—)]|[*#>\-–—])\s*)+/i, '')
        .trim().slice(0, 60)
    }
    // Skip spacer/empty candidates: no heading, no image, barely any text.
    cands = cands.filter((el) => heading(el) || el.querySelector('img, svg, iframe') ||
      el.textContent.replace(/\s+/g, ' ').trim().length > 60)

    const used = new Set(cands.map((el) => el.id).filter(Boolean))
    const out = []
    const seen = new Set()
    cands.forEach((el, i) => {
      // Ensure a stable id: existing id -> data attribute -> heading slug ->
      // meaningful class -> positional fallback. Injected into the HTML.
      let key = el.id || el.getAttribute('data-review-section') || ''
      if (!key) {
        // meaningful class token first ("hero", "cta") — short and stable —
        // then the heading slug, then a positional fallback
        key = [...el.classList].find((c) => !GENERIC_CLASSES.has(c.toLowerCase())) ||
          slugify(heading(el)) || ''
        key = slugify(key) || `section-${i + 1}`
        let unique = key, n = 2
        while (used.has(unique)) unique = `${key}-${n++}`
        key = unique
      }
      used.add(key)
      if (!el.id) el.id = key
      if (seen.has(key)) return
      seen.add(key)
      out.push({ section_key: key, name: heading(el) || guessName(key), blurb: '' })
    })

    return { html: '<!doctype html>\n' + doc.documentElement.outerHTML, sections: out }
  } catch { return { html: htmlStr, sections: [] } }
}
// The two kinds of content an agency sends for review.
const CONTENT_TYPES = [
  { value: 'landing_page', label: 'Landing page' },
  { value: 'blog', label: 'Blog' },
]
const typeLabel = (t) => (t === 'blog' ? 'Blog' : 'Landing page')
// "· due Jul 18" tag for cards/table; red once overdue while still with client.
const dueTag = (r, bare = false) => {
  if (!r.due_date) return null
  const d = new Date(r.due_date + 'T00:00:00')
  const overdue = r.status === 'in_review' && d < new Date(new Date().toDateString())
  return <span className={'due-tag' + (overdue ? ' over' : '')}>{bare ? '' : ' · '}due {d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}{overdue ? ' — overdue' : ''}</span>
}
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

// Roll section rows + comments into a per-review feedback summary the agency
// dashboard uses for notifications. A section "has feedback" when the client
// requested changes, approved it, or left a comment. Sort so the sections that
// still need the agency's attention (changes / unresolved comments) come first.
function buildFeedbackMap(sections, comments) {
  const secByReview = new Map()
  ;(sections || []).forEach((s) => {
    if (!secByReview.has(s.review_id)) secByReview.set(s.review_id, [])
    secByReview.get(s.review_id).push(s)
  })
  const key = (rid, sk) => rid + '|' + sk
  const cmtCounts = new Map() // review|section -> { total, unresolved } (client only)
  ;(comments || []).forEach((c) => {
    if (c.author_role !== 'client') return
    const k = key(c.review_id, c.section_key)
    const cur = cmtCounts.get(k) || { total: 0, unresolved: 0 }
    cur.total += 1
    if (!c.resolved) cur.unresolved += 1
    cmtCounts.set(k, cur)
  })
  const map = new Map()
  secByReview.forEach((secs, rid) => {
    const items = []
    secs.forEach((s) => {
      const cc = cmtCounts.get(key(rid, s.section_key)) || { total: 0, unresolved: 0 }
      const changes = s.status === 'changes'
      const approved = s.status === 'approved'
      if (!changes && !approved && cc.total === 0) return // no client feedback yet
      const attention = changes || cc.unresolved > 0
      const kind = changes ? 'changes' : cc.total > 0 ? 'comment' : 'approved'
      items.push({ key: s.section_key, name: s.name, kind, attention, comments: cc.total, unresolved: cc.unresolved })
    })
    // general (page-level) feedback shows as its own chip
    const g = cmtCounts.get(key(rid, '__general__'))
    if (g && g.total > 0) items.push({ key: '__general__', name: 'General', kind: 'comment', attention: g.unresolved > 0, comments: g.total, unresolved: g.unresolved })
    items.sort((a, b) => (b.attention - a.attention) || (b.comments - a.comments))
    const attentionCount = items.filter((i) => i.attention).length
    map.set(rid, { items, attentionCount })
  })
  return map
}

const BellIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.7 21a2 2 0 0 1-3.4 0" />
  </svg>
)

// "View feedback" action with an iOS-app-style notification badge showing how
// many sections still need the agency's attention (changes / unresolved).
function ViewFeedbackBtn({ fb, onOpen, label = 'View feedback' }) {
  const n = fb ? fb.attentionCount : 0
  return (
    <button className="btn lite viewfb" onClick={onOpen}>
      {label}
      {n > 0 && <span className="ios-badge" aria-label={`${n} section${n > 1 ? 's' : ''} need attention`}>{n}</span>}
    </button>
  )
}

// Full-width chip row: one notification per section that has client feedback.
function FeedbackNotifs({ fb, onOpen }) {
  if (!fb || fb.items.length === 0) return null
  return (
    <div className="notif-row" onClick={onOpen} title="Open feedback">
      <span className="notif-lead"><BellIcon /> Feedback</span>
      {fb.items.map((s) => (
        <span key={s.key} className={'notif-chip ' + s.kind}
          title={s.kind === 'changes' ? 'Changes requested' : s.kind === 'comment' ? `${s.comments} comment${s.comments > 1 ? 's' : ''}` : 'Approved'}>
          <span className="notif-dot" />
          <span className="notif-name">{s.name}</span>
          {s.kind === 'changes' && <span className="notif-tag">Changes</span>}
          {s.kind !== 'changes' && s.comments > 0 && <span className="notif-count">{s.comments}</span>}
        </span>
      ))}
    </div>
  )
}

// Review lifecycle: in_review (with client) -> completed (client finished,
// ready for the agency to accept) -> accepted (agency signed off; the content
// is being used to build the live page — client link locks).
function StatusBadge({ status, decision }) {
  if (status === 'accepted') return <span className="badge approved">Accepted</span>
  if (status === 'completed') {
    if (decision === 'revision_requested') return <span className="badge changes">New version requested</span>
    if (decision === 'approved') return <span className="badge client-ok">Client approved</span>
    return <span className="badge ready">Ready to accept</span>
  }
  return <span className="badge pending">With client</span>
}

async function acceptReviewRow(r, reload) {
  const ok = await appConfirm(r.status === 'completed'
    ? {
        title: 'Accept this content?',
        body: 'This finalizes the review — the approved content will be used to build the live page. The client link locks and no further feedback can be added.',
        okLabel: '✓ Accept content',
      }
    : {
        title: 'Accept before the client finishes?',
        body: 'The client hasn’t completed this review yet. Accepting now finalizes the content and locks further client feedback.',
        okLabel: 'Accept anyway',
      })
  if (!ok) return false
  const { error } = await supabase.from('reviews')
    .update({ status: 'accepted', accepted_at: new Date().toISOString() }).eq('id', r.id)
  if (error) { toast(error.message || 'Accept failed'); return false }
  toast('Content accepted — review finalized')
  reload()
  return true
}

const ArchiveIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="2" y="3" width="20" height="5" rx="1" />
    <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" />
    <path d="M10 12h4" />
  </svg>
)

// Archive replaces delete as the everyday action: the review disappears from
// the main views but keeps all its feedback and can be restored anytime.
async function archiveReviewRow(r, reload) {
  const { error } = await supabase.from('reviews')
    .update({ archived_at: new Date().toISOString() }).eq('id', r.id)
  if (error) { toast(error.message || 'Archive failed'); return }
  toast('Review archived')
  reload()
}

async function restoreReviewRow(r, reload) {
  const { error } = await supabase.from('reviews')
    .update({ archived_at: null }).eq('id', r.id)
  if (error) { toast(error.message || 'Restore failed'); return }
  toast('Review restored')
  reload()
}

async function copyReviewLink(r, lang) {
  try {
    await navigator.clipboard.writeText(clientLink(r.share_token, lang))
    toast(lang === 'es' ? 'Spanish client link copied' : 'English client link copied')
  } catch { toast('Copy failed') }
}

// "⋯" overflow menu for secondary row/card actions. The panel is fixed-
// positioned so scroll containers (like the reviews table) can't clip it.
function MoreMenu({ items }) {
  const [pos, setPos] = useState(null) // null = closed
  const ref = useRef(null)
  function toggle() {
    if (pos) { setPos(null); return }
    const r = ref.current.getBoundingClientRect()
    setPos({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) })
  }
  useEffect(() => {
    if (!pos) return
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setPos(null) }
    const closeNow = () => setPos(null)
    document.addEventListener('mousedown', onDown)
    window.addEventListener('scroll', closeNow, true)
    window.addEventListener('resize', closeNow)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('scroll', closeNow, true)
      window.removeEventListener('resize', closeNow)
    }
  }, [pos])
  return (
    <div className="more-wrap" ref={ref}>
      <button className="btn lite more-btn" aria-haspopup="menu" aria-expanded={!!pos} aria-label="More actions" onClick={toggle}>⋯</button>
      {pos && (
        <div className="more-menu" role="menu" style={{ position: 'fixed', top: pos.top, right: pos.right }}>
          {items.map((i) => (
            <button key={i.label} role="menuitem" className={'more-item' + (i.danger ? ' danger' : '')} onClick={() => { setPos(null); i.onClick() }}>{i.label}</button>
          ))}
        </div>
      )}
    </div>
  )
}

// One review card with the same action set everywhere it appears (dashboard
// groups, clients directory) so the actions never depend on which view you're in.
function ReviewCard({ r, feedback, onOpen, reload }) {
  const fb = r.status === 'accepted' ? null : feedback && feedback.get(r.id)
  return (
    <div className="rcard">
      <div className="rcard-main" onClick={() => onOpen(r)}>
        <b>{r.title} <StatusBadge status={r.status} decision={r.client_decision} /></b>
        <div className="muted sm">
          <span className={'type-tag ' + (r.content_type || 'landing_page')}>{typeLabel(r.content_type)}</span>
          · {new Date(r.created_at).toLocaleDateString()}{dueTag(r)}
          {r.status === 'accepted' && r.accepted_at && <> · accepted {new Date(r.accepted_at).toLocaleDateString()}</>}
        </div>
      </div>
      <div className="rcard-act">
        {r.status === 'completed' && <button className="btn brand" onClick={() => acceptReviewRow(r, reload)}>✓ Accept</button>}
        {r.status === 'accepted' && <button className="btn ghost" onClick={() => reopenReviewRow(r, reload)}>Reopen</button>}
        <span className="copy-split">
          <span className="copy-split-label">Copy link</span>
          <button className="btn lite" onClick={() => copyReviewLink(r, 'en')} title="Copy English client link">EN</button>
          <button className="btn lite" onClick={() => copyReviewLink(r, 'es')} title="Copy Spanish client link">ES</button>
        </span>
        <ViewFeedbackBtn fb={fb} onOpen={() => onOpen(r)} />
        <button className="icon-arc" title="Archive" onClick={() => archiveReviewRow(r, reload)}><ArchiveIcon /></button>
      </div>
      {r.status !== 'accepted' && <FeedbackNotifs fb={feedback && feedback.get(r.id)} onOpen={() => onOpen(r)} />}
    </div>
  )
}

async function reopenReviewRow(r, reload) {
  const ok = await appConfirm({
    title: 'Reopen this review?',
    body: 'It moves back to “Ready to accept” and the client can leave feedback again.',
    okLabel: 'Reopen review',
  })
  if (!ok) return false
  const { error } = await supabase.from('reviews')
    .update({ status: 'completed', accepted_at: null }).eq('id', r.id)
  if (error) { toast(error.message || 'Reopen failed'); return false }
  toast('Review reopened')
  reload()
  return true
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
      </div>
    </div>
  )
}

function Dashboard({ session }) {
  const [reviews, setReviews] = useState(null)
  const [clients, setClients] = useState([])
  const [feedback, setFeedback] = useState(new Map())
  const [view, setView] = useState({ name: 'list' })

  const load = useCallback(async () => {
    const [{ data: revs }, clsRes, { data: secs }, { data: cmts }] = await Promise.all([
      supabase.from('reviews').select('*').order('created_at', { ascending: false }),
      supabase.from('clients').select('id,name,archived_at').order('name'),
      supabase.from('review_sections').select('review_id,section_key,name,status'),
      supabase.from('comments').select('review_id,section_key,author_role,resolved'),
    ])
    let cls = clsRes.data
    // Fallback for databases that haven't run the archive-clients migration yet.
    if (clsRes.error) ({ data: cls } = await supabase.from('clients').select('id,name').order('name'))
    setReviews(revs || [])
    setClients(cls || [])
    setFeedback(buildFeedbackMap(secs, cmts))
  }, [])
  useEffect(() => { load() }, [load])
  // Poll so client feedback surfaces as notifications without a manual refresh.
  useEffect(() => { const t = setInterval(load, 20000); return () => clearInterval(t) }, [load])

  return (
    <div className="adm">
      <header className="adm-bar">
        <button className="adm-brand" onClick={() => setView({ name: 'list' })} title="Back to dashboard">
          {BRAND.logoUrl ? <img src={BRAND.logoUrl} className="logo-img" alt="" /> : <b>{BRAND.name}</b>}
          <span className="sep">/</span><span>{BRAND.product}</span>
        </button>
        <div className="adm-r">
          <span className="muted sm adm-email" title={session.user.email}>{session.user.email}</span>
          <button className="lnk" onClick={() => supabase.auth.signOut()}>Sign out</button>
        </div>
      </header>
      <main className="adm-main">
        {view.name === 'list' && (
          <ReviewList
            reviews={reviews}
            clients={clients}
            feedback={feedback}
            onNew={() => setView({ name: 'new' })}
            onNewClient={() => setView({ name: 'new-client' })}
            onClients={() => setView({ name: 'clients' })}
            onTable={() => setView({ name: 'reviews-table' })}
            onArchived={() => setView({ name: 'archived' })}
            onOpen={(r) => setView({ name: 'feedback', review: r })}
            reload={load}
          />
        )}
        {view.name === 'archived' && (
          <ArchivedView
            reviews={reviews}
            clients={clients}
            onBack={() => setView({ name: 'list' })}
            onOpen={(r) => setView({ name: 'feedback', review: r })}
            reload={load}
          />
        )}
        {view.name === 'reviews-table' && (
          <ReviewsTable
            reviews={reviews}
            clients={clients}
            feedback={feedback}
            onBack={() => setView({ name: 'list' })}
            onNew={() => setView({ name: 'new' })}
            onOpen={(r) => setView({ name: 'feedback', review: r })}
            reload={load}
          />
        )}
        {view.name === 'new' && (
          <NewReview clients={clients} onDone={() => { setView({ name: 'list' }); load() }} onCancel={() => setView({ name: 'list' })} />
        )}
        {view.name === 'new-client' && (
          <NewClient clients={clients} onDone={() => { setView({ name: 'clients' }); load() }} onCancel={() => setView({ name: 'list' })} />
        )}
        {view.name === 'clients' && (
          <ClientsView
            reviews={reviews}
            clients={clients}
            feedback={feedback}
            onBack={() => setView({ name: 'list' })}
            onNewClient={() => setView({ name: 'new-client' })}
            onNew={() => setView({ name: 'new' })}
            onOpen={(r) => setView({ name: 'feedback', review: r })}
            reload={load}
          />
        )}
        {view.name === 'feedback' && (
          <Feedback review={view.review} back={() => { setView({ name: 'list' }); load() }} />
        )}
      </main>
    </div>
  )
}

function ReviewList({ reviews, clients, feedback, onNew, onNewClient, onClients, onTable, onArchived, onOpen, reload }) {
  const [tab, setTab] = useState('active') // active | accepted
  const [q, setQ] = useState('')
  async function rename(g) {
    const next = await appPrompt({
      title: 'Rename client',
      body: g.items.length > 1
        ? `This updates “${g.client}” on all ${g.items.length} of their reviews.`
        : `This updates “${g.client}” on their review.`,
      defaultValue: g.client,
      placeholder: 'Client name',
      okLabel: 'Rename',
    })
    if (next == null) return
    const t = next.trim()
    if (!t || t === g.client) return
    const { error } = await supabase.rpc('rpc_rename_client', { p_client_id: g.id, p_name: t })
    if (error) { toast(error.message || 'Rename failed') } else { toast('Client renamed'); reload() }
  }

  if (reviews === null) return <div className="center-msg">Loading…</div>
  const nameById = new Map((clients || []).map((c) => [c.id, c.name]))
  const ql = q.trim().toLowerCase()
  const matches = (r) => !ql ||
    (r.title || '').toLowerCase().includes(ql) ||
    ((r.client_id ? nameById.get(r.client_id) : r.client_name) || '').toLowerCase().includes(ql)
  const visible = reviews.filter((r) => !r.archived_at)
  const archivedCount = reviews.length - visible.length
  const activeList = visible.filter((r) => r.status !== 'accepted')
  const acceptedList = visible.filter((r) => r.status === 'accepted')
  const readyCount = activeList.filter((r) => r.status === 'completed' && r.client_decision !== 'revision_requested').length
  const reviseCount = activeList.filter((r) => r.status === 'completed' && r.client_decision === 'revision_requested').length
  const shown = (tab === 'accepted' ? acceptedList : activeList).filter(matches)
  const groups = groupByClient(shown, clients)
  return (
    <>
      <div className="adm-head">
        <h1>Reviews</h1>
        <div className="adm-head-act">
          <button className="btn ghost" onClick={onTable}>All reviews (table)</button>
          <button className="btn ghost" onClick={onClients}>View clients</button>
          <span className="adm-head-div" aria-hidden="true" />
          <button className="btn brand" onClick={onNewClient}>+ New client</button>
          <button className="btn brand" onClick={onNew}>+ New review</button>
        </div>
      </div>
      {visible.length > 0 && (
        <div className="filter-tabs">
          <div className="segmented">
            <button className={'seg' + (tab === 'active' ? ' on' : '')} onClick={() => setTab('active')}>
              To review{activeList.length > 0 ? ` · ${activeList.length}` : ''}
            </button>
            <button className={'seg' + (tab === 'accepted' ? ' on' : '')} onClick={() => setTab('accepted')}>
              Accepted{acceptedList.length > 0 ? ` · ${acceptedList.length}` : ''}
            </button>
          </div>
          {tab === 'active' && (readyCount > 0 || reviseCount > 0) && (
            <span className="ready-hint">
              {[readyCount > 0 ? `${readyCount} ready to accept` : null,
                reviseCount > 0 ? `${reviseCount} awaiting new version` : null].filter(Boolean).join(' · ')}
            </span>
          )}
          <input className="inp search-inp" type="search" value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Search title or client…" aria-label="Search reviews" />
        </div>
      )}
      {reviews.length === 0 ? (
        <div className="empty-card">No reviews yet. Create one and send the link to your client.</div>
      ) : visible.length === 0 ? (
        <div className="empty-card">No active reviews — everything is in the archive.</div>
      ) : shown.length === 0 && (
        <div className="empty-card">
          {ql
            ? <>No reviews match “{q.trim()}”.</>
            : tab === 'accepted'
              ? 'Nothing accepted yet. When a client finishes a review, hit Accept to finalize it.'
              : 'No content waiting on review — everything has been accepted. 🎉'}
        </div>
      )}
      {groups.map((g) => (
        <section className="cgroup" key={g.id || 'unassigned'}>
          <div className="cgroup-h">
            <h2>{g.client}</h2>
            <span className="cgroup-count">{g.items.length} review{g.items.length > 1 ? 's' : ''}</span>
            {g.id && <button className="cgroup-edit" title="Rename client" onClick={() => rename(g)}>Rename</button>}
          </div>
          <div className="cards">
            {g.items.map((r) => (
              <ReviewCard key={r.id} r={r} feedback={feedback} onOpen={onOpen} reload={reload} />
            ))}
          </div>
        </section>
      ))}
      <div className="arch-link-row">
        <button className="lnk" onClick={onArchived}>
          View archived reviews{archivedCount > 0 ? ` (${archivedCount})` : ''}
        </button>
      </div>
    </>
  )
}

function NewReview({ clients = [], onDone, onCancel }) {
  const [title, setTitle] = useState('')
  const [contentType, setContentType] = useState('landing_page')
  const [dueDate, setDueDate] = useState('')       // optional "review by" date for the client
  const [clientSel, setClientSel] = useState('')   // '' = none · a client id · '__new__'
  const [newClient, setNewClient] = useState('')
  const [html, setHtml] = useState('')
  const [sections, setSections] = useState([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [fileName, setFileName] = useState('')  // last uploaded file, shown in the zone
  const [showPaste, setShowPaste] = useState(false)
  const [dragOver, setDragOver] = useState(false)

  function readFile(f) {
    if (!f) return
    const fr = new FileReader()
    // Uploaded files are prepared immediately (chrome stripped, section ids
    // injected) so what gets stored is exactly what will be saved.
    fr.onload = () => { const p = prepareHtml(fr.result); setHtml(p.html); setSections(p.sections); setFileName(f.name) }
    fr.readAsText(f)
  }
  function onFile(e) { readFile(e.target.files[0]) }
  function onDrop(e) { e.preventDefault(); setDragOver(false); readFile(e.dataTransfer.files && e.dataTransfer.files[0]) }
  // Pasted/typed HTML keeps the raw text in the textarea (no cursor jumps);
  // preparation is applied to what gets parsed and to what is saved.
  function onHtmlChange(v) { setHtml(v); setFileName(''); if (v.length > 200) setSections(prepareHtml(v).sections) }
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
      if (dupe) {
        setErr(dupe.archived_at
          ? `“${dupe.name}” exists in archived clients — restore it from View clients instead.`
          : `“${dupe.name}” already exists — pick it from the list instead.`)
        return
      }
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
      .insert({ title: title.trim(), content_type: contentType, client_id: clientId, client_name: clientName, due_date: dueDate || null, page_html: html ? prepareHtml(html).html : null })
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
      <div className="fld"><span>Content type</span>
        <div className="segmented">
          {CONTENT_TYPES.map((ct) => (
            <button
              key={ct.value}
              type="button"
              className={'seg' + (contentType === ct.value ? ' on' : '')}
              onClick={() => setContentType(ct.value)}
            >{ct.label}</button>
          ))}
        </div>
      </div>
      <div className="grid2">
        <label className="fld"><span>Review title</span>
          <input className="inp" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Urgent Care Services Landing Page" /></label>
        <div className="fld"><span>Client</span>
          <select className="inp select" value={clientSel} onChange={(e) => setClientSel(e.target.value)}>
            <option value="">No client</option>
            {clients.some((c) => !c.archived_at) && (
              <optgroup label="Existing clients">
                {clients.filter((c) => !c.archived_at).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </optgroup>
            )}
            <option value="__new__">+ Add a new client…</option>
          </select>
          {clientSel === '__new__' && (
            <input className="inp" style={{ marginTop: 8 }} value={newClient} autoFocus
              onChange={(e) => setNewClient(e.target.value)} placeholder="New client name, e.g. RapidCare Urgent Care" />
          )}
          <span className="fld-hint">Groups this review with the client’s other reviews.</span>
        </div>
      </div>
      <div className="grid2">
        <label className="fld"><span>Due date <em className="muted">— optional, shown to the client as “Review by …”</em></span>
          <input type="date" className="inp" value={dueDate} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setDueDate(e.target.value)} /></label>
        <span />
      </div>
      <div className="fld"><span>Page deliverable <em className="muted">— header/footer/nav are stripped &amp; sections are detected and tagged automatically</em></span>
        <div
          className={'upload-zone' + (dragOver ? ' drag' : '') + (fileName ? ' has' : '')}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
        >
          <input type="file" accept=".html,text/html" onChange={onFile} aria-label="Upload the .html deliverable" />
          <span className="up-ic" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 17V4" /><path d="m6 10 6-6 6 6" /><path d="M4 20h16" /></svg>
          </span>
          <b>{fileName || 'Upload the .html file'}</b>
          <span className="up-hint">{fileName ? 'File loaded — choose another to replace it' : 'Click to choose a file, or drag & drop it here'}</span>
        </div>
      </div>
      {!showPaste && !html ? (
        <button className="lnk paste-toggle" onClick={() => setShowPaste(true)}>Prefer to paste the HTML instead?</button>
      ) : (showPaste || (html && !fileName)) && (
        <label className="fld"><span>Paste HTML <em className="muted">— alternative to uploading a file</em></span>
          <textarea className="inp mono" rows={6} value={html} onChange={(e) => onHtmlChange(e.target.value)} placeholder="<!doctype html> …" /></label>
      )}
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

// Create a client on its own, without attaching a review to it.
function NewClient({ clients = [], onDone, onCancel }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function save() {
    setErr('')
    const cname = name.trim()
    if (!cname) { setErr('Enter the client’s name.'); return }
    const dupe = clients.find((c) => c.name.toLowerCase() === cname.toLowerCase())
    if (dupe) {
      setErr(dupe.archived_at
        ? `“${dupe.name}” exists in archived clients — restore it from View clients instead.`
        : `“${dupe.name}” already exists.`)
      return
    }
    setBusy(true)
    const { error } = await supabase.from('clients').insert({ name: cname })
    setBusy(false)
    if (error) { setErr(error.message); return }
    toast('Client created')
    onDone()
  }

  return (
    <div className="form-wrap">
      <button className="back" onClick={onCancel}>‹ Back</button>
      <h1>New client</h1>
      <label className="fld"><span>Client name</span>
        <input className="inp" value={name} autoFocus
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && save()}
          placeholder="e.g. RapidCare Urgent Care" />
        <span className="fld-hint">You can attach reviews (blogs or landing pages) to this client afterwards.</span>
      </label>
      {err && <div className="err">{err}</div>}
      <div className="form-foot">
        <button className="btn lite" onClick={onCancel}>Cancel</button>
        <button className="btn brand" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Create client'}</button>
      </div>
    </div>
  )
}

// A directory of every client and all of the content attached to each — including
// clients that have no reviews yet, and an "Unassigned" bucket for orphan reviews.
function ClientsView({ reviews, clients, feedback, onBack, onNewClient, onNew, onOpen, reload }) {
  async function rename(c) {
    const next = await appPrompt({
      title: 'Rename client',
      body: `This updates “${c.name}” on all of their reviews.`,
      defaultValue: c.name,
      placeholder: 'Client name',
      okLabel: 'Rename',
    })
    if (next == null) return
    const t = next.trim()
    if (!t || t === c.name) return
    const { error } = await supabase.rpc('rpc_rename_client', { p_client_id: c.id, p_name: t })
    if (error) { toast(error.message || 'Rename failed') } else { toast('Client renamed'); reload() }
  }
  // Archive replaces delete as the everyday action: the client leaves the
  // directory and the new-review picker, but keeps their reviews and can be
  // restored anytime. Permanent delete lives only on archived clients.
  async function archiveClient(c) {
    const { error } = await supabase.from('clients').update({ archived_at: new Date().toISOString() }).eq('id', c.id)
    if (error) { toast(error.message || 'Archive failed') } else { toast('Client archived'); reload() }
  }
  async function restoreClient(c) {
    const { error } = await supabase.from('clients').update({ archived_at: null }).eq('id', c.id)
    if (error) { toast(error.message || 'Restore failed') } else { toast('Client restored'); reload() }
  }
  async function del(c, count) {
    const ok = await appConfirm({
      title: `Delete “${c.name}” permanently?`,
      body: count > 0
        ? `Their ${count} review${count > 1 ? 's' : ''} will remain but become unassigned. This cannot be undone — archive keeps a client recoverable, delete does not.`
        : 'This client has no reviews attached. This cannot be undone.',
      okLabel: 'Delete permanently',
      danger: true,
    })
    if (!ok) return
    const { error } = await supabase.from('clients').delete().eq('id', c.id)
    if (error) { toast(error.message || 'Delete failed') } else { toast('Client deleted permanently'); reload() }
  }

  if (reviews === null) return <div className="center-msg">Loading…</div>

  const byClient = new Map()
  reviews.filter((r) => !r.archived_at).forEach((r) => {
    const key = r.client_id || 'none'
    if (!byClient.has(key)) byClient.set(key, [])
    byClient.get(key).push(r)
  })
  const unassigned = byClient.get('none') || []
  const activeClients = clients.filter((c) => !c.archived_at)
  const archivedClients = clients.filter((c) => c.archived_at)

  return (
    <>
      <button className="back" onClick={onBack}>‹ Reviews</button>
      <div className="adm-head">
        <h1>Clients</h1>
        <div className="adm-head-act">
          <button className="btn brand" onClick={onNewClient}>+ New client</button>
          <button className="btn brand" onClick={onNew}>+ New review</button>
        </div>
      </div>
      {activeClients.length === 0 && unassigned.length === 0 && archivedClients.length === 0 && (
        <div className="empty-card">No clients yet. Create one to start organizing your content.</div>
      )}
      {activeClients.map((c) => {
        const items = byClient.get(c.id) || []
        return (
          <section className="cgroup" key={c.id}>
            <div className="cgroup-h">
              <h2>{c.name}</h2>
              <span className="cgroup-count">{items.length} item{items.length === 1 ? '' : 's'}</span>
              <button className="cgroup-edit" onClick={() => rename(c)}>Rename</button>
              <button className="cgroup-edit" title="Archive client — recoverable anytime" onClick={() => archiveClient(c)}>Archive</button>
            </div>
            {items.length === 0 ? (
              <div className="muted sm" style={{ padding: '2px 2px 4px' }}>No content yet.</div>
            ) : (
              <div className="cards">
                {items.map((r) => (
                  <ReviewCard key={r.id} r={r} feedback={feedback} onOpen={onOpen} reload={reload} />
                ))}
              </div>
            )}
          </section>
        )
      })}
      {unassigned.length > 0 && (
        <section className="cgroup" key="unassigned">
          <div className="cgroup-h">
            <h2>Unassigned</h2>
            <span className="cgroup-count">{unassigned.length} item{unassigned.length === 1 ? '' : 's'}</span>
          </div>
          <div className="cards">
            {unassigned.map((r) => (
              <ReviewCard key={r.id} r={r} feedback={feedback} onOpen={onOpen} reload={reload} />
            ))}
          </div>
        </section>
      )}
      {archivedClients.length > 0 && (
        <section className="cgroup arch-clients">
          <div className="cgroup-h">
            <h2>Archived clients</h2>
            <span className="cgroup-count">{archivedClients.length}</span>
          </div>
          <div className="cards">
            {archivedClients.map((c) => {
              const items = byClient.get(c.id) || []
              return (
                <div className="rcard archived arch-client-row" key={c.id}>
                  <div className="rcard-main">
                    <b>{c.name}</b>
                    <div className="muted sm">
                      {items.length} active review{items.length === 1 ? '' : 's'} · archived {new Date(c.archived_at).toLocaleDateString()}
                    </div>
                  </div>
                  <div className="rcard-act">
                    <button className="btn lite" onClick={() => restoreClient(c)}>Restore</button>
                    <button className="icon-del" title="Delete permanently" onClick={() => del(c, items.length)}>✕</button>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}
    </>
  )
}

// Archived reviews: out of the way but never lost. Restore anytime; permanent
// delete lives ONLY here, behind an explicit confirmation.
function ArchivedView({ reviews, clients, onBack, onOpen, reload }) {
  const nameById = new Map((clients || []).map((c) => [c.id, c.name]))
  async function del(r) {
    const ok = await appConfirm({
      title: `Delete “${r.title}” permanently?`,
      body: 'All of its feedback will be deleted too. This cannot be undone — archive keeps a review recoverable, delete does not.',
      okLabel: 'Delete permanently',
      danger: true,
    })
    if (!ok) return
    const { error } = await supabase.from('reviews').delete().eq('id', r.id)
    if (error) { toast(error.message || 'Delete failed') } else { toast('Review deleted permanently'); reload() }
  }

  if (reviews === null) return <div className="center-msg">Loading…</div>
  const items = reviews.filter((r) => r.archived_at)
    .sort((a, b) => new Date(b.archived_at) - new Date(a.archived_at))

  return (
    <>
      <button className="back" onClick={onBack}>‹ Reviews</button>
      <div className="adm-head">
        <h1>Archived</h1>
        <span className="muted sm">{items.length} review{items.length === 1 ? '' : 's'}</span>
      </div>
      {items.length === 0 ? (
        <div className="empty-card">Nothing archived. Use the archive button on a review to move it here — it stays recoverable, unlike deleting.</div>
      ) : (
        <div className="cards">
          {items.map((r) => (
            <div className="rcard archived" key={r.id}>
              <div className="rcard-main" onClick={() => onOpen(r)}>
                <b>{r.title} <StatusBadge status={r.status} decision={r.client_decision} /></b>
                <div className="muted sm">
                  <span className={'type-tag ' + (r.content_type || 'landing_page')}>{typeLabel(r.content_type)}</span>
                  {' '}· {r.client_id ? (nameById.get(r.client_id) || r.client_name || 'Client') : 'Unassigned'}
                  {' '}· archived {new Date(r.archived_at).toLocaleDateString()}
                </div>
              </div>
              <div className="rcard-act">
                <button className="btn lite" onClick={() => restoreReviewRow(r, reload)}>Restore</button>
                <button className="btn ghost" onClick={() => onOpen(r)}>View feedback</button>
                <button className="icon-del" title="Delete permanently" onClick={() => del(r)}>✕</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

// A flat, sortable-at-a-glance table of every review with the key columns:
// title, content type, client, status, approval progress, and created date.
function ReviewsTable({ reviews, clients, feedback, onBack, onNew, onOpen, reload }) {
  const nameById = new Map((clients || []).map((c) => [c.id, c.name]))
  const [q, setQ] = useState('')
  if (reviews === null) return <div className="center-msg">Loading…</div>
  const ql = q.trim().toLowerCase()
  const matches = (r) => !ql ||
    (r.title || '').toLowerCase().includes(ql) ||
    ((r.client_id ? nameById.get(r.client_id) : r.client_name) || '').toLowerCase().includes(ql)
  const all = reviews.filter((r) => !r.archived_at)
  const rows = all.filter(matches)

  return (
    <>
      <button className="back" onClick={onBack}>‹ Reviews</button>
      <div className="adm-head">
        <h1>All reviews</h1>
        <div className="adm-head-act">
          <input className="inp search-inp" type="search" value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Search title or client…" aria-label="Search reviews" />
          <span className="muted sm">{rows.length}{ql ? ` of ${all.length}` : ''} total</span>
          <button className="btn brand" onClick={onNew}>+ New review</button>
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="empty-card">{ql ? <>No reviews match “{q.trim()}”.</> : 'No active reviews.'}</div>
      ) : (
        <div className="rtable-wrap">
          <table className="rtable">
            <thead>
              <tr>
                <th>Title</th>
                <th>Type</th>
                <th>Client</th>
                <th>Status</th>
                <th>Created</th>
                <th>Due</th>
                <th className="ta-r">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <button className="rt-title" onClick={() => onOpen(r)}>{r.title}</button>
                  </td>
                  <td><span className={'type-tag ' + (r.content_type || 'landing_page')}>{typeLabel(r.content_type)}</span></td>
                  <td>{r.client_id ? (nameById.get(r.client_id) || r.client_name || 'Client') : <span className="muted">Unassigned</span>}</td>
                  <td><StatusBadge status={r.status} decision={r.client_decision} /></td>
                  <td className="muted sm">{new Date(r.created_at).toLocaleDateString()}</td>
                  <td className="muted sm">{dueTag(r, true) || '—'}</td>
                  <td className="ta-r">
                    <div className="rt-act">
                      {r.status === 'completed' && <button className="btn brand" onClick={() => acceptReviewRow(r, reload)}>✓ Accept</button>}
                      {r.status === 'accepted' && <button className="btn ghost" onClick={() => reopenReviewRow(r, reload)}>Reopen</button>}
                      <ViewFeedbackBtn fb={r.status === 'accepted' ? null : feedback && feedback.get(r.id)} onOpen={() => onOpen(r)} label="View" />
                      <MoreMenu items={[
                        { label: 'Copy client link', onClick: () => copyReviewLink(r) },
                        { label: 'Archive', onClick: () => archiveReviewRow(r, reload) },
                      ]} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

// One comment in the agency feedback view. Client comments are the reason
// this screen exists, so they render as prominent bubbles (avatar, brand
// tint, large text); agency replies stay quiet, indented rows.
function FbComment({ c, locked, onToggle }) {
  const resBtn = !locked && (
    <button className="res" onClick={onToggle}>{c.resolved ? 'reopen' : 'resolve'}</button>
  )
  if (c.author_role === 'agency') return (
    <div className={'fb-cmt agency' + (c.resolved ? ' done' : '')}>
      <span className="rt ag">{BRAND.shortName || BRAND.name}</span>
      <b>{c.author_name || '—'}</b>
      <span className="cx">{c.body}</span>
      {resBtn}
    </div>
  )
  return (
    <div className={'fb-cmt client' + (c.resolved ? ' done' : '')}>
      <span className="fb-ava" aria-hidden="true">{(c.author_name || 'C').trim().slice(0, 2).toUpperCase()}</span>
      <div className="fb-cmt-main">
        <div className="fb-cmt-meta">
          <b>{c.author_name || 'Client'}</b>
          <span className="rt cl">Client</span>
          {c.created_at && <span className="muted sm">{new Date(c.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>}
        </div>
        <span className="cx">{c.body}</span>
      </div>
      {resBtn}
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
  const rev = data.review                       // fresh status (polled), not the list snapshot
  const locked = rev.status === 'accepted'
  const approved = sections.filter((s) => s.status === 'approved').length
  const gComments = comments.filter((c) => c.section_key === '__general__')

  async function acceptNow() {
    if (await acceptReviewRow({ id: rev.id, status: rev.status }, load)) { /* stays on page, reloads */ }
  }
  async function reopenNow() {
    await reopenReviewRow({ id: rev.id }, load)
  }

  async function reply(key) {
    const b = (drafts[key] || '').trim()
    if (!b) return
    setDrafts((d) => ({ ...d, [key]: '' }))
    await supabase.rpc('rpc_add_comment', { p_token: token, p_section_key: key, p_author_name: BRAND.shortName || BRAND.name, p_author_role: 'agency', p_body: b })
    load()
  }
  async function setStatus(key, st) {
    const { error } = await supabase.rpc('rpc_set_status', { p_token: token, p_section_key: key, p_status: st, p_author_name: BRAND.shortName || BRAND.name })
    if (error) await supabase.rpc('rpc_set_status', { p_token: token, p_section_key: key, p_status: st })
    load()
  }
  async function toggle(id) { await supabase.rpc('rpc_toggle_resolve', { p_token: token, p_comment_id: id }); load() }
  function copyLink(lang) {
    try {
      navigator.clipboard.writeText(clientLink(token, lang))
      toast(lang === 'es' ? 'Spanish client link copied' : 'English client link copied')
    } catch { toast('Copy failed') }
  }
  function copyReport() {
    const out = [review.title, `${approved}/${sections.length} sections approved`, '']
    if (gComments.length > 0) {
      out.push('General feedback:')
      gComments.forEach((c) =>
        out.push(`   • [${c.author_role === 'agency' ? (BRAND.shortName || BRAND.name) : 'Client'} ${c.author_name || ''}${c.resolved ? ' · resolved' : ''}] ${c.body}`))
      out.push('')
    }
    sections.forEach((s, i) => {
      out.push(`${i + 1}. ${s.name} — ${label(s.status).toUpperCase()}${s.status !== 'pending' && s.status_by ? ` (by ${s.status_by})` : ''}`)
      comments.filter((c) => c.section_key === s.section_key).forEach((c) =>
        out.push(`   • [${c.author_role === 'agency' ? (BRAND.shortName || BRAND.name) : 'Client'} ${c.author_name || ''}${c.resolved ? ' · resolved' : ''}] ${c.body}`))
    })
    try { navigator.clipboard.writeText(out.join('\n')); toast('Report copied') } catch { toast('Copy failed') }
  }
  // Build a self-contained Markdown "change brief": LLM framing + per-section
  // feedback + the full current page HTML, ready to paste into a model to drive
  // edits. Mirrors copyReport's author-role formatting.
  function buildBrief() {
    const statusText = rev.status === 'accepted' ? 'Accepted (final)'
      : rev.status === 'completed'
        ? (rev.client_decision === 'revision_requested' ? 'Completed — client requested a new version'
          : rev.client_decision === 'approved' ? 'Completed — client approved the content' : 'Completed by client')
        : 'In review'
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
    if (gComments.length > 0) {
      out.push('### General feedback (page-level, not tied to one section)')
      gComments.forEach((c) =>
        out.push(`- [${c.author_role === 'agency' ? (BRAND.shortName || BRAND.name) : 'Client'} ${c.author_name || ''}${c.resolved ? ' · resolved' : ''}] ${c.body}`))
      out.push('')
    }
    sections.forEach((s, i) => {
      out.push(`### ${i + 1}. ${s.name} (id: \`${s.section_key}\`) — ${label(s.status).toUpperCase()}${s.status !== 'pending' && s.status_by ? ` (by ${s.status_by})` : ''}`)
      if (s.blurb) out.push(`_${s.blurb}_`)
      const cs = comments.filter((c) => c.section_key === s.section_key)
      if (cs.length === 0) out.push('_No comments._')
      else cs.forEach((c) =>
        out.push(`- [${c.author_role === 'agency' ? (BRAND.shortName || BRAND.name) : 'Client'} ${c.author_name || ''}${c.resolved ? ' · resolved' : ''}] ${c.body}`))
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
      <button className="back" onClick={back}>‹ Reviews</button>
      <div className="fb-head">
        <div>
          <h1>{review.title} <StatusBadge status={rev.status} decision={rev.client_decision} /></h1>
          <div className="muted">
            <span className={'type-tag ' + (review.content_type || 'landing_page')}>{typeLabel(review.content_type)}</span> · {review.client_name || '—'}
            {locked && rev.accepted_at && <> · accepted {new Date(rev.accepted_at).toLocaleDateString()}</>}
          </div>
        </div>
        <div className="fb-actions">
          <span className="prog2"><span className="bar"><span style={{ width: (approved / sections.length * 100) + '%' }} /></span>{approved}/{sections.length} approved</span>
          <span className="copy-split">
            <span className="copy-split-label">Copy link</span>
            <button className="btn lite" onClick={() => copyLink('en')} title="Copy English client link">EN</button>
            <button className="btn lite" onClick={() => copyLink('es')} title="Copy Spanish client link">ES</button>
          </span>
          <button className="btn lite" onClick={copyReport}>Copy report</button>
          <button className="btn lite" onClick={downloadBrief}>Download change brief</button>
          {!locked
            ? <button className="btn brand" onClick={acceptNow} title="Finalize: this content will be used to build the live page">✓ Accept content</button>
            : <button className="btn ghost" onClick={reopenNow}>Reopen review</button>}
        </div>
      </div>
      {locked && (
        <div className="accepted-note">
          This review is finalized — the approved content is being used to build the live page.
          The client link is locked; reopen the review to collect more feedback.
        </div>
      )}
      <div className="fb-sections">
        {(gComments.length > 0 || !locked) && (
          <div className="fb-sec">
            <div className="fb-sec-h">
              <span className="badge pending">Page-level</span>
              <b>General feedback</b>
            </div>
            <div className="fb-cmts">
              {gComments.length === 0 && <div className="muted sm">No general comments.</div>}
              {gComments.map((c) => (
                <FbComment key={c.id} c={c} locked={locked} onToggle={() => toggle(c.id)} />
              ))}
              {!locked && (
                <div className="reply">
                  <input className="inp" placeholder={`Reply as ${BRAND.shortName || BRAND.name}…`} value={drafts['__general__'] || ''}
                    onChange={(e) => setDrafts((d) => ({ ...d, ['__general__']: e.target.value }))}
                    onKeyDown={(e) => e.key === 'Enter' && reply('__general__')} />
                  <button className="btn lite" onClick={() => reply('__general__')}>Send</button>
                </div>
              )}
            </div>
          </div>
        )}
        {sections.map((s, i) => {
          const cs = comments.filter((c) => c.section_key === s.section_key)
          return (
            <div className="fb-sec" key={s.section_key}>
              <div className="fb-sec-h">
                <span className={'badge ' + s.status}>{label(s.status)}</span>
                <b>{i + 1}. {s.name}</b>
                {s.status !== 'pending' && s.status_by && (
                  <span className="muted sm">by {s.status_by}{s.status_at ? ` · ${new Date(s.status_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : ''}</span>
                )}
                {!locked && (
                  <div className="fb-st">
                    <button className="mini ap" onClick={() => setStatus(s.section_key, 'approved')}>Approve</button>
                    <button className="mini ch" onClick={() => setStatus(s.section_key, 'changes')}>Changes</button>
                    <button className="mini pe" onClick={() => setStatus(s.section_key, 'pending')}>Reset</button>
                  </div>
                )}
              </div>
              <div className="fb-cmts">
                {cs.length === 0 && <div className="muted sm">No comments.</div>}
                {cs.map((c) => (
                  <FbComment key={c.id} c={c} locked={locked} onToggle={() => toggle(c.id)} />
                ))}
                {!locked && (
                  <div className="reply">
                    <input className="inp" placeholder={`Reply as ${BRAND.shortName || BRAND.name}…`} value={drafts[s.section_key] || ''}
                      onChange={(e) => setDrafts((d) => ({ ...d, [s.section_key]: e.target.value }))}
                      onKeyDown={(e) => e.key === 'Enter' && reply(s.section_key)} />
                    <button className="btn lite" onClick={() => reply(s.section_key)}>Send</button>
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
