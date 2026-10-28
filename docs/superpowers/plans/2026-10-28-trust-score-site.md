# Trust Score Site Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship trust.fannarmaximus.com: an explainer for the Trust Equation plus a two-person sealed mutual-scoring flow, live on Cloudflare.

**Architecture:** One Cloudflare Worker serves static HTML/CSS/JS from `public/` and a three-endpoint JSON API under `/api/`. Session state lives in a single D1 table; two random 128-bit tokens per session act as the only credentials. Pure scoring/state logic sits in `src/session.js` with no I/O so it can be unit-tested; `src/store.js` wraps D1; `src/api.js` maps HTTP to those two.

**Tech Stack:** Cloudflare Workers with static assets, D1, wrangler 4.154, vitest 4.1 + `@cloudflare/vitest-plugin` 1.4, vanilla HTML/CSS/JS (no build step), self-hosted Cormorant Garamond + Inter.

**Spec:** `docs/superpowers/specs/2026-10-28-trust-score-site-design.md`

## Global Constraints

- Formula: `T = (C + R + I) / S`; each of C, R, I, S is an integer 1–10; T ranges 0.3–30, shown to one decimal.
- Self-orientation is entered as self-focus: label on every S input reads "1 = all about you, 10 = all about them" (when rating them) and "1 = all about them, 10 = all about you" (when predicting their rating of you).
- Names: trimmed, 1–40 characters, required. Rendered only via `textContent`, never `innerHTML`.
- Nothing numerical is returned to either party until both have submitted.
- Tokens: 16 random bytes from `crypto.getRandomValues`, base64url, no padding (22 chars).
- Expiry: 90 days after creation. Expired behaves exactly like unknown.
- Rate limit: more than 20 session creations per IP per hour → 429. IP stored only as a SHA-256 hex hash.
- Palette: light bg `#f7f6f3` / text `#111111`; dark bg `#111111` / text `#f7f6f3`; accent `#4FC3F7` used only for large numerals, rules, active controls and link underlines.
- Fonts: Cormorant Garamond (headings, formula, big numbers), Inter (everything else), self-hosted in `public/fonts/` with `OFL.txt`.
- Visible reference line under the four factors: "The Trust Equation comes from *The Trusted Advisor* (Maister, Green & Galford, 2000)." linking to https://trustedadvisor.com/equation.
- No framework, no bundler, no analytics, no cookies; `localStorage` only for the theme choice.
- Wrangler config mirrors `~/github/fannarmaximus.com`: `wrangler.jsonc`, `main: src/worker.js`, `assets.directory: ./public`, `assets.binding: ASSETS`, zone route `trust.fannarmaximus.com/*` (not `custom_domain`).
- Commit after every task. Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Review Focus

1. Scores sent as `"7"`, `7.5`, `0`, `11` or missing keys must be rejected with 400, never coerced. (Task 2 tests `validateScores`.)
2. A creator posting their own token to `/score` must get 403 and must not overwrite anything. (Task 4.)
3. Malformed or non-JSON bodies must return 400 with a JSON error, not a 500. (Task 4.)
4. A token that is expired must return 404 identical to an unknown token, and the page must show the calm "expired or doesn't exist" state. (Task 3 and Task 7.)
5. Names containing `<script>` must appear as literal text on the invitee and reveal pages. (Task 7, manual check with a crafted name.)

---

### Task 1: Project scaffold, D1 database, Worker that serves assets

**Files:**
- Create: `.gitignore`, `package.json`, `wrangler.jsonc`, `vitest.config.js`, `migrations/0001_sessions.sql`, `src/http.js`, `src/worker.js`, `public/index.html` (placeholder), `test/apply-migrations.js`, `test/worker.test.js`

**Interfaces:**
- Produces: `wrangler.jsonc` bindings `ASSETS` (assets) and `DB` (D1, database_name `trust-sessions`). Worker default export `{ fetch(request, env, ctx) }`. Unknown `/api/*` path → `404` JSON `{ "error": "not_found" }`.

- [ ] **Step 1: Init git and npm**

```bash
cd /Users/fomaximus/github/trust.fannarmaximus.com
git init -b main
printf 'node_modules\n.wrangler\n.dev.vars\n' > .gitignore
npm init -y
npm i -D wrangler@^4.154.0 vitest@^4.1.0 @cloudflare/vitest-plugin@^1.4.0
```

