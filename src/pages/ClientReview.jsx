import { useEffect, useRef, useState, useCallback } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { supabase } from '../supabase.js'
import { BRAND } from '../brand.js'
import { makeT, normalizeLang, statusLabel } from '../i18n.jsx'
import { appConfirm } from '../dialog.jsx'

// Injected into the page preview so reveal-animated / accordion content shows,
// and the page's own sticky chrome doesn't fight the review UI.
const OVERRIDE =
  '<style>.reveal{opacity:1!important;transform:none!important}.ans{max-height:none!important}' +
  'header.site{position:static!important}.mbar{display:none!important}body{padding-bottom:0!important}</style>'

const CHIP_CSS =
  '.rv-sec{cursor:pointer;transition:opacity .25s ease,box-shadow .2s ease}' +
  '.rv-sec:focus-visible{outline:3px solid #141B2E;outline-offset:-3px;border-radius:4px}' +
  '.rv-sec:hover{outline:2px solid rgba(19,98,252,.65);outline-offset:-3px;border-radius:4px}' +
  '.rv-chip{position:absolute;top:12px;right:12px;z-index:9999;display:inline-flex;align-items:center;gap:5px;' +
  'border:1px solid rgba(22,26,34,.12);background:rgba(255,255,255,.82);-webkit-backdrop-filter:saturate(1.8) blur(14px);backdrop-filter:saturate(1.8) blur(14px);' +
  'border-radius:999px;padding:6px 11px;font:600 12px/1 system-ui,sans-serif;' +
  'color:#161A22;cursor:pointer;box-shadow:inset 0 1px 0 rgba(255,255,255,.6),0 6px 18px -8px rgba(19,40,80,.45)}.rv-chip svg{width:13px;height:13px}' +
  '.rv-chip[data-status=approved]{background:#0C9648;border-color:#0C9648;color:#fff}' +
  '.rv-chip[data-status=changes]{background:#B5701A;border-color:#B5701A;color:#fff}' +
  '.rv-flash{animation:rvf 1.1s ease}@keyframes rvf{30%{box-shadow:inset 0 0 0 3px rgba(19,98,252,.9)}}' +
  // mobile section-stepper: leave room for the floating dock + spotlight the active section
  'body.rv-mobile{padding-bottom:196px!important}' +
  'body.rv-spot .rv-sec{opacity:.32}body.rv-spot .rv-sec.rv-active{opacity:1}' +
  '.rv-sec.rv-active{box-shadow:inset 0 0 0 2px rgba(19,98,252,.85)}'

