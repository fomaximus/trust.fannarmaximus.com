# Team Sessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add team mode to trust.fannarmaximus.com: 3–8 people each rate the team, everyone sees who has answered, nothing is revealed until all remaining members have, then a Min / Avg / Max / You table.

**Architecture:** Mirrors the pair flow. Pure rules in `src/team.js`, D1 access in `src/teamstore.js`, HTTP in `src/teamapi.js` mounted by the Worker under `/api/teams`, and two static pages (`/team` create, `/t/<token>` member page) reusing `form.js`, `theme.js` and `style.css`. Two new tables plus a `team_stats` table; the existing `creations` log covers rate limiting.

**Tech Stack:** As the pair flow: Cloudflare Worker + static assets, D1, vitest 4 + `@cloudflare/vitest-plugin`, vanilla JS.

**Spec:** `docs/superpowers/specs/2026-10-28-team-sessions-design.md`

## Global Constraints

- Team size 3–8 including the creator: `members` body array of other names must have 2–7 entries after blanks are dropped. Duplicate nicknames within a team (case-insensitive, trimmed) → 400.
- Nicknames and team name: trimmed, 1–40 chars, via the existing `validateName`.
- Scores: the existing `validateScores`-style check on `{ given: {c,r,i,s} }` only; no `predicted` block in team mode.
- Self-orientation label on the team form: "1 = all about the work and each other, 10 = all about itself".
- Reveal only when `teams.revealed_at` is set; it is set the first time a read, a score or a removal finds every remaining member answered.
- A member's GET body never contains another member's numbers or token, in any state.
- Removal/leave refused (409) if the target has answered, or if the team would drop below three.
- Removed-name marker: `nickname = ''` and `token IS NULL`.
- Expiry 90 days (`SESSION_TTL_MS`); hourly cron anonymises revealed teams, removes unrevealed ones.
- Security headers, HTTPS redirect, JSON 404s, `cache-control: no-store` on the API, as already implemented.
- Commit after every task; messages end with the attribution lines in use for this repo.

## Review Focus

1. A creator who lists themselves again among the members ("Anna" + members ["Anna", "Bjarni"]) must get a 400 for duplicates, not a team with two Annas. (Task 1 `validateTeam` test.)
2. Two members submitting at the same moment as the last answers must not produce a half-revealed team: `markRevealed` must be idempotent and the reveal computed from stored scores. (Task 2 test: marking twice keeps the first timestamp.)
3. A member hitting the creator-only `remove` endpoint must get 403 and nothing must change. (Task 3.)
4. After a member removes their name post-reveal, the team's Min/Avg/Max must be unchanged and the who-answered list must show a blank entry, not crash on the empty nickname. (Task 3 test on aggregate after forget; Task 5 renders '' as "—".)
5. A creator removing a pending member on the creator's page must see the links list drop that member and, if that completed the team, the reveal appear without a reload. (Task 5 manual check.)

---

### Task 1: Migration and pure team rules

**Files:**
- Create: `migrations/0005_teams.sql`, `src/team.js`, `test/team.test.js`

**Interfaces:**
- Produces:
  - `TEAM_MIN = 3`, `TEAM_MAX = 8`.
  - `validateTeam(body) -> { teamName, creatorName, members: string[] }` (members = the other names, trimmed, blanks dropped) or throws `ValidationError`.
  - `validateTeamScores(body) -> { given: {c,r,i,s} }` or throws.
  - `allAnswered(members) -> boolean` over `{ scores }` rows.
  - `teamState({ revealedAt }, you) -> "revealed" | "waiting" | "needs_your_score"`.
  - `aggregate(members) -> { size, min:{c,r,i,s,t}, avg:{c,r,i,s,t}, max:{c,r,i,s,t} }` over members with scores; `t` per member is `computeT(scores.given)`; avg values rounded to one decimal.
  - `canRemove(members, memberId) -> { ok: true } | { ok: false, reason: "answered" | "too_small" | "not_found" | "creator" }`.

- [ ] **Step 1: Write `migrations/0005_teams.sql`**

