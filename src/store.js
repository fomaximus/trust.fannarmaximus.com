// D1 persistence for sessions. Every function takes the DB binding first.

import { SESSION_TTL_MS, computeT } from "./session.js";

export function randomToken() {
	const bytes = crypto.getRandomValues(new Uint8Array(16));
	return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function createSession(db, { creatorName, inviteeName, creatorScores, creatorIpHash, now }) {
	const id = randomToken();
	const creatorToken = randomToken();
	const inviteeToken = randomToken();
	// The ip hash goes only into the creation log, which deleting a session cannot erase.
	await db.batch([
		db
			.prepare(
				`INSERT INTO sessions (id, created_at, expires_at, creator_token, invitee_token,
				   creator_name, invitee_name, creator_scores, creator_ip_hash)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, '')`,
			)
			.bind(id, now, now + SESSION_TTL_MS, creatorToken, inviteeToken, creatorName, inviteeName, JSON.stringify(creatorScores)),
		db.prepare(`INSERT INTO creations (ip_hash, created_at) VALUES (?, ?)`).bind(creatorIpHash, now),
	]);
	return { id, creatorToken, inviteeToken };
}

export async function findByToken(db, token, now) {
	const row = await db
		.prepare(`SELECT * FROM sessions WHERE (creator_token = ?1 OR invitee_token = ?1) AND expires_at > ?2`)
		.bind(token, now)
		.first();
	if (!row) return null;
	return {
		id: row.id,
		role: row.creator_token === token ? "creator" : "invitee",
		creatorName: row.creator_name,
		inviteeName: row.invitee_name,
		creatorToken: row.creator_token,
		inviteeToken: row.invitee_token,
		creatorScores: JSON.parse(row.creator_scores),
		inviteeScores: row.invitee_scores ? JSON.parse(row.invitee_scores) : null,
		expiresAt: row.expires_at,
	};
}

export async function submitInviteeScores(db, inviteeToken, scores, now, name = null) {
	const result = await db
		.prepare(
			`UPDATE sessions
			 SET invitee_scores = ?, invitee_submitted_at = ?, invitee_name = COALESCE(?, invitee_name)
			 WHERE invitee_token = ? AND invitee_scores IS NULL AND expires_at > ?`,
		)
		.bind(JSON.stringify(scores), now, name, inviteeToken, now)
		.run();
	return result.meta.changes === 1;
}

export async function countRecentCreations(db, creatorIpHash, since) {
	const row = await db
		.prepare(`SELECT COUNT(*) AS n FROM creations WHERE ip_hash = ? AND created_at > ?`)
		.bind(creatorIpHash, since)
		.first();
	return row.n;
}

function dayOf(ms) {
	return new Date(ms).toISOString().slice(0, 10);
}

// Copies a completed session's sixteen numbers into stats (no names, tokens or IP)
// and removes the session. Returns false if the session is missing or unfinished.
export async function anonymiseSession(db, id, now) {
	const row = await db.prepare(`SELECT * FROM sessions WHERE id = ?`).bind(id).first();
	if (!row || !row.invitee_scores) return false;
	const a = JSON.parse(row.creator_scores);
	const b = JSON.parse(row.invitee_scores);
	const insert = db
		.prepare(
			`INSERT INTO stats (day, a_c, a_r, a_i, a_s, a_pc, a_pr, a_pi, a_ps,
			                    b_c, b_r, b_i, b_s, b_pc, b_pr, b_pi, b_ps, a_t, a_pt, b_t, b_pt)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		)
		.bind(
			dayOf(row.created_at),
			a.given.c, a.given.r, a.given.i, a.given.s, a.predicted.c, a.predicted.r, a.predicted.i, a.predicted.s,
			b.given.c, b.given.r, b.given.i, b.given.s, b.predicted.c, b.predicted.r, b.predicted.i, b.predicted.s,
			computeT(a.given), computeT(a.predicted), computeT(b.given), computeT(b.predicted),
		);
	const remove = db.prepare(`DELETE FROM sessions WHERE id = ?`).bind(id);
	await db.batch([insert, remove]);
	return true;
}

export async function deleteSession(db, id) {
	const result = await db.prepare(`DELETE FROM sessions WHERE id = ?`).bind(id).run();
	return result.meta.changes === 1;
}

// Expired sessions: completed ones are kept anonymously, unfinished ones are dropped.
export async function anonymiseExpired(db, now) {
	const { results } = await db
		.prepare(`SELECT id, invitee_scores IS NOT NULL AS done FROM sessions WHERE expires_at <= ?`)
		.bind(now)
		.all();
	let kept = 0, dropped = 0;
	for (const r of results) {
		if (r.done && (await anonymiseSession(db, r.id, now))) kept++;
		else if (await deleteSession(db, r.id)) dropped++;
	}
	return { kept, dropped };
}

// The creation log only serves the one-hour rate limit; forget entries older than the cutoff.
export async function clearOldIpHashes(db, before) {
	const result = await db.prepare(`DELETE FROM creations WHERE created_at < ?`).bind(before).run();
	return result.meta.changes;
}
