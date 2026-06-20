import { useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { BRAND } from './brand.js'
import ClientReview from './pages/ClientReview.jsx'
import Admin from './pages/Admin.jsx'

export default function App() {
  useEffect(() => {
    const c = BRAND.colors
    const r = document.documentElement.style
    r.setProperty('--brand', c.brand)
    r.setProperty('--brand-dk', c.brandDk)
    r.setProperty('--accent', c.accent)
    r.setProperty('--nav', c.nav)
    r.setProperty('--nav-dk', c.navDk)
    r.setProperty('--ink', c.ink)
    r.setProperty('--slate', c.slate)
    r.setProperty('--line', c.line)
    r.setProperty('--paper', c.paper)
    r.setProperty('--ok', c.ok)
    r.setProperty('--warn', c.warn)
    document.title = BRAND.name + ' · ' + BRAND.product
  }, [])

  return (
    <Routes>
      <Route path="/" element={<Navigate to="/admin" replace />} />
      <Route path="/admin" element={<Admin />} />
      <Route path="/r/:token" element={<ClientReview />} />
      <Route path="*" element={<div className="center-msg">Page not found.</div>} />
    </Routes>
  )
}