```sql
CREATE TABLE teams (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revealed_at INTEGER
);
CREATE TABLE members (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  token TEXT UNIQUE,
  nickname TEXT NOT NULL,
  is_creator INTEGER NOT NULL DEFAULT 0,
  scores TEXT,
  submitted_at INTEGER
);
CREATE INDEX members_team ON members (team_id);
CREATE INDEX teams_expires ON teams (expires_at);
CREATE TABLE team_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_key TEXT NOT NULL,
  day TEXT NOT NULL,
  size INTEGER NOT NULL,
  c INTEGER NOT NULL, r INTEGER NOT NULL, i INTEGER NOT NULL, s INTEGER NOT NULL,
  t REAL NOT NULL
);
```

- [ ] **Step 2: Write the failing tests `test/team.test.js`**

```js
import { describe, it, expect } from "vitest";
import { validateTeam, validateTeamScores, allAnswered, teamState, aggregate, canRemove, TEAM_MIN, TEAM_MAX } from "../src/team.js";
import { ValidationError } from "../src/session.js";

const body = { teamName: " Product ", creatorName: "Anna", members: ["Bjarni", " ", "Clara"] };

describe("validateTeam", () => {
	it("trims, drops blanks, keeps order", () =>
		expect(validateTeam(body)).toEqual({ teamName: "Product", creatorName: "Anna", members: ["Bjarni", "Clara"] }));
	it.each([
		["one other", { ...body, members: ["Bjarni"] }],
		["eight others", { ...body, members: ["a","b","c","d","e","f","g","h"] }],
		["duplicate of creator", { ...body, members: ["anna", "Bjarni"] }],
		["duplicate member", { ...body, members: ["Bjarni", "bjarni "] }],
		["members not an array", { ...body, members: "Bjarni" }],
		["missing team name", { ...body, teamName: "" }],
	])("rejects %s", (_, v) => expect(() => validateTeam(v)).toThrow(ValidationError));
	it("bounds are 3 and 8", () => { expect(TEAM_MIN).toBe(3); expect(TEAM_MAX).toBe(8); });
});

describe("validateTeamScores", () => {
	it("accepts given only and drops predicted", () =>
		expect(validateTeamScores({ given: { c: 1, r: 2, i: 3, s: 4 }, predicted: { c: 1, r: 1, i: 1, s: 1 } })).toEqual({ given: { c: 1, r: 2, i: 3, s: 4 } }));
	it("rejects out of range", () => expect(() => validateTeamScores({ given: { c: 0, r: 2, i: 3, s: 4 } })).toThrow(ValidationError));
});

const m = (id, c, r, i, s, extra = {}) => ({ id, nickname: id, isCreator: false, scores: c == null ? null : { given: { c, r, i, s } }, ...extra });

describe("allAnswered / teamState", () => {
	it("false while anyone is pending", () => expect(allAnswered([m("a", 5,5,5,5), m("b")])).toBe(false));
	it("true when all have scores", () => expect(allAnswered([m("a", 5,5,5,5), m("b", 6,6,6,6)])).toBe(true));
	it("revealed wins", () => expect(teamState({ revealedAt: 1 }, m("a"))).toBe("revealed"));
	it("answered but not revealed is waiting", () => expect(teamState({ revealedAt: null }, m("a", 5,5,5,5))).toBe("waiting"));
	it("unanswered is needs_your_score", () => expect(teamState({ revealedAt: null }, m("a"))).toBe("needs_your_score"));
});

describe("aggregate", () => {
	it("min, avg, max per factor and over individual T", () => {
		const out = aggregate([m("a", 8,7,5,8), m("b", 9,9,9,1), m("c"), m("d", 4,6,6,2)]);
		expect(out.size).toBe(3);
		expect(out.min).toEqual({ c: 4, r: 6, i: 5, s: 1, t: 2.5 });
		expect(out.max).toEqual({ c: 9, r: 9, i: 9, s: 8, t: 27 });
		expect(out.avg).toEqual({ c: 7, r: 7.3, i: 6.7, s: 3.7, t: 12.5 });
	});
});

describe("canRemove", () => {
	const team = [m("a", 5,5,5,5, { isCreator: true }), m("b"), m("c"), m("d", 1,1,1,1)];
	it("pending non-creator in a team of four is removable", () => expect(canRemove(team, "b")).toEqual({ ok: true }));
	it("answered member is not", () => expect(canRemove(team, "d")).toEqual({ ok: false, reason: "answered" }));
	it("creator is not", () => expect(canRemove(team, "a")).toEqual({ ok: false, reason: "creator" }));
	it("unknown id", () => expect(canRemove(team, "zz")).toEqual({ ok: false, reason: "not_found" }));
	it("refuses to drop below three", () => expect(canRemove(team.slice(0, 3), "b")).toEqual({ ok: false, reason: "too_small" }));
});
```

