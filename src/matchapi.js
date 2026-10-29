// HTTP layer for two-team matches. Tokens are the only credential; individual numbers
// never leave the server; captains see links for their own side only.

import { json } from "./http.js";
import { ValidationError } from "./session.js";
import { readBody, hashIp } from "./api.js";
import { countRecentCreations } from "./store.js";
import { validateMatch, validateSetup, validateMatchScores, allAnswered, matchState, aggregate, canRemove } from "./match.js";
import { createMatch, findByToken, setupSideB, submitMatchScore, markRevealed, removeMember, forgetMemberName, anonymiseMatch, deleteMatch } from "./matchstore.js";

const TOKEN = "([A-Za-z0-9_-]{22})";
const CREATE = /^\/api\/matches$/;
const ONE = new RegExp(`^/api/matches/${TOKEN}$`);
const SETUP = new RegExp(`^/api/matches/${TOKEN}/setup$`);
const SCORE = new RegExp(`^/api/matches/${TOKEN}/score$`);
const REMOVE = new RegExp(`^/api/matches/${TOKEN}/remove$`);

const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60 * 60 * 1000;

export async function handleMatchApi(request, env, now = Date.now()) {
	const url = new URL(request.url);
	const { pathname } = url;
	try {
		let m;
		if (request.method === "POST" && CREATE.test(pathname)) return await create(request, env, now);
		if (request.method === "GET" && (m = ONE.exec(pathname))) return await read(m[1], url.origin, env, now);
		if (request.method === "POST" && (m = SETUP.exec(pathname))) return await setup(request, m[1], url.origin, env, now);
		if (request.method === "POST" && (m = SCORE.exec(pathname))) return await score(request, m[1], env, now);
		if (request.method === "POST" && (m = REMOVE.exec(pathname))) return await remove(request, m[1], env, now);
		if (request.method === "DELETE" && (m = ONE.exec(pathname))) return await destroy(m[1], env, now);
		return json({ error: "not_found" }, 404);
	} catch (err) {
		if (err instanceof ValidationError) return json({ error: "invalid", message: err.message }, 400);
		console.error(err);
		return json({ error: "server_error" }, 500);
	}
}

async function create(request, env, now) {
	const body = await readBody(request);
	const data = validateMatch(body);
	const creatorIpHash = await hashIp(request.headers.get("cf-connecting-ip") ?? "unknown", env.IP_SALT ?? "");
	if ((await countRecentCreations(env.DB, creatorIpHash, now - RATE_WINDOW_MS)) >= RATE_LIMIT) {
		return json({ error: "rate_limited" }, 429);
	}
	const { creatorToken } = await createMatch(env.DB, { ...data, creatorIpHash, now });
	return json({ creatorToken }, 201);
}

// Loads by token and records the reveal if everyone on both sides has answered.
async function load(token, env, now) {
	const found = await findByToken(env.DB, token, now);
	if (!found) return null;
	if (!found.match.revealedAt && found.sides.b.members.length > 0 && allAnswered({ a: found.sides.a.members, b: found.sides.b.members })) {
		await markRevealed(env.DB, found.match.id, now);
		found.match.revealedAt = now;
	}
	return found;
}

const publicMember = (m) => ({ id: m.id, nickname: m.nickname, answered: !!m.scores, isCaptain: m.isCaptain });

function present({ match, sides, you }, origin) {
	const state = matchState(match, you);
	const mine = sides[you.side];
	const theirs = sides[you.side === "a" ? "b" : "a"];
	const body = {
		role: you.unclaimedCaptain || you.isCaptain ? "captain" : "member",
		side: you.side,
		state,
		teams: {
			you: { name: mine.name, members: mine.members.map(publicMember) },
			other: { name: theirs.name, members: theirs.members.length ? theirs.members.map(publicMember) : null },
		},
	};
	if (!you.unclaimedCaptain) body.you = { id: you.id, nickname: you.nickname, answered: !!you.scores };
	if (you.isCaptain && state !== "revealed") {
		body.links = mine.members.filter((m) => m.token).map((m) => ({ id: m.id, nickname: m.nickname, url: `${origin}/m/${m.token}` }));
		if (you.side === "a" && match.bCaptainToken) body.captainLink = `${origin}/m/${match.bCaptainToken}`;
	}
	if (state === "revealed") {
		body.reveal = {
			you: aggregate(theirs.members, mine.members),
			other: aggregate(mine.members, theirs.members),
		};
	}
	return body;
}

