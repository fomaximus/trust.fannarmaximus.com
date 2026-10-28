// Pure Trust Equation logic: validation, scoring and the sealed-reveal state.
// No I/O here so it can be tested without a database.

export const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000;

const FACTORS = ["c", "r", "i", "s"];
const BLOCKS = ["given", "predicted"];

export class ValidationError extends Error {
	status = 400;
}

export function validateName(raw) {
	if (typeof raw !== "string") throw new ValidationError("name must be text");
	const name = raw.trim();
	if (name.length < 1 || name.length > 40) throw new ValidationError("name must be 1–40 characters");
	return name;
}

function validateFactors(raw, block) {
	if (!raw || typeof raw !== "object") throw new ValidationError(`${block} scores missing`);
	const out = {};
	for (const f of FACTORS) {
		const v = raw[f];
		if (!Number.isInteger(v) || v < 1 || v > 10) {
			throw new ValidationError(`${block}.${f} must be a whole number from 1 to 10`);
		}
		out[f] = v;
	}
	return out;
}

export function validateScores(raw) {
	if (!raw || typeof raw !== "object") throw new ValidationError("scores missing");
	const out = {};
	for (const b of BLOCKS) out[b] = validateFactors(raw[b], b);
	return out;
}

export function computeT({ c, r, i, s }) {
	return Math.round(((c + r + i) / s) * 10) / 10;
}

export function visibleState(session, role) {
	if (session.inviteeScores) return "revealed";
	return role === "creator" ? "waiting" : "needs_your_score";
}