- [ ] **Step 3: Run** `npm test` → FAIL, module `../src/team.js` not found.

- [ ] **Step 4: Implement `src/team.js`** with the signatures above, importing `validateName`, `ValidationError`, `computeT` from `./session.js`. `aggregate` avg: `Math.round(x * 10) / 10`; `t` for a member is `computeT(scores.given)`; `avg.t` is the mean of member Ts, not T of the averages.

- [ ] **Step 5: Run** `npm test` → PASS (the migration is picked up automatically by the test harness).

- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat: team rules and schema"`

---

### Task 2: Team store

**Files:**
- Create: `src/teamstore.js`, `test/teamstore.test.js`

**Interfaces:**
- Consumes: `randomToken` from `src/store.js`; `SESSION_TTL_MS`, `computeT` from `src/session.js`.
- Produces (all take `db` first):
  - `createTeam(db, { teamName, creatorName, members, creatorIpHash, now }) -> { id, creatorToken }` — inserts the team, one member row per name (creator first with `is_creator = 1`), and one `creations` row for the ip hash, in a single `db.batch`.
  - `findTeamByToken(db, token, now) -> null | { team: { id, name, createdAt, expiresAt, revealedAt }, you: Member, members: Member[] }` where `Member = { id, nickname, isCreator, scores, token }`; `null` when unknown or expired. `members` ordered by insertion (creator first).
  - `submitTeamScore(db, memberId, scores, now) -> boolean` (`WHERE id = ? AND scores IS NULL`).
  - `markRevealed(db, teamId, now) -> void` (`SET revealed_at = ? WHERE id = ? AND revealed_at IS NULL`).
  - `removeMember(db, memberId) -> boolean` (`DELETE ... WHERE id = ? AND scores IS NULL`).
  - `forgetMemberName(db, memberId) -> boolean` (`SET nickname = '', token = NULL WHERE id = ?`).
  - `anonymiseTeam(db, teamId, now) -> boolean` — only if `revealed_at` is set: insert one `team_stats` row per member with scores (shared random `team_key`, `day` from `created_at`, `size` = count of scored members), delete members and team, all in one batch.
  - `deleteTeam(db, teamId) -> boolean` — members then team.
  - `anonymiseExpiredTeams(db, now) -> { kept, dropped }`.

- [ ] **Step 1: Write the failing tests `test/teamstore.test.js`** (clear `teams`, `members`, `team_stats`, `creations` in `beforeEach`, as the pair store tests do):

```js
const now = Date.UTC(2027, 0, 15, 12);
const scores = (c) => ({ given: { c, r: c, i: c, s: 1 } });
const make = (names = ["Bjarni", "Clara"], at = now) =>
	createTeam(env.DB, { teamName: "Product", creatorName: "Anna", members: names, creatorIpHash: "h", now: at });

it("creates a team with creator first and one token per member", ...)  // findTeamByToken(creatorToken).members.length === 3; members[0].isCreator === true; every token matches /^[A-Za-z0-9_-]{22}$/ and is distinct; you.id === members[0].id; creations has one row for "h"
it("finds a member by their own token with role data", ...)            // you.nickname === "Bjarni", you.isCreator === false
it("unknown and expired tokens are null", ...)
it("a member scores once", ...)                                        // submitTeamScore true then false; scores stored
it("markRevealed is idempotent", ...)                                  // mark at now, mark at now+5 → revealedAt stays now
it("removeMember deletes only unscored members", ...)                  // scored → false and row stays
it("forgetMemberName blanks nickname and token but keeps scores", ...) // then findTeamByToken(oldToken) is null; team still lists the member with nickname ''
it("anonymiseTeam refuses before reveal and works after", ...)         // false before; after markRevealed: true, team_stats has 3 rows sharing one team_key, size 3, day "2027-01-15", c/t correct; findTeamByToken(creatorToken) null
it("deleteTeam removes members and team with no stats", ...)
it("anonymiseExpiredTeams keeps revealed, drops unrevealed, leaves fresh", ...) // {kept:1, dropped:1}
```

