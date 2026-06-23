import { useEffect, useRef, useState, useCallback } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { supabase } from '../supabase.js'
import { BRAND } from '../brand.js'
import { makeT, normalizeLang, statusLabel } from '../i18n.jsx'

// Injected into the page preview so reveal-animated / accordion content shows,
// and the page's own sticky chrome doesn't fight the review UI.
const OVERRIDE =
  '<style>.reveal{opacity:1!important;transform:none!important}.ans{max-height:none!important}' +
  'header.site{position:static!important}.mbar{display:none!important}body{padding-bottom:0!important}</style>'

const CHIP_CSS =
  '.rv-sec{cursor:pointer;transition:opacity .25s ease,box-shadow .2s ease}' +
  '.rv-sec:hover{outline:2px dashed rgba(23,176,160,.6);outline-offset:-3px}' +
  '.rv-chip{position:absolute;top:12px;right:12px;z-index:9999;display:inline-flex;align-items:center;gap:5px;' +
  'border:1px solid #d7e2dc;background:#fff;border-radius:999px;padding:5px 10px;font:600 12px/1 system-ui,sans-serif;' +
  'color:#15324B;cursor:pointer;box-shadow:0 5px 16px -7px rgba(0,0,0,.4)}.rv-chip svg{width:13px;height:13px}' +
  '.rv-chip[data-status=approved]{background:#1F9D6B;border-color:#1F9D6B;color:#fff}' +
  '.rv-chip[data-status=changes]{background:#E0902A;border-color:#E0902A;color:#fff}' +
  '.rv-flash{animation:rvf 1.1s ease}@keyframes rvf{30%{box-shadow:inset 0 0 0 3px rgba(23,176,160,.85)}}' +
  // mobile section-stepper: leave room for the bottom bar + spotlight the active section
  'body.rv-mobile{padding-bottom:172px!important}' +
  'body.rv-spot .rv-sec{opacity:.32}body.rv-spot .rv-sec.rv-active{opacity:1}' +
  '.rv-sec.rv-active{box-shadow:inset 0 0 0 2px rgba(19,98,252,.55)}'

