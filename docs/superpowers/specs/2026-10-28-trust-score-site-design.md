# trust.fannarmaximus.com — design

Date: 2026-10-28
Status: approved by owner 2026-10-28; team mode added, see `2026-10-28-team-sessions-design.md`

## Intent

A small, quiet website that explains the Trust Equation and lets two people who
already know each other score each other with it. Each person scores the other
and also predicts how the other will score them. Nothing is revealed until both
have submitted. The reveal is meant to start a conversation between two
colleagues or friends, not to deliver a verdict.

Owner: Fannar Maximus. Domain: trust.fannarmaximus.com (already on Cloudflare).

## The Trust Equation (content the site must explain)

Source: *The Trusted Advisor* by David H. Maister, Charles H. Green and Robert
M. Galford (Free Press, 2000). The explainer page must carry a visible
reference line, e.g. "The Trust Equation comes from *The Trusted Advisor*
(Maister, Green & Galford, 2000)", with a link to
https://trustedadvisor.com/equation. Place it under the four factors, in the
quiet sans, not hidden in a footer.

    T = (C + R + I) / S

- **Credibility (C)** — words. "I can believe what they say." Expertise,
  honesty, saying "I don't know" when they don't.
- **Reliability (R)** — actions. "I can depend on them." Doing what they said,
  when they said, consistently.
- **Intimacy (I)** — safety. "I can tell them things." Emotional safety,
  discretion, not weaponising what you share.
- **Self-orientation (S)** — focus. "They're in it for themselves." The only
  factor in the denominator: how much attention is on them rather than on you.
  High S destroys trust even when C, R and I are strong.

Scoring convention (matches the published Trust Quotient): each factor rated
1–10. T therefore ranges from 0.3 to 30. Self-orientation is scored as the
amount of self-focus, so a low S number is good. The UI must make that
direction unmistakable.

Explainer copy may be written by the builder in this spirit: short, plain,
one or two sentences per factor plus one line on why S divides.

## Goals

1. Explain the four factors clearly enough that a first-time visitor can score
   someone within a minute of landing.
2. Two-person, sealed, mutual scoring with a single shareable link.
3. Feels minimal and a little artful. Near-white or near-black backgrounds,
   inverted text, dark and light mode.
4. Zero friction: no accounts, no email, no install.

## Non-goals

- Accounts, login, history of past sessions.
- Group or team sessions (exactly two people).
- Sending the invite for the user (they copy the link and send it however they
  like).
- Analytics, tracking, cookies beyond a theme preference.
- Editing a score after submitting.

## Anti-goals (what would make it a failure even if it works)

- Looks like a corporate HR assessment tool. No cards-with-shadows dashboards,
  no gauges, no badges.
- Either person can see the other's score before both have submitted.
- Clutter. If a screen has more than one thing to do, it's wrong.
- Scores being guessable or enumerable from a URL.

## User flow

1. **Home / explainer** — `/`
   Hero: the formula set large. Below it, the four factors. One button:
   "Score someone".

