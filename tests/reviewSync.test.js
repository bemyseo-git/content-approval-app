import test from 'node:test'
import assert from 'node:assert/strict'
import { createReviewSync } from '../src/reviewSync.js'

const initial = {
  version: '9007199254740993', page_version: '1',
  review: { id: 'review', status: 'in_review', page_html: '<section>Large HTML</section>', page_url: null },
  sections: [], comments: [],
}

test('unchanged polls preserve the snapshot and send lossless version cursors', async () => {
  const requests = []
  const updates = []
  const sync = createReviewSync(async (name, params) => {
    requests.push({ name, params })
    return { data: requests.length === 1 ? initial : { unchanged: true } }
  }, 'token', true, (data) => updates.push(data), () => {})
  await sync.refresh()
  await sync.refresh(false)
  assert.equal(updates.length, 1)
  assert.equal(requests[1].params.p_version, '9007199254740993')
  assert.equal(requests[1].params.p_page_version, '1')
})

test('feedback-only refreshes retain HTML, and changed pages replace it (including null)', async () => {
  const replies = [initial, { ...initial, version: '2', review: { id: 'review', status: 'completed' } },
    { ...initial, version: '3', page_version: '2', review: { id: 'review', status: 'in_review', page_html: null, page_url: 'https://example.com' } }]
  const updates = []
  const sync = createReviewSync(async () => ({ data: replies.shift() }), 'token', true,
    (data) => updates.push(data), () => {})
  await sync.refresh()
  await sync.refresh()
  assert.equal(updates[1].review.page_html, initial.review.page_html)
  assert.equal(sync.delay(), 120000)
  await sync.refresh()
  assert.equal(updates[2].review.page_html, null)
  assert.equal(updates[2].review.page_url, 'https://example.com')
})

test('overlapping polls are deduplicated; a post-mutation refresh queues another read', async () => {
  let resolve
  let calls = 0
  const sync = createReviewSync(() => {
    calls++
    return calls === 1 ? new Promise((r) => { resolve = r }) : Promise.resolve({ data: { unchanged: true } })
  }, 'token', true, () => {}, () => {})
  const first = sync.refresh(false)
  assert.equal(sync.refresh(false), first)
  assert.equal(calls, 1)
  sync.refresh()
  resolve({ data: initial })
  await first
  assert.equal(calls, 2)
})

test('errors back off without discarding data and recover on the next read', async () => {
  const replies = [{ data: initial }, { error: { message: 'Offline' } }, { data: { unchanged: true } }]
  const errors = []
  let updates = 0
  const sync = createReviewSync(async () => replies.shift(), 'token', true,
    () => updates++, (error) => errors.push(error))
  await sync.refresh()
  await sync.refresh(false)
  assert.equal(sync.delay(), 60000)
  assert.equal(updates, 1)
  await sync.refresh(false)
  assert.equal(sync.delay(), 30000)
  assert.deepEqual(errors, [null, 'Offline', null])
})

test('admin requests exclude page content', async () => {
  const sync = createReviewSync(async (_name, params) => {
    assert.equal(params.p_include_page, false)
    return { data: { ...initial, review: { id: 'review', status: 'in_review' } } }
  }, 'token', false, (data) => assert.equal(data.review.page_html, undefined), () => {})
  await sync.refresh()
})

test('finalized reviews preserve lifecycle metadata and use slower polling', async () => {
  const data = {
    ...initial,
    review: { ...initial.review, status: 'accepted', client_decision: 'approved',
      accepted_at: '2026-10-31T12:00:00Z', due_date: '2026-11-01', content_type: 'blog' },
    sections: [{ section_key: 'intro', status: 'approved', status_by: 'Client', status_at: '2026-10-31T11:00:00Z' }],
  }
  const updates = []
  const sync = createReviewSync(async () => ({ data }), 'token', true,
    (next) => updates.push(next), () => {})
  await sync.refresh()
  assert.deepEqual(updates[0], data)
  assert.equal(sync.delay(), 120000)
})

test('missing migration downloads legacy HTML once and disables automatic full-page polling', async () => {
  const calls = []
  const sync = createReviewSync(async (name) => {
    calls.push(name)
    return name === 'rpc_sync_review' ? { error: { code: 'PGRST202' } } : { data: initial }
  }, 'token', true, () => {}, () => {})
  await sync.refresh(false)
  await sync.refresh(false)
  await sync.refresh(false)
  assert.deepEqual(calls, ['rpc_sync_review', 'rpc_get_review'])
  await sync.refresh() // A user's mutation still updates the screen.
  assert.equal(calls.length, 3)
})

test('invalid tokens report not_found instead of retaining deleted review access', async () => {
  const errors = []
  const sync = createReviewSync(async () => ({ data: null }), 'invalid', true,
    (data) => assert.equal(data, null), (error) => errors.push(error))
  await sync.refresh()
  assert.deepEqual(errors, ['not_found'])
  assert.equal(sync.canPoll(), false)
})

test('deleted reviews clear previously loaded data and stop background reads', async () => {
  const updates = []
  let calls = 0
  const sync = createReviewSync(async () => ({ data: ++calls === 1 ? initial : null }),
    'token', true, (data) => updates.push(data), () => {})
  await sync.refresh()
  await sync.refresh(false)
  await sync.refresh(false)
  assert.equal(calls, 2)
  assert.deepEqual(updates, [initial, null])
})

test('an hour of unchanged review checks transfers the HTML only once', async () => {
  let bytes = 0
  let calls = 0
  const page = { ...initial, review: { ...initial.review, page_html: 'x'.repeat(1024 * 1024) } }
  const sync = createReviewSync(async () => {
    const data = ++calls === 1 ? page : { unchanged: true }
    bytes += Buffer.byteLength(JSON.stringify(data))
    return { data }
  }, 'token', true, () => {}, () => {})
  await sync.refresh()
  for (let i = 0; i < 120; i++) await sync.refresh(false)
  const previousBytes = 361 * Buffer.byteLength(JSON.stringify(page))
  assert.ok(bytes < previousBytes * 0.003, 'Over 99.7% less JSON body data for this unchanged 1 MiB fixture')
})
