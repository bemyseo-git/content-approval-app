# Product

## Register

product

## Users

Two audiences share one tool:

- **BeMySEO team (agency)** — sign in at `/admin` to create reviews, paste a deliverable's HTML, send a client link, and read/answer feedback. They live in this screen between drafts and sign-off.
- **Clients** — open a tokenized link (`/r/<token>`), no login. Non-technical marketing/business owners (e.g. a dental practice) who scan a page, approve or request changes per section, and leave comments. Often a first-and-only visit.

## Product Purpose

A content review & approval workflow for a marketing agency. It turns the messy "feedback over email/PDF" loop into a single shared surface: the client sees the actual rendered deliverable, marks each section, and the agency tracks approvals to sign-off. Success = a client completes a review quickly and confidently, and the agency knows exactly what to implement.

## Brand Personality

Confident, modern, precise. The agency voice is warm but expert — "we've got this." Three words: **sharp, trustworthy, effortless**. The interface should feel like a premium SaaS tool the client is mildly impressed by, not a form they endure.

## Anti-references

- Generic admin-template look (Bootstrap cards, gray-on-gray, default blurple).
- Heavy/decorative dashboards with widgets the client doesn't need.
- Anything that makes a non-technical client feel they're "using software" — no jargon, no dense settings.

## Design Principles

1. **The client journey is the product.** The review link is the agency's handshake; it must feel polished and obvious without instruction.
2. **Status is the spine.** Pending / Approved / Changes is the core vocabulary — keep it legible and consistent everywhere it appears.
3. **Earned familiarity.** Standard affordances (buttons, badges, threads) done cleanly beat invented ones. The tool disappears into the task.
4. **Brand moments, restrained surfaces.** BeMySEO blue carries actions and identity; content surfaces stay calm so the deliverable is the hero.

## Accessibility & Inclusion

- WCAG AA: body text ≥4.5:1, badges/large text ≥3:1, visible focus rings on all interactive elements.
- Respect `prefers-reduced-motion` for the few animations (checkmark, reveals).
- Status never relies on color alone — always paired with a text label.
