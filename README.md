# BeMySEO Review

A branded, client-friendly **content review & approval** tool. Send a client a link, they approve each section of a page and leave comments, and everything is saved in your own database. You manage all reviews from an agency dashboard.

- **Client side** — `yourdomain.com/r/<token>` · no login, just a name. They see the page, approve/request-changes per section, and comment.
- **Agency side** — `yourdomain.com/admin` · sign in, create reviews (paste the deliverable HTML, sections auto-detect), copy the client link, read & reply to feedback.

**Stack:** React + Vite · Supabase (Postgres + Auth) · deploy on Vercel from GitHub.

---

## 1. Put it in your repo

This is a self-contained project. Either drop the whole `bemyseo-review/` folder into your existing repo (you'll set Vercel's *Root Directory* to it in step 4), or make it its own repo. Then:

```bash
cd bemyseo-review
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
3. If `bemyseo-review` is a **subfolder**, set **Root Directory** to `bemyseo-review`. Framework preset: **Vite** (build `npm run build`, output `dist`).
4. Add the two env vars (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) under **Settings → Environment Variables**.
5. Deploy. `vercel.json` already routes deep links (like `/r/<token>`) correctly, so client links work on refresh and when opened directly.

From then on, `git push` redeploys automatically.

---

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
4. **View feedback** any time in the dashboard: per-section statuses, all comments, a progress bar, reply as the agency, mark comments resolved, and **Copy report** for a plain-text summary to drop into Slack, email, or a ticket.

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

- Realtime comments (Supabase Realtime) instead of the current ~10s polling
- Email notifications when a client approves or comments
- Multi-page reviews (one link covering several deliverables)
- An "everything approved → lock the review" state and a signed-off PDF export
- Optional client-only approvals (currently both roles can set status)

---

Built for BeMySEO. Questions: `hello@bemyseo.com`.
