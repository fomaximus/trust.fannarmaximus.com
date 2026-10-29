// Pure two-team rules: validation, state, aggregation, removal. No I/O.

import { validateName, validateScores, ValidationError, computeT } from "./session.js";

export const SIDE_MIN = 3;
export const SIDE_MAX = 8;

const FACTORS = ["c", "r", "i", "s"];

// A side: a captain plus 2–7 others, distinct nicknames (case-insensitive).
function validateSide(captainName, rawMembers) {
	if (!Array.isArray(rawMembers)) throw new ValidationError("members must be a list");
	const members = rawMembers.filter((n) => typeof n === "string" && n.trim() !== "").map((n) => validateName(n));
	if (members.length < SIDE_MIN - 1) throw new ValidationError(`a team needs at least ${SIDE_MIN} people`);
	if (members.length > SIDE_MAX - 1) throw new ValidationError(`a team can have at most ${SIDE_MAX} people`);
	const seen = new Set([captainName.toLowerCase()]);
	for (const n of members) {
		const key = n.toLowerCase();
		if (seen.has(key)) throw new ValidationError(`"${n}" appears twice; nicknames must differ`);
		seen.add(key);
	}
	return members;
}

export function validateMatch(body) {
	if (!body || typeof body !== "object") throw new ValidationError("body must be a JSON object");
	const myTeam = validateName(body.myTeam);
	const otherTeam = validateName(body.otherTeam);
	const creatorName = validateName(body.creatorName);
	const members = validateSide(creatorName, body.members);
	return { myTeam, otherTeam, creatorName, members };
}

export function validateSetup(body) {
	if (!body || typeof body !== "object") throw new ValidationError("body must be a JSON object");
	const captainName = validateName(body.captainName);
	const members = validateSide(captainName, body.members);
	return { captainName, members };
}

export function validateMatchScores(body) {
	return validateScores(body);
}

export function allAnswered(sides) {
	if (!sides.b) return false;
	return [...sides.a, ...sides.b].every((m) => m.scores);
}

export function matchState(match, you) {
	if (you.unclaimedCaptain) return "setup";
	if (match.revealedAt) return "revealed";
	return you.scores ? "waiting" : "needs_your_score";
}

const round1 = (x) => Math.round(x * 10) / 10;
const KEYS = [...FACTORS, "t"];
const withT = (block) => ({ ...block, t: computeT(block) });

// raters gave `given` about the receivers; receivers `predicted` what they'd get.
export function aggregate(raters, receivers) {
	const given = raters.filter((m) => m.scores).map((m) => withT(m.scores.given));
	const predicted = receivers.filter((m) => m.scores).map((m) => withT(m.scores.predicted));
	const min = {}, avg = {}, max = {}, expected = {};
	for (const k of KEYS) {
		const g = given.map((r) => r[k]);
		min[k] = Math.min(...g);
		max[k] = Math.max(...g);
		avg[k] = round1(g.reduce((a, b) => a + b, 0) / g.length);
		const p = predicted.map((r) => r[k]);
		expected[k] = round1(p.reduce((a, b) => a + b, 0) / p.length);
	}
	return { received: { min, avg, max }, expected };
}

export function canRemove(sideMembers, memberId) {
	const target = sideMembers.find((m) => m.id === memberId);
	if (!target) return { ok: false, reason: "not_found" };
	if (target.isCaptain) return { ok: false, reason: "captain" };
	if (target.scores) return { ok: false, reason: "answered" };
	if (sideMembers.length - 1 < SIDE_MIN) return { ok: false, reason: "too_small" };
	return { ok: true };
}
