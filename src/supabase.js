import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !key) {
  console.warn('[BeMySEO Review] Missing Supabase env vars. Copy .env.example to .env and fill them in.')
}

export const supabase = createClient(url || 'http://localhost', key || 'missing-anon-key')
