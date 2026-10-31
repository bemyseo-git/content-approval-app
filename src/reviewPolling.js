// Keep one polling loop per mounted review, including across visibility and
// connectivity changes while a request is still in flight.
export function startReviewPolling(sync, {
  document: doc = document, window: win = window, navigator: nav = navigator,
  schedule = setTimeout, cancel = clearTimeout,
} = {}) {
  let active = true
  let timer
  let generation = 0
  const available = () => active && !doc.hidden && nav.onLine !== false

  async function poll() {
    const current = ++generation
    cancel(timer)
    if (!available() || !sync.canPoll()) return
    await sync.refresh(false)
    if (available() && sync.canPoll() && current === generation) {
      timer = schedule(poll, sync.delay())
    }
  }

  doc.addEventListener('visibilitychange', poll)
  win.addEventListener('online', poll)
  win.addEventListener('offline', poll)
  poll()
  return () => {
    active = false
    generation++
    cancel(timer)
    doc.removeEventListener('visibilitychange', poll)
    win.removeEventListener('online', poll)
    win.removeEventListener('offline', poll)
  }
}