Then set `package.json` to `"type": "module"`, `"private": true`, scripts `dev: wrangler dev --host localhost`, `deploy: wrangler deploy`, `test: vitest run`.

- [ ] **Step 2: Create the D1 database and capture its id**

Run: `npx wrangler d1 create trust-sessions`
Expected: output containing `database_id`. Copy it into `wrangler.jsonc` in the next step.

- [ ] **Step 3: Write `wrangler.jsonc`**

```jsonc
{
	"$schema": "./node_modules/wrangler/config-schema.json",
	"name": "trust-fannarmaximus-com",
	"main": "src/worker.js",
	"compatibility_date": "2026-10-28",
	"assets": {
		"directory": "./public",
		"binding": "ASSETS",
		"run_worker_first": ["/api/*", "/s/*"]
	},
	"d1_databases": [
		{ "binding": "DB", "database_name": "trust-sessions", "database_id": "<from step 2>", "migrations_dir": "migrations" }
	],
	"routes": [
		{ "pattern": "trust.fannarmaximus.com/*", "zone_name": "fannarmaximus.com" }
	]
}
```

- [ ] **Step 4: Write the migration `migrations/0001_sessions.sql`**

```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  creator_token TEXT NOT NULL UNIQUE,
  invitee_token TEXT NOT NULL UNIQUE,
  creator_name TEXT NOT NULL,
  invitee_name TEXT NOT NULL,
  creator_scores TEXT NOT NULL,
  invitee_scores TEXT,
  invitee_submitted_at INTEGER,
  creator_ip_hash TEXT NOT NULL
);
CREATE INDEX sessions_ip_created ON sessions (creator_ip_hash, created_at);
CREATE INDEX sessions_expires ON sessions (expires_at);
```

`creator_scores` / `invitee_scores` hold JSON `{"given":{"c":n,"r":n,"i":n,"s":n},"predicted":{...}}`. Timestamps are Unix milliseconds.

- [ ] **Step 5: Write `vitest.config.js` and `test/apply-migrations.js`**

`vitest.config.js` (import `cloudflareTest` and `readD1Migrations` from `@cloudflare/vitest-plugin`; if `readD1Migrations` is not exported there, it lives in `@cloudflare/vitest-plugin/config`): `cloudflareTest(async () => ({ wrangler: { configPath: "./wrangler.jsonc" }, miniflare: { bindings: { TEST_MIGRATIONS: await readD1Migrations(path.join(import.meta.dirname, "migrations")) } } }))` and `test.setupFiles: ["./test/apply-migrations.js"]`.

`test/apply-migrations.js`: `import { applyD1Migrations } from "cloudflare:test"; import { env } from "cloudflare:workers"; await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);`

- [ ] **Step 6: Write the failing test `test/worker.test.js`**

```js
import { exports } from "cloudflare:workers";
import "../src/worker.js";
import { it, expect } from "vitest";

it("unknown api path is a JSON 404", async () => {
  const res = await exports.default.fetch("https://trust.test/api/nope");
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: "not_found" });
});
```

- [ ] **Step 7: Run it to verify it fails**

Run: `npm test`
Expected: FAIL (worker.js missing / no default export).

- [ ] **Step 8: Implement `src/worker.js`**

`export default { async fetch(request, env, ctx) }`: if pathname starts with `/api/` → return the JSON 404 for now; if pathname matches `^/s/[A-Za-z0-9_-]+$` → `env.ASSETS.fetch(new Request(new URL("/session.html", request.url), request))`; otherwise `env.ASSETS.fetch(request)`. Put helper `json(body, status = 200)` in `src/http.js`, returning a `Response` with `content-type: application/json; charset=utf-8` and `cache-control: no-store`; worker.js and later api.js both import it from there (avoids a circular import).

- [ ] **Step 9: Placeholder `public/index.html`** containing `<title>Trust</title>` and `<h1>T = (C + R + I) / S</h1>` so dev serves something.

- [ ] **Step 10: Run tests and dev server**

Run: `npm test` → PASS.
Run: `npx wrangler d1 migrations apply trust-sessions --local` → applies 1 migration.
Run: `npx wrangler dev --host localhost` in background, then `curl -s localhost:8787/ | head -3` → contains `T = (C + R + I) / S`; `curl -si localhost:8787/api/x | head -1` → `HTTP/1.1 404`. Stop dev server.