const initials = (n) => (n || '?').trim().slice(0, 2).toUpperCase()
// Tidy a reviewer name: collapse whitespace, title-case all-lowercase words
// ("dr. jhon" -> "Dr. Jhon") while leaving intentional caps ("McDonald") alone.
const tidyName = (raw) => (raw || '').replace(/\s+/g, ' ').trim()
  .split(' ').map((w) => (w === w.toLowerCase() ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(' ')
const fmt = (ts) => { try { return new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) } catch { return '' } }
// Reserved comment bucket for page-level feedback not tied to one section.
const GENERAL_KEY = '__general__'

export default function ClientReview() {
  const { token } = useParams()
  const [searchParams] = useSearchParams()
  const lang = normalizeLang(searchParams.get('lang'))
  const t = makeT(lang)
  const label = (s) => statusLabel(t, s)
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)
  const [selected, setSelected] = useState(null)   // desktop sidebar detail
  const [active, setActive] = useState(null)        // mobile: section currently in focus
  const [cOpen, setCOpen] = useState(false)         // mobile: comment panel open
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width:820px)').matches)
  const [frameReady, setFrameReady] = useState(false)
  const [name, setName] = useState(() => tidyName(localStorage.getItem('bms_review_name') || ''))
  const [needName, setNeedName] = useState(() => !localStorage.getItem('bms_review_name'))
  const [draft, setDraft] = useState('')
  const [welcomeBack, setWelcomeBack] = useState(false)
  const [finishOpen, setFinishOpen] = useState(false) // finish-review choice modal
  const [linkNote, setLinkNote] = useState(false)     // "links are disabled" notice
  const [coachOpen, setCoachOpen] = useState(false)   // first-visit "how it works"
  const [warmOpen, setWarmOpen] = useState(false)     // warm arrival for returning-but-idle clients
  const warmRef = useRef(false)
  const [pv, setPv] = useState('desktop')             // preview viewport: desktop | mobile
  const [newByKey, setNewByKey] = useState(null)      // section_key -> agency updates since last visit
  const seenSnap = useRef(undefined)                  // last-visit timestamp, snapshotted once
  const linkNoteT = useRef(null)
  const frameRef = useRef(null)
  const injected = useRef(false)
  const welcomedRef = useRef(false)
  const isMobileRef = useRef(isMobile)
  isMobileRef.current = isMobile

  const load = useCallback(async () => {
    const { data: res, error } = await supabase.rpc('rpc_get_review', { p_token: token })
    if (error) { setErr(error.message || 'error'); return }
    if (!res) { setErr('not_found'); return }
    setData(res); setErr(null)
  }, [token])

  useEffect(() => { load() }, [load])
  useEffect(() => { const id = setInterval(load, 10000); return () => clearInterval(id) }, [load])
  useEffect(() => { document.documentElement.lang = lang }, [lang])

  // Track viewport so we can switch between the desktop two-pane and the
  // mobile section-stepper experiences.
  useEffect(() => {
    const mq = window.matchMedia('(max-width:820px)')
    const on = () => setIsMobile(mq.matches)
    mq.addEventListener ? mq.addEventListener('change', on) : mq.addListener(on)
    return () => { mq.removeEventListener ? mq.removeEventListener('change', on) : mq.removeListener(on) }
  }, [])

  // Default the mobile focus to the first section once data is in.
  useEffect(() => {
    if (data && data.sections.length && !active) setActive(data.sections[0].section_key)
  }, [data, active])

  // Crossing the mobile breakpoint keeps the same section in focus in the
  // other layout, so the dock and the sidebar detail never desync.
  const prevMobileRef = useRef(isMobile)
  useEffect(() => {
    if (prevMobileRef.current === isMobile) return
    prevMobileRef.current = isMobile
    if (isMobile) {
      if (selected) { setActive(selected); setCOpen(selected === GENERAL_KEY) }
    } else if (active) {
      setSelected(active)
    }
  }, [isMobile, selected, active])

  // "New since your last visit": snapshot the stored timestamp once, mark the
  // sections (and general feedback) with agency activity after it, then bump
  // the stored timestamp for next time.
  useEffect(() => {
    if (!data || newByKey !== null) return
    if (seenSnap.current === undefined) {
      seenSnap.current = localStorage.getItem('bms_seen_' + token)
      localStorage.setItem('bms_seen_' + token, new Date().toISOString())
    }
    const since = seenSnap.current
    const m = {}
    if (since) {
      data.comments.forEach((c) => {
        if (c.author_role !== 'agency') return
        if (new Date(c.created_at) <= new Date(since)) return
        m[c.section_key] = (m[c.section_key] || 0) + 1
      })
    }
    setNewByKey(m)
  }, [data, newByKey, token])

  // Greet returning clients who already have progress on this review (once per visit).
  useEffect(() => {
    if (welcomedRef.current || !data || newByKey === null) return
    const known = !!localStorage.getItem('bms_review_name')
    const hasProgress = data.sections.some((s) => s.status !== 'pending') ||
      data.comments.some((c) => c.author_role === 'client')
    if (known && hasProgress && data.review.status !== 'completed') {
      welcomedRef.current = true
      setWelcomeBack(true)
      const id = setTimeout(() => setWelcomeBack(false), 8000)
      return () => clearTimeout(id)
    }
  }, [data, newByKey])

  // Warm arrival: keeps reappearing on each visit until the client has made
  // any change on this review (a status or a comment). First-ever visitors get
  // it via the name modal instead.
  useEffect(() => {
    if (warmRef.current || !data || needName) return
    const finished = data.review.status === 'completed' || data.review.status === 'accepted'
    const hasProgress = data.sections.some((s) => s.status !== 'pending') ||
      data.comments.some((c) => c.author_role === 'client')
    if (!finished && !hasProgress) { warmRef.current = true; setWarmOpen(true) }
  }, [data, needName])

  // First-visit coach marks (once per browser); shown right after the welcome.
  useEffect(() => {
    if (!data || needName || warmOpen) return
    const finished = data.review.status === 'completed' || data.review.status === 'accepted'
    if (finished || localStorage.getItem('bms_coach_done')) return
    setCoachOpen(true)
  }, [data, needName, warmOpen])

  // Inject section markers + a scroll-spy observer into the preview once loaded.
  const onFrameLoad = () => {
    if (injected.current) { setFrameReady(true); return }
    const f = frameRef.current
    if (!f || !data) return
    let doc
    try { doc = f.contentDocument } catch { doc = null }
    if (!doc) return
    try {
      // Links/forms are inert in the preview; clicking one teaches the boundary
      // between the page being reviewed and the review tool itself.
      doc.addEventListener('click', (e) => {
        const a = e.target.closest && e.target.closest('a')
        if (a && !a.closest('.rv-chip')) {
          e.preventDefault()
          setLinkNote(true)
          clearTimeout(linkNoteT.current)
          linkNoteT.current = setTimeout(() => setLinkNote(false), 3200)
        }
      }, true)
      doc.addEventListener('submit', (e) => e.preventDefault(), true)
      const st = doc.createElement('style'); st.textContent = CHIP_CSS; doc.head.appendChild(st)
      // The page's own sticky/fixed chrome (proof banners, nav, etc.) just gets
      // in the way during review — drop it into normal flow so it scrolls away.
      try {
        doc.querySelectorAll('body *').forEach((el) => {
          const p = doc.defaultView.getComputedStyle(el).position
          if (p === 'fixed' || p === 'sticky') el.style.position = 'static'
        })
      } catch { /* best-effort */ }
      data.sections.forEach((s) => {
        const el = doc.getElementById(s.section_key)
        if (!el) return
        if (doc.defaultView.getComputedStyle(el).position === 'static') el.style.position = 'relative'
        el.classList.add('rv-sec')
        // Keyboard path: sections are review targets, so they must be reachable
        // and activatable without a mouse (Enter/Space mirrors click).
        el.setAttribute('tabindex', '0')
        el.setAttribute('role', 'button')
        el.setAttribute('aria-label', s.name || s.section_key)
        el.addEventListener('keydown', (ev) => {
          if (ev.key !== 'Enter' && ev.key !== ' ') return
          if (ev.target !== el) return
          ev.preventDefault()
          if (isMobileRef.current) setActive(s.section_key); else setSelected(s.section_key)
        })
        const chip = doc.createElement('button')
        chip.className = 'rv-chip'
        chip.setAttribute('data-rv', s.section_key)
        chip.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z"/></svg><span class="n"></span>'
        el.appendChild(chip)
        chip.addEventListener('click', (ev) => {
          ev.preventDefault(); ev.stopPropagation()
          if (isMobileRef.current) { setActive(s.section_key); setCOpen(true) } else setSelected(s.section_key)
        })
        el.addEventListener('click', () => { if (isMobileRef.current) setActive(s.section_key); else setSelected(s.section_key) })
      })

      // Scroll-spy: the section crossing the viewport's vertical centre is "active".
      const win = doc.defaultView
      if (win && win.IntersectionObserver) {
        const visible = new Set()
        const io = new win.IntersectionObserver((entries) => {
          entries.forEach((e) => { e.isIntersecting ? visible.add(e.target.id) : visible.delete(e.target.id) })
          const next = data.sections.find((s) => visible.has(s.section_key))
          if (next && isMobileRef.current) setActive(next.section_key)
        }, { root: null, rootMargin: '-45% 0px -45% 0px', threshold: 0 })
        data.sections.forEach((s) => { const el = doc.getElementById(s.section_key); if (el) io.observe(el) })
      }

      injected.current = true
      setFrameReady(true)
      updateChips()
    } catch { /* preview is best-effort; the bar/sidebar always work */ }
  }

  const updateChips = useCallback(() => {
    const f = frameRef.current
    if (!f || !data) return
    let doc
    try { doc = f.contentDocument } catch { return }
    if (!doc) return
    data.sections.forEach((s) => {
      let chip
      try { chip = doc.querySelector('[data-rv="' + window.CSS.escape(s.section_key) + '"]') } catch { chip = null }
      if (!chip) return
      chip.setAttribute('data-status', s.status)
      const n = data.comments.filter((c) => c.section_key === s.section_key).length
      const span = chip.querySelector('.n')
      if (span) { span.textContent = n ? n : ''; span.style.display = n ? 'inline' : 'none' }
    })
  }, [data])

  useEffect(() => { updateChips() }, [updateChips])

  // Toggle the mobile spotlight / bottom padding on the preview body.
  useEffect(() => {
    const f = frameRef.current
    if (!f) return
    let doc
    try { doc = f.contentDocument } catch { return }
    if (!doc || !doc.body) return
    doc.body.classList.toggle('rv-mobile', isMobile)
    doc.body.classList.toggle('rv-spot', isMobile)
  }, [isMobile, frameReady, data])

  // Highlight the active section inside the preview (mobile).
  useEffect(() => {
    if (!frameReady || !data) return
    const f = frameRef.current
    if (!f) return
    let doc
    try { doc = f.contentDocument } catch { return }
    if (!doc) return
    data.sections.forEach((s) => {
      const el = doc.getElementById(s.section_key)
      if (el) el.classList.toggle('rv-active', s.section_key === active)
    })
  }, [active, frameReady, data])

  // Scroll the preview to the selected section (desktop sidebar).
  useEffect(() => {
    if (!selected) return
    const f = frameRef.current
    if (!f) return
    let doc
    try { doc = f.contentDocument } catch { return }
    if (!doc) return
    const el = doc.getElementById(selected)
    if (!el) return
    try { el.scrollIntoView({ behavior: 'smooth', block: 'start' }) } catch { /* noop */ }
    el.classList.add('rv-flash')
    setTimeout(() => el.classList && el.classList.remove('rv-flash'), 1100)
  }, [selected])

  async function addComment(key) {
    const sec = key || selected
    if (!name) { setNeedName(true); return }
    const body = draft.trim()
    if (!body || !sec) return
    setDraft('')
    await supabase.rpc('rpc_add_comment', { p_token: token, p_section_key: sec, p_author_name: name, p_author_role: 'client', p_body: body })
    load()
  }
  async function setStatus(key, status) {
    const { error } = await supabase.rpc('rpc_set_status', { p_token: token, p_section_key: key, p_status: status, p_author_name: name })
    // Fallback for databases that haven't run the attribution migration yet.
    if (error) await supabase.rpc('rpc_set_status', { p_token: token, p_section_key: key, p_status: status })
    load()
  }
  async function toggleResolve(id) {
    await supabase.rpc('rpc_toggle_resolve', { p_token: token, p_comment_id: id })
    load()
  }
  // Clients can remove their own comments (server checks role + name).
  async function deleteComment(id) {
    const ok = await appConfirm({
      title: t('confirmDeleteComment'),
      body: t('confirmDeleteCommentBody'),
      okLabel: t('deleteShort'),
      cancelLabel: t('cancel'),
      danger: true,
    })
    if (!ok) return
    await supabase.rpc('rpc_delete_comment', { p_token: token, p_comment_id: id, p_author_name: name })
    load()
  }
  function closeCoach() {
    localStorage.setItem('bms_coach_done', '1')
    setCoachOpen(false)
  }
  async function setReviewStatus(status) {
    await supabase.rpc('rpc_set_review_status', { p_token: token, p_status: status })
    load()
  }
  function completeReview() { setFinishOpen(true) }
  // Finish with an explicit outcome: approve as-is, or ask for a new version.
  async function finishWith(decision) {
    const { error } = await supabase.rpc('rpc_complete_review', { p_token: token, p_decision: decision })
    // Fallback for databases that haven't run the decision migration yet.
    if (error) await supabase.rpc('rpc_set_review_status', { p_token: token, p_status: 'completed' })
    setFinishOpen(false)
    load()
  }
  function saveName() {
    const n = tidyName(document.getElementById('nm').value) || t('reviewer')
    localStorage.setItem('bms_review_name', n)
    setName(n); setNeedName(false)
  }

  // Move the mobile focus to a neighbouring stop (sections + general feedback)
  // and scroll the preview to it. The general stop opens straight into comments.
  function goSection(dir) {
    if (!data) return
    const i = stops.findIndex((s) => s.section_key === active)
    const j = i + dir
    if (j < 0 || j >= stops.length) return
    const key = stops[j].section_key
    setActive(key)
    setCOpen(key === GENERAL_KEY)
    if (key === GENERAL_KEY) return
    const f = frameRef.current
    let doc
    try { doc = f && f.contentDocument } catch { doc = null }
    const el = doc && doc.getElementById(key)
    if (el) try { el.scrollIntoView({ behavior: 'smooth', block: 'start' }) } catch { /* noop */ }
  }

  if (err === 'not_found') return <div className="center-msg">{t('invalid')}</div>
  if (err) return <div className="center-msg">{t('loadError')}<br />({err})</div>
  if (!data) return <div className="center-msg">{t('loading')}</div>

  const { sections, comments } = data
  const approved = sections.filter((s) => s.status === 'approved').length
  const changes = sections.filter((s) => s.status === 'changes').length
  const accepted = data.review.status === 'accepted'  // agency finalized — link is locked
  const done = data.review.status === 'completed' || accepted
  // Which path the client chose on completion ('approved' | 'revision_requested').
  const approvedFlow = !accepted && data.review.client_decision === 'approved'
  // Mobile stepper stops = sections + the general-feedback bucket at the end.
  const stops = [...sections, { section_key: GENERAL_KEY, name: t('generalTitle'), status: '', blurb: '' }]
  const gCount = comments.filter((c) => c.section_key === GENERAL_KEY).length
  const newTotal = newByKey ? Object.values(newByKey).reduce((a, b) => a + b, 0) : 0
  const isGeneral = selected === GENERAL_KEY
  const sel = isGeneral
    ? { section_key: GENERAL_KEY, name: t('generalTitle'), blurb: t('generalHint'), status: '' }
    : selected ? sections.find((s) => s.section_key === selected) : null
  const selIdx = selected && !isGeneral ? sections.findIndex((s) => s.section_key === selected) : -1
  const selComments = selected ? comments.filter((c) => c.section_key === selected) : []
  const act = active ? stops.find((s) => s.section_key === active) : null
  const actIdx = active ? stops.findIndex((s) => s.section_key === active) : -1
  const actComments = active ? comments.filter((c) => c.section_key === active) : []
  const actGeneral = active === GENERAL_KEY

  function approveAndNext() {
    if (actGeneral) return
    setStatus(active, 'approved')
    if (actIdx < stops.length - 1) setTimeout(() => goSection(1), 320)
  }
  // Desktop section-stepper: move the sidebar detail to a neighbouring section.
  // The [selected] effect scrolls the preview to it automatically.
  function goSelected(dir) {
    if (selIdx < 0) return
    const j = selIdx + dir
    if (j < 0 || j >= sections.length) return
    setSelected(sections[j].section_key)
  }
  function approveSelectedAndNext() {
    setStatus(selected, 'approved')
    if (selIdx < sections.length - 1) setTimeout(() => goSelected(1), 260)
    else setTimeout(() => setSelected(null), 260)
  }

  if (done) {
    return (
      <div className="ty-wrap">
        <div className="ty-card">
          <div className="ty-brand">
            {BRAND.logoDarkUrl ? <img src={BRAND.logoDarkUrl} alt={BRAND.name} className="logo-img" /> : <b>{BRAND.name}</b>}
          </div>
          <div className="ty-check" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
          </div>
          <h1>{accepted ? t('finalTitle', data.review.client_name) : t('tyTitle', data.review.client_name)}</h1>
          <p className="ty-lead">{accepted ? t('finalLead', data.review.title) : approvedFlow ? t('tyApprLead', data.review.title) : t('tyLead', data.review.title)}</p>
          <p className="ty-body">{accepted ? t('finalBody') : approvedFlow ? t('tyApprBody') : t('tyBody')}</p>

          <div className="ty-stats">
            <div className="ty-stat"><b>{approved}</b><span>{t('tyApproved')}</span></div>
            <div className="ty-stat"><b>{changes}</b><span>{t('tyChanges')}</span></div>
            <div className="ty-stat"><b>{comments.length}</b><span>{t('tyComments', comments.length)}</span></div>
          </div>

          {/* the client's own record of what they sent — visible every time
              they reopen the link after submitting */}
          <div className="ty-summary">
            <div className="ty-steps-h">{t('tySummaryH')}</div>
            <div className="ty-sum-list">
              {sections.map((s, i) => {
                const cs = comments.filter((c) => c.section_key === s.section_key && c.author_role === 'client')
                return (
                  <div className="ty-sum-row" key={s.section_key}>
                    <div className="ty-sum-t">
                      <span className="num">{String(i + 1).padStart(2, '0')}</span>
                      <b>{s.name}</b>
                      <span className={'badge ' + s.status}>{label(s.status)}</span>
                      {s.status !== 'pending' && s.status_by && <span className="who">· {s.status_by}</span>}
                    </div>
                    {cs.map((c) => (
                      <div className="ty-sum-c" key={c.id}>“{c.body}”{c.author_name ? <em> — {c.author_name}</em> : null}</div>
                    ))}
                  </div>
                )
              })}
              {comments.some((c) => c.section_key === GENERAL_KEY && c.author_role === 'client') && (
                <div className="ty-sum-row">
                  <div className="ty-sum-t"><span className="num">✳</span><b>{t('generalTitle')}</b></div>
                  {comments.filter((c) => c.section_key === GENERAL_KEY && c.author_role === 'client').map((c) => (
                    <div className="ty-sum-c" key={c.id}>“{c.body}”{c.author_name ? <em> — {c.author_name}</em> : null}</div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="ty-steps">
            <div className="ty-steps-h">{accepted ? t('finalNextH') : t('tyNextH')}</div>
            <ol>
              <li>{accepted ? t('finalStep1') : approvedFlow ? t('tyApprStep1') : t('tyStep1')}</li>
              <li>{accepted ? t('finalStep2') : approvedFlow ? t('tyApprStep2') : t('tyStep2')}</li>
              <li>{accepted ? t('finalStep3') : approvedFlow ? t('tyApprStep3') : t('tyStep3')}</li>
            </ol>
          </div>

          <p className="ty-contact">{t('tyContact', BRAND.supportEmail)}</p>

          {!accepted && (
            <>
              <p className="ty-continue">{t('tyContinue')}</p>
              <button className="ty-reopen" onClick={() => setReviewStatus('in_review')}>
                {t('tyReopen')}
              </button>
            </>
          )}

          <div className="ty-foot">{BRAND.poweredByLine}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="rv-app">
      {welcomeBack && !finishOpen && !needName && !warmOpen && !coachOpen && (
        <div className="rv-welcome" role="status">
          <span>{t('welcomeBack', name, newTotal)}</span>
          <button onClick={() => setWelcomeBack(false)} aria-label={t('dismiss')}>✕</button>
        </div>
      )}

      {linkNote && <div className="rv-linknote" role="status">{t('linkNote')}</div>}

      {(needName || warmOpen) && (
        <div className="ov">
          <div className="modal sm">
            <h2>{t('welcome', data.review.client_name)}</h2>
            <p className="welcome-meta">{t('welcomeMeta', sections.length, Math.max(2, Math.round(sections.length * 0.8)))}</p>
            <p className="muted">{t('namePrompt')}</p>
            <input id="nm" className="inp" defaultValue={name} placeholder={t('namePlaceholder')} onKeyDown={(e) => e.key === 'Enter' && (saveName(), setWarmOpen(false))} />
            <button className="btn brand full" onClick={() => { saveName(); setWarmOpen(false) }}>{t('startReviewing')}</button>
            <p className="privacy-note">{t('privacyNote', BRAND.shortName || BRAND.name)}</p>
          </div>
        </div>
      )}

      {coachOpen && !needName && (
        <div className="ov" onClick={closeCoach}>
          <div className="modal sm" onClick={(e) => e.stopPropagation()}>
            <h2>{t('coachTitle')}</h2>
            <div className="coach-steps">
              {[t('coachStep1'), t('coachStep2'), t('coachStep3')].map((s, i) => (
                <div className="coach-step" key={i}><span className="coach-num">{i + 1}</span><span>{s}</span></div>
              ))}
            </div>
            <button className="btn brand full" onClick={closeCoach}>{t('coachGotIt')}</button>
          </div>
        </div>
      )}

      {finishOpen && (
        <div className="ov" onClick={() => setFinishOpen(false)}>
          <div className="modal sm" onClick={(e) => e.stopPropagation()}>
            <h2>{t('finishTitle')}</h2>
            <p className="muted">{t('finishSummary', approved, changes, comments.length)}</p>
            <div className="finish-opts">
              {[
                { key: 'approved', cls: 'ok', title: t('optApprove'), sub: t('optApproveSub') },
                { key: 'revision_requested', cls: 'rev', title: t('optRevise'), sub: t('optReviseSub', changes) },
              ].map((o) => (
                <button key={o.key} className={'finish-opt ' + o.cls} onClick={() => finishWith(o.key)}>
                  <b>{o.title}</b>
                  <span>{o.sub}</span>
                </button>
              ))}
            </div>
            <button className="lnk center" onClick={() => setFinishOpen(false)}>{t('keepReviewing')}</button>
            <p className="finish-note">{t('autosaveNote')}</p>
            <p className="finish-note">{t('contactLine', BRAND.supportEmail)}</p>
          </div>
        </div>
      )}

      <header className="rv-bar">
        <div className="rv-brand">
          {BRAND.logoUrl ? <img src={BRAND.logoUrl} alt={BRAND.name} className="logo-img" /> : <b>{BRAND.name}</b>}
          <span className="sep">/</span>
          <span className="ttl">{data.review.title}</span>
        </div>
        <div className="rv-bar-r">
          {data.review.due_date && (
            <span className="rv-due">{t('dueBy', new Date(data.review.due_date + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' }))}</span>
          )}
          <div className="rv-prog">
            <div className="bar"><span style={{ width: (approved / sections.length * 100) + '%' }} /></div>
            <em>{t('progress', approved, sections.length)}</em>
          </div>
          <button className="rv-complete" onClick={completeReview}>{t('completeReview')}</button>
        </div>
      </header>

      <main className="rv-main">
        <section className={'rv-preview' + (pv === 'mobile' && !isMobile ? ' pvm' : '')}>
          {(data.review.page_html || data.review.page_url) && (
            <div className="rv-frame-bar">
              <span className="rv-dots" aria-hidden="true"><i /><i /><i /></span>
              <span className="rv-frame-label">{t('previewLabel')}</span>
              {!isMobile && (
                <span className="pv-toggle" role="group" aria-label="Preview size">
                  <button className={'pv-btn' + (pv === 'desktop' ? ' on' : '')} onClick={() => setPv('desktop')} title={t('pvDesktop')} aria-label={t('pvDesktop')}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" /></svg>
                  </button>
                  <button className={'pv-btn' + (pv === 'mobile' ? ' on' : '')} onClick={() => setPv('mobile')} title={t('pvMobile')} aria-label={t('pvMobile')}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="7" y="2" width="10" height="20" rx="2" /><path d="M11 18h2" /></svg>
                  </button>
                </span>
              )}
              <span className="rv-frame-hint">{t('previewHint')}</span>
            </div>
          )}
          {data.review.page_html
            ? <iframe ref={frameRef} title="Page preview" srcDoc={OVERRIDE + data.review.page_html} onLoad={onFrameLoad} />
            : data.review.page_url
              ? <iframe ref={frameRef} title="Page preview" src={data.review.page_url} />
              : <div className="center-msg">{t('noPage')}</div>}
        </section>

        {!isMobile && (
          <aside className="rv-side">
            {!sel ? (
              <>
                <div className="side-h">{t('sections')}</div>
                <p className="hint">{t('sectionsHint')}</p>
                <div className="list">
                  {sections.map((s, i) => {
                    const n = comments.filter((c) => c.section_key === s.section_key).length
                    const fresh = newByKey ? newByKey[s.section_key] || 0 : 0
                    return (
                      <button key={s.section_key} className="li" onClick={() => setSelected(s.section_key)}>
                        <div className="li-t">
                          <span className="num">{String(i + 1).padStart(2, '0')}</span>
                          <span className="li-n">{s.name}</span>
                          {fresh > 0 && <span className="new-badge">{t('newBadge')}</span>}
                          <span className={'dot ' + s.status} />
                        </div>
                        {s.blurb && <div className="li-b">{s.blurb}</div>}
                        <div className="li-f">
                          <span className={'badge ' + s.status}>{label(s.status)}</span>
                          {s.status !== 'pending' && s.status_by && <span className="who">· {s.status_by}</span>}
                          {n > 0 && <span className="cb">{t('comments', n)}</span>}
                        </div>
                      </button>
                    )
                  })}
                  <button className="li general" onClick={() => setSelected(GENERAL_KEY)}>
                    <div className="li-t">
                      <span className="num">✳</span>
                      <span className="li-n">{t('generalTitle')}</span>
                      {newByKey && (newByKey[GENERAL_KEY] || 0) > 0 && <span className="new-badge">{t('newBadge')}</span>}
                    </div>
                    <div className="li-b">{t('generalHint')}</div>
                    {gCount > 0 && <div className="li-f"><span className="cb">{t('comments', gCount)}</span></div>}
                  </button>
                </div>
                <p className="side-contact">{t('contactLine', BRAND.supportEmail)}</p>
              </>
            ) : (
              <div className="detail">
                <div className="detail-top">
                  <button className="back" onClick={() => setSelected(null)}>{t('allSections')}</button>
                  {!isGeneral && <span className="dstep-pos">{String(selIdx + 1).padStart(2, '0')} / {sections.length}</span>}
                </div>
                <h2>{sel.name}</h2>
                {sel.blurb && <p className="muted">{sel.blurb}</p>}
                {!isGeneral && (
                  <div className="st-row">
                    <button className={'stbtn ap' + (sel.status === 'approved' ? ' on' : '')} onClick={() => setStatus(sel.section_key, 'approved')}>{t('approve')}</button>
                    <button className={'stbtn ch' + (sel.status === 'changes' ? ' on' : '')} onClick={() => setStatus(sel.section_key, 'changes')}>{t('requestChanges')}</button>
                  </div>
                )}
                {!isGeneral && sel.status !== 'pending' && sel.status_by && (
                  <p className="status-by">{label(sel.status)} · {sel.status_by}{sel.status_at ? ` · ${fmt(sel.status_at)}` : ''}</p>
                )}
                <div className="thread">
                  {selComments.length === 0 && <div className="empty">{t('noCommentsYet')}</div>}
                  {selComments.map((c) => (
                    <div className={'cmt' + (c.resolved ? ' done' : '')} key={c.id}>
                      <div className={'av ' + (c.author_role === 'agency' ? 'ag' : 'cl')}>{initials(c.author_name)}</div>
                      <div className="cb2">
                        <div className="cmt-h">
                          <b>{c.author_name || t('reviewer')}</b>
                          <span className={'rt ' + (c.author_role === 'agency' ? 'ag' : 'cl')}>{c.author_role === 'agency' ? (BRAND.shortName || BRAND.name) : t('client')}</span>
                          <span className="tm">{fmt(c.created_at)}</span>
                          {c.author_role === 'client' && c.author_name === name && (
                            <button className="cmt-del" title={t('deleteComment')} onClick={() => deleteComment(c.id)}>✕</button>
                          )}
                        </div>
                        <div className="cx">{c.body}</div>
                        <button className="res" onClick={() => toggleResolve(c.id)}>{c.resolved ? t('reopen') : t('markResolved')}</button>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="composer">
                  <textarea value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={t('addComment')} rows={3} />
                  <button className="btn brand full" onClick={() => addComment(sel.section_key)}>{t('postComment')}</button>
                </div>
                {!isGeneral && (
                  <div className="detail-nav">
                    <button className="dnav-arrow" onClick={() => goSelected(-1)} disabled={selIdx <= 0} aria-label={t('prevSection')}>‹</button>
                    <button className="dnav-cta" onClick={approveSelectedAndNext}>
                      {selIdx < sections.length - 1 ? t('approveNext') : t('approveFinish')}
                    </button>
                    <button className="dnav-arrow" onClick={() => goSelected(1)} disabled={selIdx >= sections.length - 1} aria-label={t('nextSection')}>›</button>
                  </div>
                )}
              </div>
            )}
          </aside>
        )}
      </main>

      {isMobile && act && (
        <div className="rv-mobilewrap">
          {cOpen && (
            <div className="rv-cpanel">
              <div className="rv-cpanel-h">
                <b>{act.name}</b>
                <button className="rv-cclose" onClick={() => setCOpen(false)}>{t('done')}</button>
              </div>
              <div className="rv-thread">
                {actComments.length === 0 && <div className="empty">{t('noCommentsFirst')}</div>}
                {actComments.map((c) => (
                  <div className={'cmt' + (c.resolved ? ' done' : '')} key={c.id}>
                    <div className={'av ' + (c.author_role === 'agency' ? 'ag' : 'cl')}>{initials(c.author_name)}</div>
                    <div className="cb2">
                      <div className="cmt-h">
                        <b>{c.author_name || t('reviewer')}</b>
                        <span className={'rt ' + (c.author_role === 'agency' ? 'ag' : 'cl')}>{c.author_role === 'agency' ? (BRAND.shortName || BRAND.name) : t('client')}</span>
                        <span className="tm">{fmt(c.created_at)}</span>
                      </div>
                      <div className="cx">{c.body}</div>
                      <div className="cmt-h">
                        <button className="res" onClick={() => toggleResolve(c.id)}>{c.resolved ? t('reopen') : t('markResolved')}</button>
                        {c.author_role === 'client' && c.author_name === name && (
                          <button className="cmt-del" title={t('deleteComment')} onClick={() => deleteComment(c.id)}>✕</button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="composer">
                <textarea value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={t('addCommentFor', act.name)} rows={2} />
                <button className="btn brand full" onClick={() => addComment(active)}>{t('postComment')}</button>
              </div>
            </div>
          )}

          <div className="rv-mbar">
            <div className="rv-mbar-nav">
              <button className="rv-nav" onClick={() => goSection(-1)} disabled={actIdx <= 0} aria-label={t('prevSection')}>‹</button>
              <div className="rv-mbar-cur">
                <span className="rv-mbar-num">{actGeneral ? '✳' : `${String(actIdx + 1).padStart(2, '0')} / ${sections.length}`}</span>
                <span className="rv-mbar-name">{act.name}</span>
                {!actGeneral && <span className={'badge ' + act.status}>{label(act.status)}</span>}
              </div>
              <button className="rv-nav" onClick={() => goSection(1)} disabled={actIdx >= stops.length - 1} aria-label={t('nextSection')}>›</button>
            </div>
            <div className={'rv-mbar-act' + (actGeneral ? ' one' : '')}>
              {actGeneral ? (
                <button className="stbtn" onClick={() => setCOpen(true)}>{t('addGeneralComment')}{actComments.length > 0 ? ` (${actComments.length})` : ''}</button>
              ) : (
                <>
                  <button className={'stbtn ap' + (act.status === 'approved' ? ' on' : '')} onClick={approveAndNext}>{t('approve')}</button>
                  <button className={'stbtn ch' + (act.status === 'changes' ? ' on' : '')} onClick={() => { setStatus(active, 'changes'); setCOpen(true) }}>{t('changesShort')}</button>
                  <button className={'rv-cbtn' + (cOpen ? ' on' : '')} onClick={() => setCOpen((o) => !o)} aria-label={t('commentsLabel')}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z" /></svg>
                    {actComments.length > 0 && <i>{actComments.length}</i>}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
