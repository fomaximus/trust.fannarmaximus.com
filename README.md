# trust.fannarmaximus.com

The Trust Equation, T = (C + R + I) / S, explained, plus a two-person sealed mutual-scoring flow. Cloudflare Worker with static assets and a D1 database.

- `npm run dev` — local server on http://localhost:8787 (run `npx wrangler d1 migrations apply trust-sessions --local` once first)
- `npm test` — vitest in the Workers runtime
- `npm run deploy` — publish; apply schema changes first with `npx wrangler d1 migrations apply trust-sessions --remote`

Design: `docs/superpowers/specs/2026-10-28-trust-score-site-design.md`
