// One request at a time. A refresh requested during a write/read is queued so
// the eventual read observes the completed write, rather than a stale snapshot.
export function createReviewSync(rpc, token, includePage, onData, onError) {
  let snapshot = null
  let pending = null
  let queued = false
  let legacy = false
  let failures = 0
  let notFound = false

  async function read() {
    const { data, error } = await rpc('rpc_sync_review', {
      p_token: token, p_version: snapshot?.version ?? null,
      p_page_version: snapshot?.page_version ?? null, p_include_page: includePage,
    })
    if (error) {
      // Old databases remain usable, but never repeatedly download HTML.
      // Deploy the migration to enable automatic feedback updates.
      if (error.code === 'PGRST202' && !snapshot) {
        const initial = await rpc('rpc_get_review', { p_token: token })
        if (initial.error) throw initial.error
        legacy = true
        console.warn('Apply supabase/migration-egress.sql to enable lightweight review refreshes.')
        return initial.data
      }
      throw error
    }
    return data
  }

  function refresh(manual = true) {
    if (pending) {
      if (manual) queued = true
      return pending
    }
    if (!manual && (legacy || notFound)) return Promise.resolve()
    pending = (async () => {
      do {
        queued = false
        try {
          const next = legacy
            ? await rpc('rpc_get_review', { p_token: token }).then(({ data, error }) => {
              if (error) throw error
              return data
            })
            : await read()
          if (!next) {
            notFound = true
            snapshot = null
            onData(null)
            throw new Error('not_found')
          }
          notFound = false
          if (!next.unchanged) {
            snapshot = { ...next, review: { ...snapshot?.review, ...next.review } }
            onData(snapshot)
          }
          failures = 0
          onError(null)
        } catch (error) {
          failures += 1
          onError(error.message || 'error')
        }
      } while (queued)
    })().finally(() => { pending = null })
    return pending
  }

  return {
    refresh,
    canPoll: () => !legacy && !notFound,
    delay: () => Math.min(300000, (['completed', 'accepted'].includes(snapshot?.review.status) ? 120000 : 30000) * 2 ** Math.min(failures, 4)),
  }
}
