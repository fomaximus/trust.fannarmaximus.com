# trust.fannarmaximus.com

Live at **https://trust.fannarmaximus.com**. Made by [Fannar Maximus](https://www.fannarmaximus.com).

The Trust Equation, T = (C + R + I) / S, explained, plus a two-person sealed mutual-scoring flow. Cloudflare Worker with static assets and a D1 database. Two-team mode: each team rates the other and guesses how it will be rated; nothing is shown until everyone on both sides has answered, then Min / Avg / Max next to Expected. Team mode: three to eight people rate the team, nothing is shown until everyone has, then Min / Avg / Max / You.

- `npm run dev` — local server on http://localhost:8787 (run `npx wrangler d1 migrations apply trust-sessions --local` once first)
- `npm test` — vitest in the Workers runtime
- `npm run deploy` — publish; apply schema changes first with `npx wrangler d1 migrations apply trust-sessions --remote`

Design: `docs/superpowers/specs/2026-10-28-trust-score-site-design.md` and `docs/superpowers/specs/2026-10-29-two-teams-design.md`