async function read(token, origin, env, now) {
	const found = await load(token, env, now);
	if (!found) return json({ error: "not_found" }, 404);
	return json(present(found, origin));
}

async function setup(request, token, origin, env, now) {
	const found = await findByToken(env.DB, token, now);
	if (!found) return json({ error: "not_found" }, 404);
	if (!found.you.unclaimedCaptain) return json({ error: "already_set_up" }, 409);
	const data = validateSetup(await readBody(request));
	const fresh = await setupSideB(env.DB, found.match.id, token, data);
	if (!fresh) return json({ error: "already_set_up" }, 409);
	const after = await load(fresh, env, now);
	// The page moves to this link; the one side A handed over no longer works.
	return json({ ...present(after, origin), yourLink: `${origin}/m/${fresh}` });
}

async function score(request, token, env, now) {
	const found = await findByToken(env.DB, token, now);
	if (!found) return json({ error: "not_found" }, 404);
	if (found.you.unclaimedCaptain) return json({ error: "not_set_up" }, 409);
	if (found.you.scores) return json({ error: "already_scored" }, 409);
	const scores = validateMatchScores(await readBody(request));
	if (!(await submitMatchScore(env.DB, found.you.id, scores, now))) return json({ error: "already_scored" }, 409);
	const after = await load(token, env, now);
	return json({ state: matchState(after.match, after.you) });
}

async function remove(request, token, env, now) {
	const found = await findByToken(env.DB, token, now);
	if (!found) return json({ error: "not_found" }, 404);
	if (found.you.unclaimedCaptain) return json({ error: "not_set_up" }, 409);
	if (!found.you.isCaptain) return json({ error: "wrong_role" }, 403);
	const body = await readBody(request);
	const own = found.sides[found.you.side].members;
	if (!own.some((m) => m.id === body.memberId)) {
		const anywhere = [...found.sides.a.members, ...found.sides.b.members].some((m) => m.id === body.memberId);
		return json({ error: anywhere ? "wrong_side" : "not_found" }, anywhere ? 403 : 404);
	}
	const check = canRemove(own, body.memberId);
	if (!check.ok) return json({ error: check.reason }, 409);
	if (!(await removeMember(env.DB, body.memberId))) return json({ error: "answered_or_too_small" }, 409);
	const after = await load(token, env, now);
	return json({ state: matchState(after.match, after.you) });
}

async function destroy(token, env, now) {
	const found = await findByToken(env.DB, token, now);
	if (!found) return json({ error: "not_found" }, 404);
	const { match, sides, you } = found;
	if (you.unclaimedCaptain) return json({ error: "not_set_up" }, 409);
	if (you.isCaptain) {
		if (match.revealedAt) await anonymiseMatch(env.DB, match.id, now);
		else await deleteMatch(env.DB, match.id);
		return json({ deleted: true });
	}
	if (match.revealedAt) {
		await forgetMemberName(env.DB, you.id);
		return json({ deleted: true });
	}
	const own = sides[you.side].members;
	const check = canRemove(own, you.id);
	if (!check.ok) return json({ error: check.reason }, 409);
	if (!(await removeMember(env.DB, you.id))) return json({ error: "answered_or_too_small" }, 409);
	// The leaver's token is gone; re-check the reveal through a captain's.
	await load(sides.a.members.find((m) => m.isCaptain).token, env, now);
	return json({ deleted: true });
}
