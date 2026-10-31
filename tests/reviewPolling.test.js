import test from 'node:test'
import assert from 'node:assert/strict'
import { startReviewPolling } from '../src/reviewPolling.js'
import { createReviewSync } from '../src/reviewSync.js'

function environment() {
  const doc = new EventTarget()
  const win = new EventTarget()
  doc.hidden = false
  const nav = { onLine: true }
  const timers = new Map()
  let id = 0
  return {
    doc, win, nav, timers,
    options: {
      document: doc, window: win, navigator: nav,
      schedule: (callback, delay) => { timers.set(++id, { callback, delay }); return id },
      cancel: (key) => timers.delete(key),
    },
  }
}
const flush = () => new Promise((resolve) => setImmediate(resolve))

test('hidden and offline tabs stop polling; visibility and connectivity resume one loop', async () => {
  const env = environment()
  let calls = 0
  const stop = startReviewPolling({
    refresh: async () => { calls++ }, canPoll: () => true, delay: () => 30000,
  }, env.options)
  await flush()
  assert.equal(calls, 1)
  assert.equal(env.timers.size, 1)
  assert.equal([...env.timers.values()][0].delay, 30000)

  env.doc.hidden = true
  env.doc.dispatchEvent(new Event('visibilitychange'))
  assert.equal(env.timers.size, 0)
  env.nav.onLine = false
  env.win.dispatchEvent(new Event('offline'))
  env.doc.hidden = false
  env.doc.dispatchEvent(new Event('visibilitychange'))
  await flush()
  assert.equal(calls, 1)

  env.nav.onLine = true
  env.win.dispatchEvent(new Event('online'))
  await flush()
  assert.equal(calls, 2)
  assert.equal(env.timers.size, 1)
  stop()
  assert.equal(env.timers.size, 0)
  env.win.dispatchEvent(new Event('online'))
  await flush()
  assert.equal(calls, 2)
})

test('repeated wakeups during an in-flight request do not duplicate downloads or timers', async () => {
  const env = environment()
  let resolve
  let calls = 0
  const sync = createReviewSync(() => {
    calls++
    return new Promise((done) => { resolve = done })
  }, 'token', true, () => {}, () => {})
  const stop = startReviewPolling(sync, env.options)
  env.doc.hidden = true
  env.doc.dispatchEvent(new Event('visibilitychange'))
  env.doc.hidden = false
  env.doc.dispatchEvent(new Event('visibilitychange'))
  env.win.dispatchEvent(new Event('online'))
  assert.equal(calls, 1)
  resolve({ data: { version: '1', page_version: '1', review: { status: 'in_review' } } })
  await flush()
  assert.equal(env.timers.size, 1)
  stop()
})

test('unmount during an in-flight request cannot restart the polling loop', async () => {
  const env = environment()
  let resolve
  const stop = startReviewPolling({
    refresh: () => new Promise((done) => { resolve = done }),
    canPoll: () => true, delay: () => 30000,
  }, env.options)
  stop()
  resolve()
  await flush()
  assert.equal(env.timers.size, 0)
})

test('legacy databases and missing reviews do not leave a recurring timer', async () => {
  for (const reply of [{ data: null }, { error: { code: 'PGRST202' } }]) {
    const env = environment()
    const sync = createReviewSync(async (name) => name === 'rpc_sync_review' ? reply :
      { data: { review: { status: 'in_review' } } }, 'token', true, () => {}, () => {})
    const stop = startReviewPolling(sync, env.options)
    await flush()
    assert.equal(env.timers.size, 0)
    stop()
  }
})