- [ ] **Step 11: Commit**

```bash
git add -A && git commit -m "chore: scaffold worker, d1 schema, test harness"
```

---

### Task 2: Pure session logic

**Files:**
- Create: `src/session.js`, `test/session.test.js`

**Interfaces:**
- Produces:
  - `validateName(raw) -> string` returns trimmed name or throws `ValidationError`.
  - `validateScores(raw) -> {given:{c,r,i,s}, predicted:{c,r,i,s}}` returns a fresh object with integer values or throws `ValidationError`.
  - `computeT({c,r,i,s}) -> number` rounded to one decimal.
  - `visibleState({ inviteeScores, expiresAt }, role, now) -> "waiting" | "needs_your_score" | "revealed"`; `role` is `"creator"` or `"invitee"`.
  - `class ValidationError extends Error { status = 400 }`.
  - `SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000`.

- [ ] **Step 1: Write the failing tests `test/session.test.js`**

```js
import { describe, it, expect } from "vitest";
import { validateName, validateScores, computeT, visibleState, ValidationError } from "../src/session.js";

describe("validateName", () => {
  it("trims and accepts 1–40 chars", () => expect(validateName("  Anna ")).toBe("Anna"));
  it.each(["", "   ", "x".repeat(41), 42, null])("rejects %p", (v) =>
    expect(() => validateName(v)).toThrow(ValidationError));
});

describe("validateScores", () => {
  const ok = { given: { c: 8, r: 7, i: 5, s: 8 }, predicted: { c: 1, r: 10, i: 10, s: 1 } };
  it("accepts integers 1–10", () => expect(validateScores(ok)).toEqual(ok));
  it.each([
    ["string digit", { ...ok, given: { ...ok.given, c: "7" } }],
    ["float", { ...ok, given: { ...ok.given, c: 7.5 } }],
    ["zero", { ...ok, given: { ...ok.given, s: 0 } }],
    ["eleven", { ...ok, predicted: { ...ok.predicted, r: 11 } }],
    ["missing key", { given: { c: 1, r: 1, i: 1 }, predicted: ok.predicted }],
    ["missing block", { given: ok.given }],
    ["not an object", "nope"],
  ])("rejects %s", (_, v) => expect(() => validateScores(v)).toThrow(ValidationError));
  it("drops extra keys", () =>
    expect(validateScores({ ...ok, extra: 1, given: { ...ok.given, x: 9 } })).toEqual(ok));
});

describe("computeT", () => {
  it("matches the Imperial worked example", () => expect(computeT({ c: 8, r: 7, i: 5, s: 8 })).toBe(2.5));
  it("minimum is 0.3", () => expect(computeT({ c: 1, r: 1, i: 1, s: 10 })).toBe(0.3));
  it("maximum is 30", () => expect(computeT({ c: 10, r: 10, i: 10, s: 1 })).toBe(30));
});

describe("visibleState", () => {
  const open = { inviteeScores: null };
  const done = { inviteeScores: { given: {}, predicted: {} } };
  it("creator waits until invitee submits", () => expect(visibleState(open, "creator")).toBe("waiting"));
  it("invitee is asked to score", () => expect(visibleState(open, "invitee")).toBe("needs_your_score"));
  it("both see revealed after submit", () => {
    expect(visibleState(done, "creator")).toBe("revealed");
    expect(visibleState(done, "invitee")).toBe("revealed");
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npm test` → FAIL, module not found.

- [ ] **Step 3: Implement `src/session.js`** with the signatures above. `validateScores` must check `Number.isInteger(v) && v >= 1 && v <= 10` for each of the eight values and rebuild the object from only the four known keys.

- [ ] **Step 4: Run to verify pass** — `npm test` → all PASS.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: pure session validation, scoring and state"`

---

### Task 3: D1 store

**Files:**
- Create: `src/store.js`, `test/store.test.js`

