# Team sessions — design

Date: 2026-10-28
Status: approved by owner 2026-10-28
Builds on: `2026-10-28-trust-score-site-design.md` (the pair flow, live)

## Intent

Extend trust.fannarmaximus.com from two people to a group. A team of three to
eight people each answer one question, "how much do I trust this team", using
the same four factors. Nothing is shown until every member has answered. The
reveal is the team's average, the spread, and privately your own numbers next
to that average. It is a trust-climate reading for a team, meant to start a
conversation, not to grade anyone.

Two session types are described. **Team mode is built now. Member mode is
described for later and is not part of this build.**

## The two modes

| | Team mode (build now) | Member mode (later) |
|---|---|---|
| Question | How much do I trust this team? | How much do I trust each person here? |
| Input per member | 4 numbers | 4 numbers × (N−1) people, plus a 4-number prediction |
| Output | Team average per factor and T, spread, you vs average | Per-person received average per factor and T, spread, prediction gap |
| Social weight | Light: nobody is rated | Heavy: everyone is rated, averages only, never per rater |

Both share the plumbing this build creates: members, one link per member, the
who-has-answered list, removing a non-responder, all-must-answer reveal,
deletion, anonymised statistics.

## Goals

1. A team of 3–8 can be set up and sent links in under two minutes.
2. Every member can see who has answered and who hasn't, so follow-up is
   everyone's job, not only the creator's.
3. The reveal cannot happen until every remaining member has answered.
4. Same look, same privacy stance, same zero-friction model as the pair flow.

## Non-goals

- Sending reminders or emails. Links are copied and sent by people.
- Editing an answer after submitting.
- Groups larger than eight, or smaller than three (two is the pair flow).
- Accounts, roles beyond "creator" and "member", or a facilitator view.
- Member mode (rating each other). Designed above, built later.

## Anti-goals

- Any screen that shows one member's numbers to another member. The reveal is
  aggregate plus your own private row, nothing else.
- A reveal that happens while someone is still pending.
- A dropout that freezes a team forever with no way out.
- Looking like an HR survey tool.

## Flow

