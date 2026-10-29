// D1 persistence for two-team matches. Every function takes the DB binding first.

import { SESSION_TTL_MS, computeT } from "./session.js";
import { randomToken } from "./store.js";
import { SIDE_MIN } from "./match.js";

function dayOf(ms) {
	return new Date(ms).toISOString().slice(0, 10);
}

function rowToMember(r, side) {
	return {
		id: r.id,
		sideId: r.side_id,
		side,
		nickname: r.nickname,
		isCaptain: r.is_captain === 1,
		scores: r.scores ? JSON.parse(r.scores) : null,
		token: r.token,
	};
}

export async function createMatch(db, { myTeam, otherTeam, creatorName, members, creatorIpHash, now }) {
	const id = randomToken();
	const creatorToken = randomToken();
	const bCaptainToken = randomToken();
	const sideA = randomToken();
	const sideB = randomToken();
	const insertMember = db.prepare(`INSERT INTO members (id, side_id, token, nickname, is_captain) VALUES (?, ?, ?, ?, ?)`);
	await db.batch([
		db.prepare(`INSERT INTO matches (id, created_at, expires_at, b_captain_token) VALUES (?, ?, ?, ?)`).bind(id, now, now + SESSION_TTL_MS, bCaptainToken),
		db.prepare(`INSERT INTO sides (id, match_id, label, name) VALUES (?, ?, 'a', ?)`).bind(sideA, id, myTeam),
		db.prepare(`INSERT INTO sides (id, match_id, label, name) VALUES (?, ?, 'b', ?)`).bind(sideB, id, otherTeam),
		insertMember.bind(randomToken(), sideA, creatorToken, creatorName, 1),
		...members.map((n) => insertMember.bind(randomToken(), sideA, randomToken(), n, 0)),
		db.prepare(`INSERT INTO creations (ip_hash, created_at) VALUES (?, ?)`).bind(creatorIpHash, now),
	]);
	return { id, creatorToken, bCaptainToken };
}

async function loadSides(db, matchId) {
	const { results: sideRows } = await db.prepare(`SELECT * FROM sides WHERE match_id = ? ORDER BY label`).bind(matchId).all();
	const { results: memberRows } = await db
		.prepare(`SELECT m.* FROM members m JOIN sides s ON s.id = m.side_id WHERE s.match_id = ? ORDER BY m.rowid`)
		.bind(matchId)
		.all();
	const sides = {};
	for (const s of sideRows) {
		sides[s.label] = { id: s.id, label: s.label, name: s.name, members: memberRows.filter((m) => m.side_id === s.id).map((m) => rowToMember(m, s.label)) };
	}
	return sides;
}

function toMatch(row) {
	return { id: row.id, createdAt: row.created_at, expiresAt: row.expires_at, revealedAt: row.revealed_at, bCaptainToken: row.b_captain_token };
}

export async function findByToken(db, token, now) {
	if (!token) return null;
	const byMember = await db
		.prepare(
			`SELECT mt.*, m.id AS member_id FROM members m
			 JOIN sides s ON s.id = m.side_id JOIN matches mt ON mt.id = s.match_id
			 WHERE m.token = ? AND mt.expires_at > ?`,
		)
		.bind(token, now)
		.first();
	if (byMember) {
		const sides = await loadSides(db, byMember.id);
		const you = [...sides.a.members, ...sides.b.members].find((m) => m.id === byMember.member_id);
		return { match: toMatch(byMember), sides, you };
	}
	const byCaptain = await db.prepare(`SELECT * FROM matches WHERE b_captain_token = ? AND expires_at > ?`).bind(token, now).first();
	if (!byCaptain) return null;
	const sides = await loadSides(db, byCaptain.id);
	return { match: toMatch(byCaptain), sides, you: { unclaimedCaptain: true, side: "b" } };
}