**Interfaces:**
- Consumes: `SESSION_TTL_MS` from Task 2.
- Produces (all take `db` = `env.DB` as first arg):
  - `randomToken() -> string` (22-char base64url).
  - `createSession(db, { creatorName, inviteeName, creatorScores, creatorIpHash, now }) -> { id, creatorToken, inviteeToken }`.
  - `findByToken(db, token, now) -> null | { id, role: "creator"|"invitee", creatorName, inviteeName, creatorToken, inviteeToken, creatorScores, inviteeScores, expiresAt }` — returns `null` when unknown **or** `expiresAt <= now`. Scores are parsed JSON objects.
  - `submitInviteeScores(db, inviteeToken, scores, now, name = null) -> boolean` — `UPDATE ... SET invitee_scores = ?, invitee_submitted_at = ?, invitee_name = COALESCE(?, invitee_name) WHERE invitee_token = ? AND invitee_scores IS NULL`; returns `meta.changes === 1`.
  - `countRecentCreations(db, creatorIpHash, since) -> number`.
  - `deleteExpired(db, now) -> number` rows deleted.

- [ ] **Step 1: Write the failing tests `test/store.test.js`**

```js
import { env } from "cloudflare:workers";
import { describe, it, expect } from "vitest";
import { createSession, findByToken, submitInviteeScores, countRecentCreations, deleteExpired, randomToken } from "../src/store.js";
import { SESSION_TTL_MS } from "../src/session.js";

const scores = { given: { c: 8, r: 7, i: 5, s: 8 }, predicted: { c: 6, r: 6, i: 6, s: 6 } };
const now = 1_800_000_000_000;
const make = (ip = "hash-a", at = now) =>
  createSession(env.DB, { creatorName: "Anna", inviteeName: "Bjarni", creatorScores: scores, creatorIpHash: ip, now: at });

describe("store", () => {
  it("randomToken is 22 base64url chars and unique", () => {
    const a = randomToken(), b = randomToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{22}$/); expect(a).not.toBe(b);
  });
  it("creates a session findable by either token with the right role", async () => {
    const s = await make();
    const asCreator = await findByToken(env.DB, s.creatorToken, now);
    const asInvitee = await findByToken(env.DB, s.inviteeToken, now);
    expect(asCreator.role).toBe("creator"); expect(asInvitee.role).toBe("invitee");
    expect(asCreator.creatorScores).toEqual(scores); expect(asCreator.inviteeScores).toBeNull();
    expect(asCreator.expiresAt).toBe(now + SESSION_TTL_MS);
  });
  it("unknown token is null", async () => expect(await findByToken(env.DB, "nope", now)).toBeNull());
  it("expired token is null", async () => {
    const s = await make("h", now);
    expect(await findByToken(env.DB, s.creatorToken, now + SESSION_TTL_MS)).toBeNull();
  });
  it("invitee can submit exactly once", async () => {
    const s = await make();
    expect(await submitInviteeScores(env.DB, s.inviteeToken, scores, now + 1)).toBe(true);
    expect(await submitInviteeScores(env.DB, s.inviteeToken, scores, now + 2)).toBe(false);
    expect((await findByToken(env.DB, s.creatorToken, now)).inviteeScores).toEqual(scores);
  });
  it("creator token cannot be used to submit", async () => {
    const s = await make();
    expect(await submitInviteeScores(env.DB, s.creatorToken, scores, now)).toBe(false);
  });
  it("counts recent creations per ip hash", async () => {
    await make("ip-x", now); await make("ip-x", now - 1000); await make("ip-x", now - 7_200_000);
    expect(await countRecentCreations(env.DB, "ip-x", now - 3_600_000)).toBe(2);
  });
  it("deletes expired rows", async () => {
    const s = await make("ip-z", now - SESSION_TTL_MS - 1);
    expect(await deleteExpired(env.DB, now)).toBeGreaterThanOrEqual(1);
    expect(await findByToken(env.DB, s.creatorToken, 0)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npm test` → FAIL.

- [ ] **Step 3: Implement `src/store.js`** using `db.prepare(...).bind(...).first()/run()`. Session `id` is also `randomToken()`. Store scores with `JSON.stringify`, parse on read.

- [ ] **Step 4: Run to verify pass** — `npm test` → PASS.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: d1 session store"`

---

### Task 4: JSON API and routing

**Files:**
- Create: `src/api.js`, `test/api.test.js`
- Modify: `src/worker.js` (replace the `/api/` stub with `handleApi`)

