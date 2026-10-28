// Pure team-mode rules: validation, state, aggregation, removal. No I/O.

import { validateName, ValidationError, computeT } from "./session.js";

export const TEAM_MIN = 3;
export const TEAM_MAX = 8;

const FACTORS = ["c", "r", "i", "s"];

export function validateTeam(body) {
	if (!body || typeof body !== "object") throw new ValidationError("body must be a JSON object");
	const teamName = validateName(body.teamName);
	const creatorName = validateName(body.creatorName);
	if (!Array.isArray(body.members)) throw new ValidationError("members must be a list");
	const members = body.members
		.filter((n) => typeof n === "string" && n.trim() !== "")
		.map((n) => validateName(n));
	if (members.length < TEAM_MIN - 1) throw new ValidationError(`a team needs at least ${TEAM_MIN} people`);
	if (members.length > TEAM_MAX - 1) throw new ValidationError(`a team can have at most ${TEAM_MAX} people`);
	const seen = new Set([creatorName.toLowerCase()]);
	for (const n of members) {
		const key = n.toLowerCase();
		if (seen.has(key)) throw new ValidationError(`"${n}" appears twice; nicknames must differ`);
		seen.add(key);
	}
	return { teamName, creatorName, members };
}

export function validateTeamScores(body) {
	if (!body || typeof body !== "object" || !body.given || typeof body.given !== "object") {
		throw new ValidationError("scores missing");
	}
	const given = {};
	for (const f of FACTORS) {
		const v = body.given[f];
		if (!Number.isInteger(v) || v < 1 || v > 10) throw new ValidationError(`${f} must be a whole number from 1 to 10`);
		given[f] = v;
	}
	return { given };
}

export function allAnswered(members) {
	return members.length > 0 && members.every((m) => m.scores);
}

export function teamState(team, you) {
	if (team.revealedAt) return "revealed";
	return you.scores ? "waiting" : "needs_your_score";
}

const round1 = (x) => Math.round(x * 10) / 10;

export function aggregate(members) {
	const rows = members.filter((m) => m.scores).map((m) => ({ ...m.scores.given, t: computeT(m.scores.given) }));
	const keys = [...FACTORS, "t"];
	const min = {}, max = {}, avg = {};
	for (const k of keys) {
		const vals = rows.map((r) => r[k]);
		min[k] = Math.min(...vals);
		max[k] = Math.max(...vals);
		avg[k] = round1(vals.reduce((a, b) => a + b, 0) / vals.length);
	}
	return { size: rows.length, min, avg, max };
}

export function canRemove(members, memberId) {
	const target = members.find((m) => m.id === memberId);
	if (!target) return { ok: false, reason: "not_found" };
	if (target.isCreator) return { ok: false, reason: "creator" };
	if (target.scores) return { ok: false, reason: "answered" };
	if (members.length - 1 < TEAM_MIN) return { ok: false, reason: "too_small" };
	return { ok: true };
}
