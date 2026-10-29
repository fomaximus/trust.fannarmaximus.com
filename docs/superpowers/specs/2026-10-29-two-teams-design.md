# Two teams — design

Date: 2026-10-29
Status: approved by owner in chat 2026-10-29 (replaces the one-team mode of
`2026-10-28-team-sessions-design.md`, which the owner judged the wrong shape
and which was reverted from production)

## Intent

The pair flow, with a team on each side. Team A's members each rate Team B,
and predict how Team B will rate them; Team B does the same. Nothing is
shown until everyone on both sides has answered. The reveal puts what each
team received next to what it expected, so the two teams can discuss it.

## Flow

1. **Create** `/match`: your team's name, the other team's name, your
   nickname, your team's other members (2–7 nicknames). Submit creates the
   match with side A set up. The creator is side A's captain.
2. **Side A captain page** `/m/<token>`: one link per side-A member (captain
   marked "you"), plus one **captain link for Team B** to send to whoever
   leads the other team. The captain's own rating form is below.
3. **Captain link for Team B** `/m/<captainToken>`: first opening shows a
   setup form: your nickname and your team's other members (2–7). On submit,
   side B exists, this very link becomes B's captain's member link, and the
   page shows B's member links and the rating form.
4. **Member page** `/m/<token>`: "{other team} and {your team} are scoring
   each other on the Trust Equation." Roster of both teams with who has
   answered. Rating form: "How you rate {other team}" (C, R, I, S) and "How
   you think {other team} will rate {your team}" (C, R, I, S). After
   answering: "Answered. Waiting for n more." Poll every 10 s.
5. **Reveal** when side B is set up and every remaining member on both
   sides has answered. Two tables, one per team, headed "What {B} gave
   {A}" and the mirror. Rows C, R, I, S, T. Columns: **Min**, **Avg**,
   **Max** of what the other side gave, and **Expected**, the receiving
   side's average prediction. T rows use individual Ts. Closing line: "The
   gaps are the conversation." No per-person column.
6. **Removal**: a captain can remove a pending member of their own side,
   two taps, never below three per side; a lost race is a 409.
7. **Delete / leave**: either captain, any time: "Delete names and links";
   revealed matches are anonymised into statistics, unrevealed ones removed.
   A member who hasn't answered can leave before the reveal (same floor);
   an answered member cannot withdraw; after the reveal anyone can remove
   their name, their numbers stay.
8. **Expiry** 90 days; hourly cron anonymises revealed matches, drops the
   rest.

Self-orientation labels: rating the other team, "1 = all about the work and
the people they serve, 10 = all about themselves"; predicting, "1 = they'd
say we're all about the work, 10 = they'd say we're all about ourselves".

## Non-goals and anti-goals

As the one-team spec: no reminders, no editing after submit, no accounts,
sides of 3–8 only. Anti-goals: any individual's numbers shown to anyone;
a reveal while anyone is pending; a dropout that freezes a match with no
way out; HR-tool look.

## Technical design

- **Storage**, migration 0006 drops the unused one-team tables (`teams`,
  `members`, `team_stats`; nothing real was ever stored in them) and creates:
  - `matches(id TEXT PK, created_at, expires_at, revealed_at INTEGER NULL,
    b_captain_token TEXT UNIQUE NULL)` — the unclaimed captain link; NULL
    once side B is set up.
  - `sides(id TEXT PK, match_id, label TEXT 'a'|'b', name TEXT)`.
  - `members(id TEXT PK, side_id, token TEXT UNIQUE NULL, nickname TEXT,
    is_captain INTEGER, scores TEXT NULL, submitted_at INTEGER NULL)`.
    Removed-name marker: `nickname = ''`, `token IS NULL`.
  - `match_stats(id, match_key TEXT, side TEXT, day TEXT, size INTEGER,
    c, r, i, s INTEGER, t REAL, pc, pr, pi, ps INTEGER, pt REAL)` — one row
    per answered member, `side` is the rater's side.
  - Creating a match inserts into `creations` for the rate limit.
- **API** `/api/matches`:
  - `POST /api/matches` `{ myTeam, otherTeam, creatorName, members }` →
    `201 { creatorToken }`.
  - `GET /api/matches/:token` → `{ role: "captain"|"member", side: "a"|"b",
    state: "setup"|"needs_your_score"|"waiting"|"revealed", teams: { you:
    { name, members: [{ id, nickname, answered, isCaptain }] }, other: {
    name, members: [...] | null } }, you: { id, nickname, answered },
    links?: [{ id, nickname, url }] (captains, own side, until revealed),
    captainLink?: url (side-A captain, until side B is set up), reveal? }`.
    `state: "setup"` only for an unclaimed B captain token.
    `reveal = { you: { received: {min,avg,max per c,r,i,s,t}, expected:
    {c,r,i,s,t} }, other: { same } }`, `you` meaning the caller's team.
  - `POST /api/matches/:token/setup` `{ captainName, members }` → claims a
    B captain token; `409 { error: "already_set_up" }` on a second call.
  - `POST /api/matches/:token/score` `{ given, predicted }` → `200 { state }`.
  - `POST /api/matches/:token/remove` `{ memberId }` → captain of that
    member's side only.
  - `DELETE /api/matches/:token` → captain: anonymise/remove the match;
    member: leave (before reveal, unanswered, floor) or forget name (after).
  - A B-captain token that is still unclaimed answers `GET` with
    `state: "setup"` and the team names; `score`/`remove`/`DELETE` on it
    are 409 `not_set_up`.
- **Pure logic** `src/match.js`: `validateMatch`, `validateSetup`,
  `validateMatchScores` (given + predicted), `allAnswered(match, sides)`,
  `matchState`, `aggregate(ratersOfOtherSide, ownSide)` → `{ received,
  expected }`, `canRemove(sideMembers, memberId)`.
- **Pages** `/match` (create), `/m/*` → `matchpage.html`, reusing `form.js`
  and `style.css`. Home: "Two teams" entry replacing the one-team entry.
  Privacy "Teams" section rewritten for two sides.
- Everything else (headers, HTTPS, JSON 404s, rate limit, cron) as today.
- Done means live: remote migration, deploy, verified end to end, merged to
  main, pushed.