**Interfaces:**
- Consumes: Task 2 validators and `visibleState`, `computeT`; Task 3 store functions; `json()` from `src/http.js`.
- Produces: `handleApi(request, env, now = Date.now()) -> Promise<Response>` for:
  - `POST /api/sessions` body `{ creatorName, inviteeName, given, predicted }` → `201 { creatorToken, inviteeToken }`; `400 { error: "invalid", message }`; `429 { error: "rate_limited" }` when `countRecentCreations(...) >= 20` in the last hour. IP hash = SHA-256 hex of `request.headers.get("cf-connecting-ip") ?? "unknown"`.
  - `GET /api/sessions/:token` → `200 { role, state, creatorName, inviteeName, inviteeToken? (creator only), reveal? }` where `reveal` is present only when state is `revealed`: `{ creator: { given, predicted, givenT, predictedT }, invitee: { same } }`. `givenT = computeT(given)`, `predictedT = computeT(predicted)`. `404 { error: "not_found" }`.
  - `POST /api/sessions/:token/score` body `{ name?, given, predicted }` → `200 { state: "revealed" }`; `403 { error: "wrong_role" }` if token is the creator's; `409 { error: "already_scored" }`; `404`; `400`. If `name` is present it is validated and passed as the `name` argument of `submitInviteeScores`, which sets `invitee_name` in the same `UPDATE`.
  - Any other `/api/*` → `404 { error: "not_found" }`. Non-JSON or unparsable body → `400 { error: "invalid" }`.

- [ ] **Step 1: Write the failing tests `test/api.test.js`**

```js
import { exports } from "cloudflare:workers";
import "../src/worker.js";
import { describe, it, expect } from "vitest";

const base = "https://trust.test";
const good = { creatorName: "Anna", inviteeName: "Bjarni", given: { c: 8, r: 7, i: 5, s: 8 }, predicted: { c: 6, r: 6, i: 6, s: 6 } };
const post = (path, body, ip = "1.1.1.1") =>
  exports.default.fetch(base + path, { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": ip }, body: typeof body === "string" ? body : JSON.stringify(body) });
const get = (path) => exports.default.fetch(base + path);
const create = async (ip) => (await post("/api/sessions", good, ip)).json();

describe("POST /api/sessions", () => {
  it("creates and returns two distinct tokens", async () => {
    const res = await post("/api/sessions", good);
    expect(res.status).toBe(201);
    const { creatorToken, inviteeToken } = await res.json();
    expect(creatorToken).toMatch(/^[A-Za-z0-9_-]{22}$/); expect(inviteeToken).not.toBe(creatorToken);
  });
  it("400 on bad scores", async () => expect((await post("/api/sessions", { ...good, given: { ...good.given, c: 0 } })).status).toBe(400));
  it("400 on malformed json", async () => {
    const res = await post("/api/sessions", "{not json");
    expect(res.status).toBe(400); expect((await res.json()).error).toBe("invalid");
  });
  it("429 after 20 creations from one ip in an hour", async () => {
    for (let n = 0; n < 20; n++) expect((await post("/api/sessions", good, "9.9.9.9")).status).toBe(201);
    expect((await post("/api/sessions", good, "9.9.9.9")).status).toBe(429);
  });
});

describe("GET /api/sessions/:token", () => {
  it("creator sees waiting, invitee link, and no numbers", async () => {
    const { creatorToken, inviteeToken } = await create();
    const body = await (await get(`/api/sessions/${creatorToken}`)).json();
    expect(body).toMatchObject({ role: "creator", state: "waiting", creatorName: "Anna", inviteeName: "Bjarni", inviteeToken });
    expect(JSON.stringify(body)).not.toMatch(/"given"|"predicted"/);
  });
  it("invitee sees needs_your_score and no creator token", async () => {
    const { inviteeToken } = await create();
    const body = await (await get(`/api/sessions/${inviteeToken}`)).json();
    expect(body.state).toBe("needs_your_score"); expect(body.inviteeToken).toBeUndefined(); expect(body.creatorToken).toBeUndefined();
  });
  it("404 for unknown token", async () => expect((await get("/api/sessions/zzzzzzzzzzzzzzzzzzzzzz")).status).toBe(404));
});

describe("POST /api/sessions/:token/score", () => {
  const mine = { given: { c: 9, r: 9, i: 9, s: 1 }, predicted: { c: 5, r: 5, i: 5, s: 5 } };
  it("reveals to both with totals", async () => {
    const { creatorToken, inviteeToken } = await create();
    expect((await post(`/api/sessions/${inviteeToken}/score`, mine)).status).toBe(200);
    for (const t of [creatorToken, inviteeToken]) {
      const body = await (await get(`/api/sessions/${t}`)).json();
      expect(body.state).toBe("revealed");
      expect(body.reveal.creator).toEqual({ given: good.given, predicted: good.predicted, givenT: 2.5, predictedT: 3 });
      expect(body.reveal.invitee).toEqual({ given: mine.given, predicted: mine.predicted, givenT: 27, predictedT: 3 });
    }
  });
  it("invitee may correct their name", async () => {
    const { creatorToken, inviteeToken } = await create();
    await post(`/api/sessions/${inviteeToken}/score`, { ...mine, name: "Bjarki" });
    expect((await (await get(`/api/sessions/${creatorToken}`)).json()).inviteeName).toBe("Bjarki");
  });
  it("403 for creator token", async () => {
    const { creatorToken } = await create();
    expect((await post(`/api/sessions/${creatorToken}/score`, mine)).status).toBe(403);
  });
  it("409 on second submit", async () => {
    const { inviteeToken } = await create();
    await post(`/api/sessions/${inviteeToken}/score`, mine);
    expect((await post(`/api/sessions/${inviteeToken}/score`, mine)).status).toBe(409);
  });
  it("404 unknown token", async () => expect((await post("/api/sessions/zzzzzzzzzzzzzzzzzzzzzz/score", mine)).status).toBe(404));
});
```