// Claims the B captain link. Side A's captain has seen that link, so B's captain gets a fresh
// token of their own and the claim link is retired. Returns the new token, or null if already claimed.
export async function setupSideB(db, matchId, captainToken, { captainName, members }) {
	const side = await db.prepare(`SELECT id FROM sides WHERE match_id = ? AND label = 'b'`).bind(matchId).first();
	if (!side) return null;
	const claim = await db
		.prepare(`UPDATE matches SET b_captain_token = NULL WHERE id = ? AND b_captain_token = ?`)
		.bind(matchId, captainToken)
		.run();
	if (claim.meta.changes !== 1) return null;
	const fresh = randomToken();
	const insertMember = db.prepare(`INSERT INTO members (id, side_id, token, nickname, is_captain) VALUES (?, ?, ?, ?, ?)`);
	await db.batch([
		insertMember.bind(randomToken(), side.id, fresh, captainName, 1),
		...members.map((n) => insertMember.bind(randomToken(), side.id, randomToken(), n, 0)),
	]);
	return fresh;
}

export async function submitMatchScore(db, memberId, scores, now) {
	const result = await db
		.prepare(`UPDATE members SET scores = ?, submitted_at = ? WHERE id = ? AND scores IS NULL`)
		.bind(JSON.stringify(scores), now, memberId)
		.run();
	return result.meta.changes === 1;
}

export async function markRevealed(db, matchId, now) {
	await db.prepare(`UPDATE matches SET revealed_at = ? WHERE id = ? AND revealed_at IS NULL`).bind(now, matchId).run();
}

// The size floor is enforced inside the statement so two concurrent removals cannot both pass.
export async function removeMember(db, memberId) {
	const result = await db
		.prepare(
			`DELETE FROM members WHERE id = ? AND scores IS NULL
			   AND (SELECT COUNT(*) FROM members m2 WHERE m2.side_id = members.side_id) > ?`,
		)
		.bind(memberId, SIDE_MIN)
		.run();
	return result.meta.changes === 1;
}

export async function forgetMemberName(db, memberId) {
	const result = await db.prepare(`UPDATE members SET nickname = '', token = NULL WHERE id = ?`).bind(memberId).run();
	return result.meta.changes === 1;
}

export async function anonymiseMatch(db, matchId, now) {
	const match = await db.prepare(`SELECT created_at, revealed_at FROM matches WHERE id = ?`).bind(matchId).first();
	if (!match || !match.revealed_at) return false;
	const sides = await loadSides(db, matchId);
	const key = randomToken();
	const day = dayOf(match.created_at);
	const insert = db.prepare(
		`INSERT INTO match_stats (match_key, side, day, size, c, r, i, s, t, pc, pr, pi, ps, pt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
	);
	const rows = [];
	for (const label of ["a", "b"]) {
		const answered = (sides[label] ? sides[label].members : []).filter((m) => m.scores);
		for (const m of answered) {
			const g = m.scores.given, p = m.scores.predicted;
			rows.push(insert.bind(key, label, day, answered.length, g.c, g.r, g.i, g.s, computeT(g), p.c, p.r, p.i, p.s, computeT(p)));
		}
	}
	await db.batch([
		...rows,
		db.prepare(`DELETE FROM members WHERE side_id IN (SELECT id FROM sides WHERE match_id = ?)`).bind(matchId),
		db.prepare(`DELETE FROM sides WHERE match_id = ?`).bind(matchId),
		db.prepare(`DELETE FROM matches WHERE id = ?`).bind(matchId),
	]);
	return true;
}

export async function deleteMatch(db, matchId) {
	const results = await db.batch([
		db.prepare(`DELETE FROM members WHERE side_id IN (SELECT id FROM sides WHERE match_id = ?)`).bind(matchId),
		db.prepare(`DELETE FROM sides WHERE match_id = ?`).bind(matchId),
		db.prepare(`DELETE FROM matches WHERE id = ?`).bind(matchId),
	]);
	return results[2].meta.changes === 1;
}

export async function anonymiseExpiredMatches(db, now) {
	const { results } = await db.prepare(`SELECT id, revealed_at FROM matches WHERE expires_at <= ?`).bind(now).all();
	let kept = 0, dropped = 0;
	for (const m of results) {
		if (m.revealed_at && (await anonymiseMatch(db, m.id, now))) kept++;
		else if (await deleteMatch(db, m.id)) dropped++;
	}
	return { kept, dropped };
}