1. **Home** `/` gains a second entry under "Score someone": "Score your team",
   one line of copy ("Three to eight of you each rate the team. Nothing is
   shown until everyone has."), linking to `/team`.

2. **Create** `/team`
   - Team name (required, 1–40 chars; e.g. "Product team", "Us").
   - Your nickname (required).
   - Member nicknames: a list that starts with two empty rows and an "Add
     another" link; minimum two others (three including you), maximum seven
     others (eight including you). Blank rows are ignored on submit.
   - Submit "Create the team". Server creates the team and one member row per
     nickname, the creator included, each with its own token.

3. **Creator's page** `/t/<creatorToken>` (state: links)
   - "Send each person their own link." A list: nickname, the link in a
     read-only input, a Copy button. The creator's own link is marked "you".
   - Below: the who-has-answered list (see 4) and the creator's own rating
     form, since the creator is a member too.
   - The links list stays available on the creator's page until the reveal,
     so links can be resent. Members never see other members' links.

4. **Member page** `/t/<memberToken>`
   - Heading: "{creator} set up {team name} on the Trust Equation."
   - Who-has-answered list: every member's nickname with a tick or a hollow
     circle. Shown on every state of the page. Visible to all members.
   - If this member hasn't answered: the rating form, "How you rate
     {team name}", four factors. Self-orientation label for a team: "1 = all
     about the work and each other, 10 = all about itself". No prediction
     block in team mode.
   - If answered and others are pending: "Answered. Waiting for {n} more."
     with the list. Poll every 10 s.
   - When everyone remaining has answered: the reveal (6).

5. **Removing a non-responder** (creator only, before reveal)
   - On the creator's page each pending member has a "Remove" control, two
     taps to confirm, same pattern as delete. Not shown for members who have
     answered, nor for the creator. Disabled if removal would leave fewer than
     three members.
   - Removal deletes that member row: their link dies, nothing of theirs is
     counted. If that makes everyone-remaining-answered true, the reveal
     unlocks for all.

6. **Reveal** (all members, same aggregate, own row private)
   - Heading: the team name. Sub-line: "{n} of you answered."
   - A table with one row per factor and a final row for T, and four
     columns: **Min**, **Avg**, **Max**, **You**. Min and Max are the lowest
     and highest number any member gave; Avg is the mean to one decimal; You
     is this member's own number, private to them. The T row uses each
     member's individual T (min, max, and the mean of those Ts).
   - No colouring, no arrows, no "you are more trusting than the team" copy.
     The columns side by side are the point.
   - Closing line: "The spread is the conversation."
   - Controls at the bottom: "Delete names and links" (creator) or "Remove my
     name" (member), see 7.

7. **Deletion and leaving**
   - Creator, any time: "Delete names and links". Finished teams (reveal
     reached) are anonymised into statistics; unfinished teams are removed
     entirely. All links die.
   - Member who has not answered, before reveal: "Leave" behaves exactly
     like removal by the creator, including the minimum-of-three rule; if
     leaving would drop the team under three, the control is replaced by
     "Ask {creator} to delete the team".
   - Member who has answered, before reveal: no control. Their numbers are
     in; withdrawing them would be editing after submit. Only the creator can
     delete the team at that point.
   - Member, after reveal: "Remove my name" blanks their nickname and kills
     their link. Their numbers stay in the aggregate, since they cannot be
     attributed once the name is gone.

8. **Expiry**: 90 days from creation, as the pair flow. The hourly cron
   anonymises revealed teams into statistics and removes unrevealed ones.

Edge states: unknown or expired token → the existing calm "expired or doesn't
exist" page. Double submit → 409, re-fetch, render current state. Removing a
member who answered in the meantime → 409 "already answered", list refreshes.

## Visual design

Same system as the pair flow: Inter, thin formula, centred, faint frame, one
accent for T values and active controls. The who-has-answered list is a plain
centred list of nicknames with a tick in the accent colour for answered and a
hollow circle for pending. The reveal is one table, rows C, R, I, S, T and
columns Min, Avg, Max, You; on phones it stays a table, with the factor name
on its own line above the four numbers if needed. No charts.

## Technical design

- **Storage**, two new tables (migration 0005):
  - `teams(id TEXT PK, name TEXT, created_at INTEGER, expires_at INTEGER,
    revealed_at INTEGER NULL)`.
  - `members(id TEXT PK, team_id TEXT, token TEXT UNIQUE, nickname TEXT,
    is_creator INTEGER, scores TEXT NULL, submitted_at INTEGER NULL)`, index on
    `team_id`. A member with `nickname = ''` and `token IS NULL` is one who
    removed their name after the reveal (NULL, not '', because `token` is
    UNIQUE and SQLite allows many NULLs but only one '').
  - `revealed_at` is set by the first read that finds everyone answered, so
    "finished" is a stored fact, not a recomputation, and so later removals of
    names cannot un-reveal a team.
  - Statistics: `team_stats(id, team_key TEXT, day TEXT, size INTEGER, c, r,
    i, s INTEGER, t REAL)`, one row per answered member, `team_key` a random
    token shared by the rows of one team so team-level averages can be
    computed later without any link to the real team id.
  - Team creation inserts into the existing `creations` log for the rate
    limit; a team counts as one creation.
- **API** (same conventions as `/api/sessions`):
  - `POST /api/teams` body `{ teamName, creatorName, members: [names] }` →
    `201 { creatorToken }`. 400 on fewer than two or more than seven other
    names, blank or over-long names, or duplicate nicknames within a team.
  - `GET /api/teams/:token` → `{ role: "creator"|"member", state:
    "needs_your_score"|"waiting"|"revealed", teamName, creatorName, you:
    { nickname, answered }, members: [{ id, nickname, answered, isCreator }],
    links?: [{ id, nickname, url }] (creator only, until revealed),
    reveal?: { size, min: {c,r,i,s,t}, avg: {c,r,i,s,t}, max: {c,r,i,s,t},
    you: {c,r,i,s,t} } }`. Never any other member's numbers.
  - `POST /api/teams/:token/score` body `{ given }` → `200 { state }`; 409 if
    already answered.
  - `POST /api/teams/:token/remove` body `{ memberId }` → creator only (403
    otherwise); 409 if that member answered or if the team would drop below
    three; 200 `{ state }`.
  - `DELETE /api/teams/:token` → creator: anonymise or remove the team;
    member: leave (before reveal, same rules as remove) or remove name (after
    reveal). 200 `{ deleted: true }`.
  - All of it behind the existing security headers, HTTPS redirect, JSON 404s.
- **Pure logic** (`src/team.js`, no I/O): `validateTeam(body)`,
  `teamState(team, members)`, `aggregate(members)` returning min, avg and
  max per factor and for T, `canRemove(team, members, memberId)`.
- **Front end**: `public/team.html` + `team.js` (create), `public/teampage.html`
  + `teampage.js` served at `/t/*` by the Worker (same rewrite trick as `/s/*`),
  reusing `form.js` for the four-factor block and `style.css`. Privacy page
  gains a short "Teams" section: what a team stores, who sees what, how to
  leave, plus two lines of responsibility: whoever creates a session or team
  is responsible for what they type and should use nicknames and tell the
  people they invite; a workplace using team mode for its own purposes is the
  controller for that use.
- **Done means live**, as in the first spec: apply migration 0005 with
  `wrangler d1 migrations apply trust-sessions --remote`, deploy, verify a real
  team end to end on the domain, push to the public repo.
- **Tests**: unit tests on `team.js`; store tests on create/score/remove/
  anonymise; API tests covering every status code above and, specifically,
  that a member's GET never contains another member's numbers at any state,
  and that the reveal does not appear while one member is pending.

## Left to the builder

- Exact copy on the create page and the member page, within the spirit above.
- Whether the creator's page shows the links as a list or one-per-row with
  copy buttons on phones.
- How "Add another" rows are implemented.
- Polling interval and whether to use `revealed_at` or recompute on the
  client for the "waiting for n more" count.
- The `team_key` scheme for statistics, as long as it cannot be joined back.