- [ ] **Step 2: Run to verify failure** — `npm test` → FAIL on the new file.

- [ ] **Step 3: Implement `src/api.js` and wire `handleApi` into `src/worker.js`**

Route by `request.method` and a regex on pathname (`^/api/sessions$`, `^/api/sessions/([A-Za-z0-9_-]{22})$`, `^/api/sessions/([A-Za-z0-9_-]{22})/score$`). Wrap the body in `try/catch`: `ValidationError` → 400, anything else → 500 `{ error: "server_error" }`. Every API response goes through `json()` so it carries `cache-control: no-store`.

- [ ] **Step 4: Run to verify pass** — `npm test` → PASS.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: sessions api with sealed reveal"`

---

### Task 5: Visual foundation and explainer page

**Files:**
- Create: `public/style.css`, `public/theme.js`, `public/fonts/CormorantGaramond[wght].ttf`, `public/fonts/Inter[opsz,wght].ttf`, `public/fonts/OFL.txt`, `public/favicon.svg`
- Modify: `public/index.html` (replace placeholder)

**Interfaces:**
- Produces: CSS custom properties `--bg`, `--fg`, `--accent`, `--muted`; classes `.wrap` (centred column, max-width 40rem, padding 1.5rem), `.formula` (display serif, clamp(2.5rem, 10vw, 5rem)), `.factor` (name + one-line meaning), `.button` (text button, accent underline), `.mode-toggle` (fixed top-right text button). `theme.js` sets `data-theme="light"|"dark"` on `<html>` from `localStorage.theme` or `prefers-color-scheme`, and exposes the toggle; every page includes `<script src="/theme.js"></script>` in `<head>` to avoid a flash.

- [ ] **Step 1: Fetch the fonts**

```bash
mkdir -p public/fonts && cd public/fonts
curl -fsSL -o 'CormorantGaramond[wght].ttf' 'https://raw.githubusercontent.com/google/fonts/main/ofl/cormorantgaramond/CormorantGaramond%5Bwght%5D.ttf'
curl -fsSL -o 'Inter[opsz,wght].ttf' 'https://raw.githubusercontent.com/google/fonts/main/ofl/inter/Inter%5Bopsz%2Cwght%5D.ttf'
curl -fsSL -o OFL.txt 'https://raw.githubusercontent.com/google/fonts/main/ofl/cormorantgaramond/OFL.txt'
file *.ttf
```

Expected: both reported as TrueType variable fonts. If a URL has moved, browse https://github.com/google/fonts/tree/main/ofl/ for the current path.

- [ ] **Step 2: Write `public/style.css` and `public/theme.js`** per the Interfaces block. Light/dark via `:root[data-theme="dark"]` overrides plus a `@media (prefers-color-scheme: dark)` fallback for `:root:not([data-theme])`. Range of allowed accent use is in Global Constraints. Inputs for scores are a row of ten `<label><input type="radio"></label>` styled as 2.25rem tappable circles, selected one filled with `--accent`; define that as `.scale` here so Tasks 6–7 only mark up.

