// ============================================================================
//  App-styled replacements for the native browser dialogs (confirm / prompt).
//  Promise-based so plain async functions can `await appConfirm(...)` exactly
//  where they used to call window.confirm — no component state required.
//  Rendered on the existing glass-sheet modal styles (.ov / .modal.sm).
// ============================================================================
import { useEffect, useRef } from 'react'
import { createRoot } from 'react-dom/client'

// Mount a dialog in its own root, resolve once, then tear everything down.
function openDialog(render) {
  return new Promise((resolve) => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    let done = false
    const close = (value) => {
      if (done) return
      done = true
      resolve(value)
      // unmount after the current event finishes to keep React happy
      setTimeout(() => { root.unmount(); host.remove() }, 0)
    }
    root.render(render(close))
  })
}

function DialogShell({ title, body, onCancel, children }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onCancel() } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onCancel])
  return (
    <div className="ov" onClick={onCancel}>
      <div className="modal sm dlg" role="alertdialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        {body && <p className="dlg-body">{body}</p>}
        {children}
      </div>
    </div>
  )
}

function ConfirmBox({ title, body, okLabel, cancelLabel, danger, close }) {
  const okRef = useRef(null)
  useEffect(() => { okRef.current && okRef.current.focus() }, [])
  return (
    <DialogShell title={title} body={body} onCancel={() => close(false)}>
      <div className="dlg-actions">
        <button className="btn lite" onClick={() => close(false)}>{cancelLabel}</button>
        <button ref={okRef} className={'btn ' + (danger ? 'danger' : 'brand')} onClick={() => close(true)}>{okLabel}</button>
      </div>
    </DialogShell>
  )
}

function PromptBox({ title, body, defaultValue, placeholder, okLabel, cancelLabel, close }) {
  const inpRef = useRef(null)
  useEffect(() => { const i = inpRef.current; if (i) { i.focus(); i.select() } }, [])
  const submit = () => close(inpRef.current ? inpRef.current.value : null)
  return (
    <DialogShell title={title} body={body} onCancel={() => close(null)}>
      <input
        ref={inpRef}
        className="inp"
        defaultValue={defaultValue}
        placeholder={placeholder}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
      />
      <div className="dlg-actions">
        <button className="btn lite" onClick={() => close(null)}>{cancelLabel}</button>
        <button className="btn brand" onClick={submit}>{okLabel}</button>
      </div>
    </DialogShell>
  )
}

function SelectBox({ title, body, options, okLabel, cancelLabel, close }) {
  const selRef = useRef(null)
  useEffect(() => { selRef.current && selRef.current.focus() }, [])
  const submit = () => close(selRef.current ? selRef.current.value : null)
  return (
    <DialogShell title={title} body={body} onCancel={() => close(null)}>
      <select ref={selRef} className="inp" defaultValue={options[0] && options[0].value}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <div className="dlg-actions">
        <button className="btn lite" onClick={() => close(null)}>{cancelLabel}</button>
        <button className="btn brand" onClick={submit}>{okLabel}</button>
      </div>
    </DialogShell>
  )
}

// Drop-in for window.confirm: resolves true (confirm) / false (cancel, Esc,
// or backdrop click). Pass danger:true for destructive actions (red button).
export function appConfirm({ title, body = '', okLabel = 'OK', cancelLabel = 'Cancel', danger = false }) {
  return openDialog((close) => (
    <ConfirmBox title={title} body={body} okLabel={okLabel} cancelLabel={cancelLabel} danger={danger} close={close} />
  ))
}

// Drop-in for window.prompt: resolves the entered string, or null on cancel.
export function appPrompt({ title, body = '', defaultValue = '', placeholder = '', okLabel = 'Save', cancelLabel = 'Cancel' }) {
  return openDialog((close) => (
    <PromptBox title={title} body={body} defaultValue={defaultValue} placeholder={placeholder} okLabel={okLabel} cancelLabel={cancelLabel} close={close} />
  ))
}

// Pick-one dialog: resolves the chosen option's value, or null on cancel.
export function appSelect({ title, body = '', options = [], okLabel = 'Save', cancelLabel = 'Cancel' }) {
  return openDialog((close) => (
    <SelectBox title={title} body={body} options={options} okLabel={okLabel} cancelLabel={cancelLabel} close={close} />
  ))
}