2. **Create** — `/new`
   Form, in this order:
   - Your first name (required, short).
   - Their first name (required, short).
   - Rate *them*: C, R, I, S — four inputs, 1–10 each. Each input shows the
     factor name, its one-line meaning, and for S the direction ("1 = all
     about you, 10 = all about them").
   - Predict how *they* will rate *you*: C, R, I, S — four inputs, 1–10.
   - Submit.
   On submit the server creates the session and returns two secret links.

3. **After creating** — the creator's own page `/s/<creatorToken>`
   Shows: "Send this to <their name>" with the invitee link and a copy button,
   and "This is your link, keep it" for their own. State: waiting for the other
   person. Nothing numerical shown.

4. **Invitee opens** — `/s/<inviteeToken>`
   "<Creator name> has scored you on the Trust Equation. Score them back to
   reveal both." Names are pre-filled (invitee can correct their own). Same
   form as step 2 minus the name fields' blankness: rate the creator (C,R,I,S)
   and predict the creator's rating of them. Submit.

5. **Reveal** — both `/s/<token>` pages once both have submitted
   Both people see the same reveal. For each direction:
   - What A gave B: C, R, I, S and T.
   - What B predicted A would give: C, R, I, S and T.
   - And the mirror.
   Present the gap between prediction and actual gently (e.g. side by side,
   predicted in a lighter weight) — no "you were wrong by 3" language.
   The reveal is the final state; it stays available at both links until the
   session expires.

Edge states the builder must handle:
- Invitee link opened after invitee already submitted → reveal (if both done)
  or "waiting for <creator>" (never; creator always submits first — but handle
  gracefully anyway).
- Unknown or expired token → a calm "this link has expired or doesn't exist"
  page with a link to start a new one.
- Double submit on the invitee form → reject the second, show the reveal.

## Visual design

- **Palette:** background near-white (e.g. `#f7f6f3`) / near-black (e.g.
  `#111111`); text the inverse. One accent for the T value, links and the
  active slider/number: Material Design Light Blue 300, `#4FC3F7` (owner's
  choice). On the near-white background it fails AA for small body text, so
  use it there only for large numerals, rules and interactive highlights, and
  keep link text in the foreground colour with an accent underline.
- **Modes:** follow `prefers-color-scheme`; a small text toggle ("dark" /
  "light") in a corner overrides and persists in localStorage.
- **Type:** (revised 2026-10-28 after the owner shared a reference) Inter only,
  self-hosted. Headings and the formula in weight 800 with tight tracking;
  subtitles in the muted grey; a short centred 1px rule; captions in a lighter
  grey. Everything centred, with a faint 1px rounded frame around the content
  on wide screens.
- **Layout:** single centred column, generous whitespace, max ~640px for text,
  phone-first. No boxes, no borders where whitespace will do.
- **Inputs:** range sliders 1–10 with the current value shown large next to
  the factor name, or a row of ten tappable numbers — builder's choice, but
  it must be easy on a phone with a thumb.

## Technical design

- **Hosting:** Cloudflare Worker with static assets (the current recommended
  path over Pages). Custom domain `trust.fannarmaximus.com` attached to the
  Worker.
- **Front end:** plain HTML, CSS and a little vanilla JS. No framework, no
  build step for the front end.
- **API (the Worker):**
  - `POST /api/sessions` — body: names + creator's eight numbers. Creates the
    session, returns `{ creatorToken, inviteeToken }`.
  - `GET /api/sessions/:token` — returns the state visible to that token's
    holder: `waiting`, `needs_your_score`, or `revealed` with full data. Never
    returns the other person's numbers unless state is `revealed`.
  - `POST /api/sessions/:token/score` — invitee submits their eight numbers.
    Rejected if that party has already submitted.
- **Tokens:** 128-bit random, base64url, generated server-side with
  `crypto.getRandomValues`. Two per session. Storage key is the session id;
  token → session id mapping stored alongside.
- **Storage:** Cloudflare D1 (one table `sessions`, plus a `tokens` table or
  two indexed token columns). Chosen over KV because reads must be strongly
  consistent: when the invitee submits, the creator refreshing a second later
  must see the reveal. Reveal pages may also poll every ~10s while waiting.
- **Validation:** names 1–40 chars; all eight numbers integers 1–10. Server
  validates; client mirrors.
- **Expiry:** sessions expire 90 days after creation (my call). A scheduled
  Worker cron or a cleanup-on-read deletes expired rows.
- **Rate limiting:** basic — reject more than ~20 session creations per IP per
  hour via Cloudflare's rate-limiting binding or a simple D1 counter. Enough
  to stop casual abuse, not more.
- **Deployment:** mirror the owner's existing site at `~/github/fannarmaximus.com`:
  `wrangler.jsonc` with `main: src/worker.js`, `assets: { directory: ./public,
  binding: ASSETS }`, a `routes` entry `{ pattern: "trust.fannarmaximus.com/*",
  zone_name: "fannarmaximus.com" }` (a proxied DNS record for the subdomain
  already exists and currently returns a 522 from a dead origin, so a zone
  route takes over its traffic in place, exactly as `www` does in the other
  project; do not use `custom_domain: true`, which fails when a record exists), `package.json` with
  `dev`/`deploy` scripts and wrangler 4.x as the only devDependency. Wrangler is
  already logged in on this machine (OAuth; see `wrangler whoami`), so
  `npm run deploy` publishes. Fonts in
  that project are self-hosted under `public/fonts` with the OFL licence file
  alongside; do the same here. Repo should be initialised as git (directory is
  currently not a repo) with a GitHub remote `fomaximus/trust.fannarmaximus.com`
  created with `gh` (logged in as fomaximus). Deploys run locally with
  `npm run deploy`, not via Workers Builds.
- **Scope of the build:** provisioning is in scope. The logged-in wrangler
  token has `workers (write)` and `d1 (write)`; the builder creates the D1
  database with `wrangler d1 create`, writes its real id into `wrangler.jsonc`,
  applies the schema with `wrangler d1 migrations apply`, and deploys. Done
  means live on https://trust.fannarmaximus.com, not just passing locally.
- **Rate limiting implementation:** use the D1 counter approach, not the
  `ratelimit` binding, so nothing depends on unsafe config. Tests: unit tests on the Worker's state machine
  (sealed → revealed logic, validation, double-submit).

## Left to the builder

- Exact explainer copy (within the spirit above).
- Slider vs number-row input.
- Whether `/new` is a separate page or an expanded section of `/`.
- Reveal page layout, subject to the "gentle gap" rule.
- Wrangler config details, D1 schema, test framework.