- [ ] **Step 3: Write `public/index.html`** with this copy (headings in display serif):

- Formula hero: `T = (C + R + I) / S`, sub-line "The Trust Equation."
- Intro: "Trust isn't one thing. It's three things that help, divided by one that hurts."
- **Credibility** — "Words. Can I believe what they say? Do they know their subject, and do they say 'I don't know' when they don't?"
- **Reliability** — "Actions. Can I depend on them? Do they do what they said, when they said?"
- **Intimacy** — "Safety. Can I tell them something that matters without it coming back to bite me?"
- **Self-orientation** — "Focus. How much of their attention is on themselves rather than on you? This one divides. High self-orientation undoes everything above it."
- Scale line: "Each factor is scored 1 to 10. The result runs from 0.3 to 30."
- Reference line (Global Constraints) with the link.
- Section "Score someone": "Rate a person you know, and guess how they'd rate you. They get a link, do the same, and nothing is shown until you've both finished." Button → `/new`.
- Mode toggle.

- [ ] **Step 4: Verify in dev**

Run: `npx wrangler dev --host localhost` (background). `curl -s localhost:8787/ | grep -c 'trustedadvisor.com/equation'` → `1`. `curl -sI 'localhost:8787/fonts/Inter%5Bopsz,wght%5D.ttf' | head -1` → `200`. Open in the browser (Claude in Chrome or manual) at phone width: no horizontal scroll, toggle flips theme and persists on reload. Stop dev server.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: explainer page, theme, fonts"`

---

### Task 6: Create flow

**Files:**
- Create: `public/new.html`, `public/form.js`, `public/new.js`

**Interfaces:**
- Consumes: `POST /api/sessions` (Task 4), `.scale` CSS (Task 5).
- Produces: `form.js` exports (as a classic script attaching to `window.TrustForm`): `renderScoreBlock(container, { prefix, heading, labels })` building four `.scale` rows for c/r/i/s with the heading and the S direction label; `readScoreBlock(container, prefix) -> {c,r,i,s} | null` (null if any unanswered). Labels object: `{ c, r, i, s }` one-liners reused from the explainer, with `s` text supplied by the caller (direction differs between "rate them" and "predict").

- [ ] **Step 1: Write `public/new.html`**

Heading "Score someone". Fields in the spec's order: your first name, their first name (both `maxlength="40"` `required`), block A "How you rate {them}" with S label "1 = all about you, 10 = all about them", block B "How you think {they} will rate you" with S label "1 = all about them, 10 = all about you", submit "Seal my scores". The `{them}` placeholders update live from the name field. A `<p class="error" hidden>` for server errors.

- [ ] **Step 2: Write `public/form.js` and `public/new.js`**

`new.js`: on submit, validate client-side (all eight answered, names non-empty), POST, then `location.href = "/s/" + creatorToken`. On 429 show "Too many sessions from this connection. Try again in an hour." On other errors show the server `message` or "Something went wrong."

- [ ] **Step 3: Verify in dev**

Dev server up. In the browser: fill the form, submit, land on `/s/<token>` (will show the Task 1 asset passthrough for now — `session.html` 404 is expected until Task 7). Confirm via `npx wrangler d1 execute trust-sessions --local --command 'select creator_name, invitee_name from sessions'` that the row exists. Submitting with a missing score keeps you on the page with the unanswered row highlighted.

- [ ] **Step 4: Commit** — `git add -A && git commit -m "feat: create session flow"`

---

### Task 7: Session page: waiting, invitee scoring, reveal

**Files:**
- Create: `public/session.html`, `public/session.js`

**Interfaces:**
- Consumes: `GET /api/sessions/:token`, `POST /api/sessions/:token/score` (Task 4); `window.TrustForm` (Task 6).

- [ ] **Step 1: Write `public/session.html`** with four `<section hidden>` blocks: `#waiting`, `#score`, `#reveal`, `#gone`; and `session.js` picks one from the API state.

