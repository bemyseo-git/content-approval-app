import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './supabase.js'
import { createReviewSync } from './reviewSync.js'
import { startReviewPolling } from './reviewPolling.js'

// React StrictMode can mount twice while the initial request is still running.
// Share only in-flight reads; never persist review content or share tokens.
const reads = new Map()
function readOnce(name, params) {
  const key = JSON.stringify([name, params])
  if (!reads.has(key)) {
    const request = Promise.resolve(supabase.rpc(name, params))
      .finally(() => reads.delete(key))
    reads.set(key, request)
  }
  return reads.get(key)
}

export function useReviewData(token, includePage = true) {
  const [state, setState] = useState({ token, data: null, err: null })
  const syncRef = useRef(null)
  const load = useCallback(() => syncRef.current?.refresh(), [])

  useEffect(() => {
    let alive = true
    setState({ token, data: null, err: null })
    const sync = createReviewSync(
      readOnce, token, includePage,
      (data) => { if (alive) setState({ token, data, err: null }) },
      (err) => { if (alive) setState((s) => ({ ...s, token, err })) },
    )
    syncRef.current = sync
    const stopPolling = startReviewPolling(sync)
    return () => {
      alive = false
      stopPolling()
      if (syncRef.current === sync) syncRef.current = null
    }
  }, [token, includePage])

  return { data: state.token === token ? state.data : null, err: state.token === token ? state.err : null, load }
}