- [ ] **Step 2: Run** `npm test` → FAIL, module not found.
- [ ] **Step 3: Implement `src/teamstore.js`** per the Interfaces block. Scores stored as JSON text; parse on read.
- [ ] **Step 4: Run** `npm test` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat: team store"`

---

### Task 3: Team API and routing

**Files:**
- Create: `src/teamapi.js`, `test/teamapi.test.js`
- Modify: `src/api.js` (export `readBody`, `hashIp` is already exported; add `export { readBody }`), `src/worker.js` (mount `/api/teams` and rewrite `/t/*` → `/teampage`)

**Interfaces:**
- Consumes: Task 1 and Task 2 exports; `json` from `src/http.js`; `countRecentCreations` from `src/store.js`; `readBody`, `hashIp` from `src/api.js`.
- Produces: `handleTeamApi(request, env, now = Date.now()) -> Promise<Response>`:
  - `POST /api/teams` → `201 { creatorToken }`; `400 { error: "invalid", message }`; `429 { error: "rate_limited" }` (same 20/hour counter as sessions, via `hashIp` + `countRecentCreations`).
  - `GET /api/teams/:token` → `200 { role, state, teamName, creatorName, you: { id, nickname, answered }, members: [{ id, nickname, answered, isCreator }], links?: [{ id, nickname, url }], reveal? }`. `links` only when `role === "creator"` and state is not `revealed`; `url` = `${origin}/t/${token}`. `reveal` = `aggregate(members)` plus `you: { c, r, i, s, t }` from the caller's own scores, only when state is `revealed`. Before responding, if `revealedAt` is null and `allAnswered(members)`, call `markRevealed` and treat as revealed.
  - `POST /api/teams/:token/score` body `{ given }` → `200 { state }`; `409 { error: "already_scored" }`; `404`; `400`. After a successful submit, re-read and apply the same reveal check.
  - `POST /api/teams/:token/remove` body `{ memberId }` → creator only else `403 { error: "wrong_role" }`; `canRemove` false → `409 { error: reason }`; else `removeMember`, reveal check, `200 { state }`.
  - `DELETE /api/teams/:token` → creator: `anonymiseTeam` if revealed else `deleteTeam`, `200 { deleted: true }`. Member, revealed: `forgetMemberName`, `200 { deleted: true }`. Member, not revealed: `canRemove(members, you.id)` → ok ? `removeMember` + reveal check + `200 { deleted: true }` : `409 { error: reason }`.
  - Worker: `isTeamPath(pathname)` = `startsWith("/t/")` → `env.ASSETS.fetch` of `/teampage`; `/api/teams` prefix → `handleTeamApi`.