- `#waiting` (creator): "Sealed. Send this to {inviteeName}:" the invitee URL in a read-only input with a "Copy" button; below in muted text "This page is yours. Keep the link; it opens the reveal once {inviteeName} has scored." Poll `GET` every 10 s; on `revealed` re-render.
- `#score` (invitee): "{creatorName} has scored you on the Trust Equation." One line linking to `/` "What is that?". Name field prefilled with `inviteeName` (editable, 40 max). Block "How you rate {creatorName}" and block "How you think {creatorName} rated you" with the same S labels as Task 6. Submit "Seal and reveal". 409 → re-fetch and render reveal.
- `#reveal`: heading "{creatorName} & {inviteeName}". Two columns on wide screens, stacked on phone. Column "What {A} gave {B}": the four factors each as "C 8" with the predicted value beside it in muted weight ("thought 6"), then T large in the accent with "predicted {n}" muted beneath. The mirror column. One closing line: "The gaps are the conversation."
- `#gone`: "This link has expired or doesn't exist." Link "Start a new one" → `/new`.

All names set via `textContent`.

- [ ] **Step 2: Write `public/session.js`**: token = last path segment; fetch state; render; poll while waiting; handle `#score` submit.

- [ ] **Step 3: Verify in dev (full walkthrough)**

Dev server up. In one browser profile create a session as `<b>Anna</b>` with invitee `Bjarni`; confirm the waiting page shows the name as literal text with angle brackets. Open the invitee link in a private window: form shows, submit; confirm reveal appears there and the creator tab flips to reveal within 10 s without a manual refresh. Check numbers against the API JSON. Visit `/s/zzzzzzzzzzzzzzzzzzzzzz` → the `#gone` state. Phone width: no horizontal scroll on any of the four states.

- [ ] **Step 4: Commit** — `git add -A && git commit -m "feat: session page with sealed reveal"`

---

### Task 8: Expiry cron, deploy, repo

**Files:**
- Modify: `wrangler.jsonc` (add `"triggers": { "crons": ["0 3 * * *"] }`), `src/worker.js` (add `scheduled`)
- Create: `README.md` (five lines: what it is, `npm run dev`, `npm test`, `npm run deploy`, migrations command)
- Test: `test/worker.test.js` (add one test)

**Interfaces:**
- Consumes: `deleteExpired` (Task 3).
- Produces: `scheduled(controller, env, ctx)` export that calls `deleteExpired(env.DB, Date.now())`.

- [ ] **Step 1: Add the failing test** to `test/worker.test.js`:

```js
import { env } from "cloudflare:workers";
import { createSession, findByToken } from "../src/store.js";
import { SESSION_TTL_MS } from "../src/session.js";
it("scheduled run deletes expired sessions", async () => {
  const old = Date.now() - SESSION_TTL_MS - 1;
  const s = await createSession(env.DB, { creatorName: "A", inviteeName: "B", creatorScores: { given: { c: 1, r: 1, i: 1, s: 1 }, predicted: { c: 1, r: 1, i: 1, s: 1 } }, creatorIpHash: "h", now: old });
  await exports.default.scheduled({ scheduledTime: Date.now(), cron: "0 3 * * *" }, env, { waitUntil() {} });
  expect(await findByToken(env.DB, s.creatorToken, 0)).toBeNull();
});
```

- [ ] **Step 2: Run** `npm test` → the new test FAILS. Implement `scheduled`, run again → PASS.

- [ ] **Step 3: Apply the migration remotely and deploy**

```bash
npx wrangler d1 migrations apply trust-sessions --remote
npm run deploy
```

Expected: deploy output lists the route `trust.fannarmaximus.com/*` and the cron trigger.

- [ ] **Step 4: Verify live**

```bash
curl -sI https://trust.fannarmaximus.com/ | head -1          # HTTP/2 200
curl -s https://trust.fannarmaximus.com/ | grep -c 'C + R + I'  # 1
curl -si https://trust.fannarmaximus.com/api/sessions/zzzzzzzzzzzzzzzzzzzzzz | head -1   # 404
```

Then one real end-to-end session in the browser against the live domain, phone width, both modes.

- [ ] **Step 5: Create the GitHub repo and push**

```bash
git add -A && git commit -m "feat: nightly expiry, readme, deploy"
gh repo create fomaximus/trust.fannarmaximus.com --private --source=. --remote=origin --push
```

Expected: `https://github.com/fomaximus/trust.fannarmaximus.com` exists with `main` pushed.
