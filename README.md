# BeMySEO Review

A branded, client-friendly **content review & approval** tool. Send a client a link, they approve each section of a page and leave comments, and everything is saved in your own database. You manage all reviews from an agency dashboard.

- **Client side** — `yourdomain.com/r/<token>` · no login, just a name. They see the page, approve/request-changes per section, and comment.
- **Agency side** — `yourdomain.com/admin` · sign in, create reviews (paste the deliverable HTML, sections auto-detect), copy the client link, read & reply to feedback.

**Stack:** React + Vite · Supabase (Postgres + Auth) · deploy on Vercel from GitHub.

---

## 1. Install

This is a self-contained project — the app lives at the repo root. Clone it, then:

```bash
npm install
```

## 2. Set up Supabase (the database)

1. Create a project at [supabase.com](https://supabase.com) (free tier is fine).
2. Open **SQL Editor** → paste the entire contents of [`supabase/schema.sql`](supabase/schema.sql) → **Run**. This creates the tables, security policies, and the token-based functions clients use.
3. Create your first agency login: **Authentication → Users → Add user** (email + password, mark it confirmed). Repeat for each teammate.
4. Grab your keys from **Project Settings → API**: the **Project URL** and the **anon public** key.

## 3. Environment variables

```bash
cp .env.example .env
```

Fill in `.env`:

```
VITE_SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR-ANON-PUBLIC-KEY
```

> The anon key is **meant** to be public — it's safe in the browser. Security is enforced by Row Level Security and the `SECURITY DEFINER` functions, not by hiding the key.

Run it locally:

```bash
npm run dev
```

Open the printed URL, go to `/admin`, and sign in with the user you created.

## 4. Deploy to Vercel (from GitHub)

1. Push the repo to GitHub.
2. In Vercel: **Add New → Project → import your repo.**
3. Leave **Root Directory** at the repo root (`/`). Framework preset: **Vite** (build `npm run build`, output `dist`).
4. Add the two env vars (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) under **Settings → Environment Variables**.
5. Deploy. `vercel.json` already routes deep links (like `/r/<token>`) correctly, so client links work on refresh and when opened directly.

From then on, `git push` redeploys automatically.

---

## Reduce Supabase egress (existing projects)

1. In Supabase **SQL Editor**, run [`supabase/migration-egress.sql`](supabase/migration-egress.sql) before deploying this version. The migration preserves existing reviews and adds version tracking and two read functions. New projects already include it in `schema.sql`.
2. Deploy the updated frontend with the normal Vercel workflow.
3. Verify a client review, an agency reply, section approvals, comment resolution, completion/reopening, finalization, and both HTML and feedback downloads.
4. In browser developer tools, inspect Network responses for `rpc_sync_review`. The initial client response includes HTML; subsequent unchanged responses are `{"unchanged":true}`. Feedback changes include feedback without HTML. Changing the deliverable sends its new content once. Agency feedback responses omit HTML; Download HTML calls `rpc_get_review_page` on demand, while Download changes builds the feedback document from the loaded feedback.
5. Switch tabs or go offline: hidden/offline review tabs should make no new polling requests (an already-started request may finish). Returning to a visible, online tab checks for updates. Active reviews check every 30 seconds, completed reviews every 120 seconds, and failed reads back off up to five minutes. Your own mutations refresh immediately. Missing/deleted reviews stop automatic polling and clear previously loaded data.

The dashboard selects review metadata instead of downloading all deliverables, and review creation returns only the new ID. The frontend shares concurrent reads and retains the existing page preview during feedback updates and temporary network failures. No review content or tokens are added to persistent browser caches.

If the migration is missing, the frontend loads the old review RPC once and disables automatic polling to prevent repeated HTML downloads. Your own actions still refresh, but feedback from other people requires reopening/reloading the page until the migration is installed. A warning appears in the developer console.

Compare the project's **Usage → Egress** service breakdown before and after deployment over similar traffic periods. These changes target database/API traffic. This repository has no Supabase Storage downloads or Realtime subscriptions; if those services dominate your usage, investigate them separately. Assets referenced inside uploaded HTML can still download from their original hosts when a page is opened. Existing billed usage cannot be undone.

Run `npm test` for the synchronization regression tests and `npm run build` for the production build. The tests use mocked RPC responses; verify the migration and real responses in Supabase as part of rollout.

The regression suite includes a synthetic one-hour session with an unchanged 1 MiB HTML page: the old ten-second polling pattern returns approximately 361 MiB of JSON bodies, while the versioned thirty-second checks return approximately 1 MiB in total (over 99.7% less). This excludes HTTP headers, compression, other services, page assets, reloads, and feedback changes; it is not a measurement of production billing. Feedback changes still return all comments and sections, so very long threads and heavy collaboration can increase traffic.

For a read-only inventory of large deliverables, run [`supabase/egress-audit.sql`](supabase/egress-audit.sql) in SQL Editor. It reports stored HTML sizes and embedded-media indicators without returning the HTML or share tokens. Stored sizes are estimates of payload risk, not egress measurements. Check the actual service breakdown and usage trend after deployment; optimization does not guarantee staying under quota at any traffic level.

## Branding

Everything brand-related lives in [`src/brand.js`](src/brand.js):

- `name`, `product`, `tagline`, `supportEmail`
- `logoUrl` — leave empty for the **BeMySEO** wordmark, or point it at your logo
- `colors` — your real brand palette (applied as CSS variables app-wide)

Change those values and the whole tool re-skins. No other files need editing.

## How to run a review

1. **/admin → + New review.** Add a title and client name.
2. **Paste the deliverable HTML** (or upload the `.html` file). Sections are auto-detected from every `<section id="...">` on the page — edit their display names and add short descriptions.
3. **Create review → Copy client link → send it.** The client opens it, adds their name, and reviews. No account needed.
4. **View feedback** any time in the dashboard: per-section statuses, all comments, a progress bar, reply as the agency, mark comments resolved, **Copy report** for a plain-text summary to drop into Slack, email, or a ticket, and **Download change brief** for a self-contained Markdown file (per-section feedback + the full page HTML) ready to paste into an LLM as edit instructions.

> Tip: any element you want reviewable just needs an `id` (or a `data-review-section="key"` attribute). The section `key` in the dashboard must match that id.

## Data model

| Table | What it holds |
|---|---|
| `reviews` | One review per client page: title, client name, the page HTML, a unique share token, owner. |
| `review_sections` | The reviewable sections of a page, each with a status (`pending` / `approved` / `changes`). |
| `comments` | Threaded by section, tagged `client` or `agency`, with a `resolved` flag. |

## Security model (how no-login client links stay safe)

- Clients have **no direct database access**. They call four `SECURITY DEFINER` functions (`rpc_get_review`, `rpc_add_comment`, `rpc_set_status`, `rpc_toggle_resolve`), each of which validates the share token — so a link only ever touches its own review.
- Share tokens are random 32-char hex (unguessable, not enumerable).
- The agency side uses **Supabase Auth + Row Level Security**: you can only see and manage reviews you created (`created_by = auth.uid()`).

## Roadmap ideas

- Realtime comments (Supabase Realtime) instead of the current versioned polling
- Email notifications when a client approves or comments
- Multi-page reviews (one link covering several deliverables)
- An "everything approved → lock the review" state and a signed-off PDF export
- Optional client-only approvals (currently both roles can set status)

---

Built for BeMySEO. Questions: `connect@bemyseo.com`.