- [ ] **Step 1: Write the failing tests `test/teamapi.test.js`** (helpers like `test/api.test.js`; `create()` posts `{ teamName: "Product", creatorName: "Anna", members: ["Bjarni", "Clara"] }` and returns the creator's GET body including `links` so tests can reach member tokens):

```js
it("creates a team and the creator sees links for every member", ...)       // 201; GET creator: role creator, state needs_your_score, members 3, links 3, links[0].nickname "Anna", url matches /\/t\/[A-Za-z0-9_-]{22}$/
it("400 on one other member, 400 on duplicates", ...)
it("429 after 20 creations from one ip", ...)
it("a member's GET has no links and no numbers at any state", ...)          // after everyone scores: member body has no "links", JSON contains no "given"; reveal.you exists, no other member's values
it("who-answered list updates as people score", ...)                        // members[].answered flips
it("no reveal while one member is pending", ...)                           // two of three scored → creator state waiting, no reveal key
it("reveal appears for everyone once the last member scores, with min/avg/max/you", ...) // scores 8/7/5/8, 9/9/9/1, 4/6/6/2 → min/avg/max as in Task 1; each member's reveal.you is their own
it("409 on second score", ...)
it("remove: 403 for a member, 409 for an answered target, 409 below three, 200 otherwise and reveal can unlock", ...) // team of 4: Anna, B, C, D; B, C, D... design the case so removing the only pending member reveals
it("DELETE by creator before reveal removes everything; after reveal anonymises", ...) // 404 on all tokens after; team_stats rows exist only in the revealed case
it("DELETE by an unanswered member leaves; by an answered member before reveal is 409; after reveal forgets the name", ...) // after forget: creator GET shows nickname "" for that member, reveal avg unchanged, old member token 404
it("aggregate unchanged after a member forgets their name", ...)
it("unknown team token is 404 on every route", ...)
```

- [ ] **Step 2: Run** `npm test` → FAIL on the new file.
- [ ] **Step 3: Implement `src/teamapi.js`, export `readBody` from `src/api.js`, mount in `src/worker.js`** (add `isTeamPath` export next to `isSessionPath`, and a worker test that `/t/abc/` is a team path and `/team` is not).
- [ ] **Step 4: Run** `npm test` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat: team api"`

---

### Task 4: Create page and home entry

**Files:**
- Create: `public/team.html`, `public/team.js`
- Modify: `public/index.html` (add "Score your team" under the "Score someone" section), `public/style.css` (`.members-list`, `.add-row`, `.remove-row` styles)

**Interfaces:**
- Consumes: `POST /api/teams`; `theme.js`; CSS classes from the pair flow (`.field`, `.button`, `.button.big`, `.error`, `.mt-*`).

- [ ] **Step 1: `public/index.html`** — after the "Start" button paragraph add: `<h2>Score your team</h2>`, copy "Three to eight of you each rate the team. Nothing is shown until everyone has.", and `<a class="button big" href="/team">Set up a team</a>`. Keep the existing OG tags.

- [ ] **Step 2: `public/team.html`** — heading "Set up a team", lead "Everyone gets their own link. Nothing is shown until all of you have answered.", fields: Team name, Your nickname, then a `<div id="members">` with two empty "Nickname" text inputs and an "Add another" text button (max 7 rows; each row after the first two has a small "remove" text button), `<p class="error" hidden>`, submit "Create the team". No inline styles (CSP).

- [ ] **Step 3: `public/team.js`** — row add/remove; on submit trim, drop blanks, client-check 2–7 others and no duplicates (case-insensitive) with the same messages the server uses, POST, on 201 `location.href = "/t/" + creatorToken`; 429 and error handling as `new.js`.

- [ ] **Step 4: Verify in dev** — `npx wrangler d1 migrations apply trust-sessions --local`, `npm run dev`; in the browser create a team with three names; land on `/t/<token>` (page is a 404 until Task 5; the API row exists: `npx wrangler d1 execute trust-sessions --local --command 'select nickname, is_creator from members'`). Duplicate names stay on the page with the error shown.

- [ ] **Step 5: Commit** — `git commit -m "feat: team create page"`

---

### Task 5: Team page: links, who-answered, rating, waiting, reveal, remove, delete/leave

**Files:**
- Create: `public/teampage.html`, `public/teampage.js`
- Modify: `public/style.css` (`.roster`, `.roster .done`, `.reveal-table`, `.links`)

**Interfaces:**
- Consumes: `GET/POST/DELETE /api/teams/:token…`; `window.TrustForm.renderScoreBlock(container, { prefix: "given", heading, labels: { s } })` and `readScoreBlock`.

- [ ] **Step 1: `public/teampage.html`** sections: `#loading`, `#links` (creator only, hidden once revealed), `#roster` (always, once loaded), `#score`, `#waiting`, `#reveal`, `#deleted`, `#gone`; delete/leave/remove-name controls at the bottom with the two-tap pattern; OG tags titled "You've been added to a team on the Trust Equation". Meta `robots noindex`.
  - Roster: `<ul class="roster">` of `<li>` with nickname (or "—" for '') and a tick (`.done`) or hollow circle; "you" marked.
  - Links (creator): one row per member: nickname, read-only input with the URL, Copy button; the creator's own row says "you".
  - Score: "How you rate {teamName}" block with the team S label from Global Constraints; submit "Seal my rating".
  - Waiting: "Answered. Waiting for {n} more." above the roster; on the creator's page each pending member row in the roster has a "Remove" two-tap control (disabled with title "Team would be too small" when `members.length <= 3`).
  - Reveal: `<table class="reveal-table">` header Min / Avg / Max / You; rows Credibility, Reliability, Intimacy, Self-orientation, T (T in the accent). Sub-line "{size} of you answered." Closing "The spread is the conversation."
  - Bottom controls by role and state: creator → "Delete names and links"; member unanswered & not revealed → "Leave"; member answered & not revealed → nothing; member revealed → "Remove my name". Member whose leave would drop below three → text "Ask {creatorName} to delete the team".

- [ ] **Step 2: `public/teampage.js`** — token from the last path segment (same cleanup as `session.js`); `load()` with the same retry pattern; render by `state` and `role`; poll every 10 s while `waiting`; remove/delete/leave via the two-tap helper from `session.js` (copy it, keep files independent); after a successful remove re-`load()`; after delete/leave show `#deleted` with copy "Deleted." / "You've left." / "Your name is gone." depending on which control was used.

- [ ] **Step 3: Verify in dev, full walkthrough** — create a team of four in one tab; open three member links in other tabs; confirm: roster ticks update after each submit (within 10 s on waiting tabs); no reveal while one is pending; creator removes the pending fourth → all tabs flip to reveal; Min/Avg/Max/You matches the API JSON; a member taps "Remove my name" → their roster entry shows "—" on the other tabs, averages unchanged; creator deletes → all tabs show gone on reload; phone width (360) no horizontal scroll on every state; console free of CSP violations.

- [ ] **Step 4: Commit** — `git commit -m "feat: team page"`

---

### Task 6: Privacy section, cron, deploy

**Files:**
- Modify: `public/privacy.html` (Teams section + two responsibility lines), `src/worker.js` (`scheduled` also calls `anonymiseExpiredTeams`), `test/worker.test.js`, `README.md` (one line on teams), `docs/superpowers/specs/2026-10-28-trust-score-site-design.md` (status line: "team mode added, see team spec").

**Interfaces:**
- Consumes: `anonymiseExpiredTeams` from Task 2.

- [ ] **Step 1: Failing test** in `test/worker.test.js`: create a revealed team with `created_at` 91 days ago via `createTeam` + `submitTeamScore` ×3 + `markRevealed`, run `exports.default.scheduled(...)`, expect `findTeamByToken` null and `team_stats` count 3.
- [ ] **Step 2: Run** `npm test` → that test FAILS; implement; run → PASS.
- [ ] **Step 3: Privacy page** — add section "Teams": what is stored (team name, nicknames, each member's four numbers, one link per member), who sees what (everyone sees nicknames and who has answered; only the creator sees links; numbers are shown only as min, average and max, plus your own), leaving (before the reveal you can leave if you haven't answered; after, you can remove your name and your numbers stay in the averages), expiry and deletion as sessions. Then the two responsibility lines from the spec, verbatim in spirit.
- [ ] **Step 4: Deploy** — `npx wrangler d1 migrations apply trust-sessions --remote`, `npm run deploy`; verify live: `POST /api/teams` 201 with three names, member GET has no numbers, full reveal via the API, `DELETE` by creator 200, `/t/zzz` 200 page, `/team` 200.
- [ ] **Step 5: Commit and push** — `git commit -m "feat: team privacy section, expiry, deploy" && git push`.
