// D1 persistence for teams and members. Every function takes the DB binding first.

import { SESSION_TTL_MS, computeT } from "./session.js";
import { TEAM_MIN } from "./team.js";
import { randomToken } from "./store.js";

function dayOf(ms) {
	return new Date(ms).toISOString().slice(0, 10);
}

function rowToMember(r) {
	return {
		id: r.id,
		nickname: r.nickname,
		isCreator: r.is_creator === 1,
		scores: r.scores ? JSON.parse(r.scores) : null,
		token: r.token,
	};
}

export async function createTeam(db, { teamName, creatorName, members, creatorIpHash, now }) {
	const id = randomToken();
	const creatorToken = randomToken();
	const insertMember = db.prepare(
		`INSERT INTO members (id, team_id, token, nickname, is_creator) VALUES (?, ?, ?, ?, ?)`,
	);
	const statements = [
		db.prepare(`INSERT INTO teams (id, name, created_at, expires_at) VALUES (?, ?, ?, ?)`).bind(id, teamName, now, now + SESSION_TTL_MS),
		insertMember.bind(randomToken(), id, creatorToken, creatorName, 1),
		...members.map((n) => insertMember.bind(randomToken(), id, randomToken(), n, 0)),
		db.prepare(`INSERT INTO creations (ip_hash, created_at) VALUES (?, ?)`).bind(creatorIpHash, now),
	];
	await db.batch(statements);
	return { id, creatorToken };
}

async function loadTeam(db, teamId) {
	const { results } = await db.prepare(`SELECT * FROM members WHERE team_id = ? ORDER BY rowid`).bind(teamId).all();
	return results.map(rowToMember);
}

export async function findTeamByToken(db, token, now) {
	if (!token) return null;
	const row = await db
		.prepare(
			`SELECT t.id, t.name, t.created_at, t.expires_at, t.revealed_at, m.id AS member_id
			 FROM members m JOIN teams t ON t.id = m.team_id
			 WHERE m.token = ? AND t.expires_at > ?`,
		)
		.bind(token, now)
		.first();
	if (!row) return null;
	const members = await loadTeam(db, row.id);
	return {
		team: { id: row.id, name: row.name, createdAt: row.created_at, expiresAt: row.expires_at, revealedAt: row.revealed_at },
		you: members.find((m) => m.id === row.member_id),
		members,
	};
}

export async function submitTeamScore(db, memberId, scores, now) {
	const result = await db
		.prepare(`UPDATE members SET scores = ?, submitted_at = ? WHERE id = ? AND scores IS NULL`)
		.bind(JSON.stringify(scores), now, memberId)
		.run();
	return result.meta.changes === 1;
}

export async function markRevealed(db, teamId, now) {
	await db.prepare(`UPDATE teams SET revealed_at = ? WHERE id = ? AND revealed_at IS NULL`).bind(now, teamId).run();
}

// The size floor is enforced inside the statement so two concurrent removals cannot both pass.
export async function removeMember(db, memberId) {
	const result = await db
		.prepare(
			`DELETE FROM members WHERE id = ? AND scores IS NULL
			   AND (SELECT COUNT(*) FROM members m2 WHERE m2.team_id = members.team_id) > ?`,
		)
		.bind(memberId, TEAM_MIN)
		.run();
	return result.meta.changes === 1;
}

export async function forgetMemberName(db, memberId) {
	const result = await db.prepare(`UPDATE members SET nickname = '', token = NULL WHERE id = ?`).bind(memberId).run();
	return result.meta.changes === 1;
}

// Keeps each answered member's four numbers under a shared random key, then removes the team.
export async function anonymiseTeam(db, teamId, now) {
	const team = await db.prepare(`SELECT created_at, revealed_at FROM teams WHERE id = ?`).bind(teamId).first();
	if (!team || !team.revealed_at) return false;
	const answered = (await loadTeam(db, teamId)).filter((m) => m.scores);
	const key = randomToken();
	const day = dayOf(team.created_at);
	const insert = db.prepare(`INSERT INTO team_stats (team_key, day, size, c, r, i, s, t) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
	await db.batch([
		...answered.map((m) => {
			const g = m.scores.given;
			return insert.bind(key, day, answered.length, g.c, g.r, g.i, g.s, computeT(g));
		}),
		db.prepare(`DELETE FROM members WHERE team_id = ?`).bind(teamId),
		db.prepare(`DELETE FROM teams WHERE id = ?`).bind(teamId),
	]);
	return true;
}

export async function deleteTeam(db, teamId) {
	const [, team] = await db.batch([
		db.prepare(`DELETE FROM members WHERE team_id = ?`).bind(teamId),
		db.prepare(`DELETE FROM teams WHERE id = ?`).bind(teamId),
	]);
	return team.meta.changes === 1;
}

export async function anonymiseExpiredTeams(db, now) {
	const { results } = await db.prepare(`SELECT id, revealed_at FROM teams WHERE expires_at <= ?`).bind(now).all();
	let kept = 0, dropped = 0;
	for (const t of results) {
		if (t.revealed_at && (await anonymiseTeam(db, t.id, now))) kept++;
		else if (await deleteTeam(db, t.id)) dropped++;
	}
	return { kept, dropped };
}