const initials = (n) => (n || '?').trim().slice(0, 2).toUpperCase()
const fmt = (ts) => { try { return new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) } catch { return '' } }

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
  const [name, setName] = useState(() => localStorage.getItem('bms_review_name') || '')
  const [needName, setNeedName] = useState(() => !localStorage.getItem('bms_review_name'))
  const [draft, setDraft] = useState('')
  const [welcomeBack, setWelcomeBack] = useState(false)
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

  // Greet returning clients who already have progress on this review (once per visit).
  useEffect(() => {
    if (welcomedRef.current || !data) return
    const known = !!localStorage.getItem('bms_review_name')
    const hasProgress = data.sections.some((s) => s.status !== 'pending') ||
      data.comments.some((c) => c.author_role === 'client')
    if (known && hasProgress && data.review.status !== 'completed') {
      welcomedRef.current = true
      setWelcomeBack(true)
      const id = setTimeout(() => setWelcomeBack(false), 7000)
      return () => clearTimeout(id)
    }
  }, [data])

  // Inject section markers + a scroll-spy observer into the preview once loaded.
  const onFrameLoad = () => {
    if (injected.current) { setFrameReady(true); return }
    const f = frameRef.current
    if (!f || !data) return
    let doc
    try { doc = f.contentDocument } catch { doc = null }
    if (!doc) return
    try {
      doc.addEventListener('click', (e) => { const a = e.target.closest && e.target.closest('a'); if (a) e.preventDefault() }, true)
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
    await supabase.rpc('rpc_set_status', { p_token: token, p_section_key: key, p_status: status })
    load()
  }
  async function toggleResolve(id) {
    await supabase.rpc('rpc_toggle_resolve', { p_token: token, p_comment_id: id })
    load()
  }
  async function setReviewStatus(status) {
    await supabase.rpc('rpc_set_review_status', { p_token: token, p_status: status })
    load()
  }
  function completeReview() {
    const total = data.sections.length
    const left = total - data.sections.filter((s) => s.status === 'approved').length
    const msg = left > 0 ? t('confirmIncomplete', left, total) : t('confirmComplete')
    if (window.confirm(msg)) setReviewStatus('completed')
  }
  function saveName() {
    const n = (document.getElementById('nm').value || '').trim() || t('reviewer')
    localStorage.setItem('bms_review_name', n)
    setName(n); setNeedName(false)
  }

  // Move the mobile focus to a neighbouring section and scroll the preview to it.
  function goSection(dir) {
    if (!data) return
    const list = data.sections
    const i = list.findIndex((s) => s.section_key === active)
    const j = i + dir
    if (j < 0 || j >= list.length) return
    const key = list[j].section_key
    setActive(key); setCOpen(false)
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
  const done = data.review.status === 'completed'
  const sel = selected ? sections.find((s) => s.section_key === selected) : null
  const selComments = selected ? comments.filter((c) => c.section_key === selected) : []
  const act = active ? sections.find((s) => s.section_key === active) : null
  const actIdx = active ? sections.findIndex((s) => s.section_key === active) : -1
  const actComments = active ? comments.filter((c) => c.section_key === active) : []

  function approveAndNext() {
    setStatus(active, 'approved')
    if (actIdx < sections.length - 1) setTimeout(() => goSection(1), 320)
  }

  if (done) {
    return (
      <div className="ty-wrap">
        <div className="ty-card">
          <div className="ty-brand">
            {BRAND.logoUrl ? <img src={BRAND.logoUrl} alt={BRAND.name} className="logo-img" /> : <b>{BRAND.name}</b>}
          </div>
          <div className="ty-check" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
          </div>
          <h1>{t('tyTitle', data.review.client_name)}</h1>
          <p className="ty-lead">{t('tyLead', data.review.title)}</p>
          <p className="ty-body">{t('tyBody')}</p>

          <div className="ty-stats">
            <div className="ty-stat"><b>{approved}</b><span>{t('tyApproved')}</span></div>
            <div className="ty-stat"><b>{changes}</b><span>{t('tyChanges')}</span></div>
            <div className="ty-stat"><b>{comments.length}</b><span>{t('tyComments', comments.length)}</span></div>
          </div>

          <div className="ty-steps">
            <div className="ty-steps-h">{t('tyNextH')}</div>
            <ol>
              <li>{t('tyStep1')}</li>
              <li>{t('tyStep2')}</li>
              <li>{t('tyStep3')}</li>
            </ol>
          </div>

          <p className="ty-contact">{t('tyContact', BRAND.supportEmail)}</p>

          <button className="ty-reopen" onClick={() => setReviewStatus('in_review')}>
            {t('tyReopen')}
          </button>

          <div className="ty-foot">{BRAND.poweredByLine}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="rv-app">
      {welcomeBack && (
        <div className="rv-welcome" role="status">
          <span>{t('welcomeBack', name)}</span>
          <button onClick={() => setWelcomeBack(false)} aria-label={t('dismiss')}>✕</button>
        </div>
      )}

      {needName && (
        <div className="ov">
          <div className="modal sm">
            <h2>{t('welcome', data.review.client_name)}</h2>
            <p className="muted">{t('namePrompt')}</p>
            <input id="nm" className="inp" defaultValue={name} placeholder={t('namePlaceholder')} onKeyDown={(e) => e.key === 'Enter' && saveName()} />
            <button className="btn brand full" onClick={saveName}>{t('startReviewing')}</button>
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
          <div className="rv-prog">
            <div className="bar"><span style={{ width: (approved / sections.length * 100) + '%' }} /></div>
            <em>{t('progress', approved, sections.length)}</em>
          </div>
          <button className="rv-complete" onClick={completeReview}>{t('completeReview')}</button>
        </div>
      </header>

      <main className="rv-main">
        <section className="rv-preview">
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
                    return (
                      <button key={s.section_key} className="li" onClick={() => setSelected(s.section_key)}>
                        <div className="li-t">
                          <span className="num">{String(i + 1).padStart(2, '0')}</span>
                          <span className="li-n">{s.name}</span>
                          <span className={'dot ' + s.status} />
                        </div>
                        {s.blurb && <div className="li-b">{s.blurb}</div>}
                        <div className="li-f">
                          <span className={'badge ' + s.status}>{label(s.status)}</span>
                          {n > 0 && <span className="cb">{t('comments', n)}</span>}
                        </div>
                      </button>
                    )
                  })}
                </div>
              </>
            ) : (
              <div className="detail">
                <button className="back" onClick={() => setSelected(null)}>{t('allSections')}</button>
                <h2>{sel.name}</h2>
                {sel.blurb && <p className="muted">{sel.blurb}</p>}
                <div className="st-row">
                  <button className={'stbtn ap' + (sel.status === 'approved' ? ' on' : '')} onClick={() => setStatus(sel.section_key, 'approved')}>{t('approve')}</button>
                  <button className={'stbtn ch' + (sel.status === 'changes' ? ' on' : '')} onClick={() => setStatus(sel.section_key, 'changes')}>{t('requestChanges')}</button>
                </div>
                <div className="thread">
                  {selComments.length === 0 && <div className="empty">{t('noCommentsYet')}</div>}
                  {selComments.map((c) => (
                    <div className={'cmt' + (c.resolved ? ' done' : '')} key={c.id}>
                      <div className={'av ' + (c.author_role === 'agency' ? 'ag' : 'cl')}>{initials(c.author_name)}</div>
                      <div className="cb2">
                        <div className="cmt-h">
                          <b>{c.author_name || t('reviewer')}</b>
                          <span className={'rt ' + (c.author_role === 'agency' ? 'ag' : 'cl')}>{c.author_role === 'agency' ? BRAND.name : t('client')}</span>
                          <span className="tm">{fmt(c.created_at)}</span>
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
                        <span className={'rt ' + (c.author_role === 'agency' ? 'ag' : 'cl')}>{c.author_role === 'agency' ? BRAND.name : t('client')}</span>
                        <span className="tm">{fmt(c.created_at)}</span>
                      </div>
                      <div className="cx">{c.body}</div>
                      <button className="res" onClick={() => toggleResolve(c.id)}>{c.resolved ? t('reopen') : t('markResolved')}</button>
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
                <span className="rv-mbar-num">{String(actIdx + 1).padStart(2, '0')} / {sections.length}</span>
                <span className="rv-mbar-name">{act.name}</span>
                <span className={'badge ' + act.status}>{label(act.status)}</span>
              </div>
              <button className="rv-nav" onClick={() => goSection(1)} disabled={actIdx >= sections.length - 1} aria-label={t('nextSection')}>›</button>
            </div>
            <div className="rv-mbar-act">
              <button className={'stbtn ap' + (act.status === 'approved' ? ' on' : '')} onClick={approveAndNext}>{t('approve')}</button>
              <button className={'stbtn ch' + (act.status === 'changes' ? ' on' : '')} onClick={() => { setStatus(active, 'changes'); setCOpen(true) }}>{t('changesShort')}</button>
              <button className={'rv-cbtn' + (cOpen ? ' on' : '')} onClick={() => setCOpen((o) => !o)} aria-label={t('commentsLabel')}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z" /></svg>
                {actComments.length > 0 && <i>{actComments.length}</i>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
