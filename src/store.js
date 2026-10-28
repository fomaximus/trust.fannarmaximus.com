// D1 persistence for sessions. Every function takes the DB binding first.

import { SESSION_TTL_MS } from "./session.js";

export function randomToken() {
	const bytes = crypto.getRandomValues(new Uint8Array(16));
	return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function createSession(db, { creatorName, inviteeName, creatorScores, creatorIpHash, now }) {
	const id = randomToken();
	const creatorToken = randomToken();
	const inviteeToken = randomToken();
	await db
		.prepare(
			`INSERT INTO sessions (id, created_at, expires_at, creator_token, invitee_token,
			   creator_name, invitee_name, creator_scores, creator_ip_hash)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		)
		.bind(id, now, now + SESSION_TTL_MS, creatorToken, inviteeToken, creatorName, inviteeName, JSON.stringify(creatorScores), creatorIpHash)
		.run();
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
		.prepare(`SELECT COUNT(*) AS n FROM sessions WHERE creator_ip_hash = ? AND created_at > ?`)
		.bind(creatorIpHash, since)
		.first();
	return row.n;
}

export async function deleteExpired(db, now) {
	const result = await db.prepare(`DELETE FROM sessions WHERE expires_at <= ?`).bind(now).run();
	return result.meta.changes;
}
