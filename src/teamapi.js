// HTTP layer for team mode. Same conventions as the sessions API: JSON in and
// out, tokens are the only credential, nothing numeric leaves until the reveal.

import { json } from "./http.js";
import { ValidationError } from "./session.js";
import { readBody, hashIp } from "./api.js";
import { countRecentCreations } from "./store.js";
import { validateTeam, validateTeamScores, allAnswered, teamState, aggregate, canRemove } from "./team.js";
import { createTeam, findTeamByToken, submitTeamScore, markRevealed, removeMember, forgetMemberName, anonymiseTeam, deleteTeam } from "./teamstore.js";
import { computeT } from "./session.js";

const TOKEN = "([A-Za-z0-9_-]{22})";
const CREATE = /^\/api\/teams$/;
const ONE = new RegExp(`^/api/teams/${TOKEN}$`);
const SCORE = new RegExp(`^/api/teams/${TOKEN}/score$`);
const REMOVE = new RegExp(`^/api/teams/${TOKEN}/remove$`);

const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60 * 60 * 1000;

export async function handleTeamApi(request, env, now = Date.now()) {
	const url = new URL(request.url);
	const { pathname } = url;
	try {
		let m;
		if (request.method === "POST" && CREATE.test(pathname)) return await create(request, env, now);
		if (request.method === "GET" && (m = ONE.exec(pathname))) return await read(m[1], url.origin, env, now);
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
	const { teamName, creatorName, members } = validateTeam(body);
	const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
	const creatorIpHash = await hashIp(ip, env.IP_SALT ?? "");
	if ((await countRecentCreations(env.DB, creatorIpHash, now - RATE_WINDOW_MS)) >= RATE_LIMIT) {
		return json({ error: "rate_limited" }, 429);
	}
	const { creatorToken } = await createTeam(env.DB, { teamName, creatorName, members, creatorIpHash, now });
	return json({ creatorToken }, 201);
}

// Loads the team for a token and, if everyone remaining has answered, records the reveal.
async function load(token, env, now) {
	const found = await findTeamByToken(env.DB, token, now);
	if (!found) return null;
	if (!found.team.revealedAt && allAnswered(found.members)) {
		await markRevealed(env.DB, found.team.id, now);
		found.team.revealedAt = now;
	}
	return found;
}

function present({ team, you, members }, origin) {
	const state = teamState(team, you);
	const creator = members.find((m) => m.isCreator);
	const body = {
		role: you.isCreator ? "creator" : "member",
		state,
		teamName: team.name,
		creatorName: creator ? creator.nickname : "",
		you: { id: you.id, nickname: you.nickname, answered: !!you.scores },
		members: members.map((m) => ({ id: m.id, nickname: m.nickname, answered: !!m.scores, isCreator: m.isCreator })),
	};
	if (you.isCreator && state !== "revealed") {
		body.links = members.filter((m) => m.token).map((m) => ({ id: m.id, nickname: m.nickname, url: `${origin}/t/${m.token}` }));
	}
	// Individual numbers never leave on a GET: the creator holds every member's link.
	if (state === "revealed") body.reveal = aggregate(members);
	return body;
}

async function read(token, origin, env, now) {
	const found = await load(token, env, now);
	if (!found) return json({ error: "not_found" }, 404);
	return json(present(found, origin));
}

async function score(request, token, env, now) {
	const found = await findTeamByToken(env.DB, token, now);
	if (!found) return json({ error: "not_found" }, 404);
	if (found.you.scores) return json({ error: "already_scored" }, 409);
	const scores = validateTeamScores(await readBody(request));
	if (!(await submitTeamScore(env.DB, found.you.id, scores, now))) return json({ error: "already_scored" }, 409);
	const after = await load(token, env, now);
	// Your own numbers come back exactly once, here; the page keeps them on this device.
	return json({ state: teamState(after.team, after.you), you: { ...scores.given, t: computeT(scores.given) } });
}

async function remove(request, token, env, now) {
	const found = await findTeamByToken(env.DB, token, now);
	if (!found) return json({ error: "not_found" }, 404);
	if (!found.you.isCreator) return json({ error: "wrong_role" }, 403);
	const body = await readBody(request);
	const check = canRemove(found.members, body.memberId);
	if (!check.ok) return json({ error: check.reason }, check.reason === "not_found" ? 404 : 409);
	await removeMember(env.DB, body.memberId);
	const after = await load(token, env, now);
	return json({ state: teamState(after.team, after.you) });
}

async function destroy(token, env, now) {
	const found = await findTeamByToken(env.DB, token, now);
	if (!found) return json({ error: "not_found" }, 404);
	const { team, you, members } = found;
	if (you.isCreator) {
		if (team.revealedAt) await anonymiseTeam(env.DB, team.id, now);
		else await deleteTeam(env.DB, team.id);
		return json({ deleted: true });
	}
	if (team.revealedAt) {
		await forgetMemberName(env.DB, you.id);
		return json({ deleted: true });
	}
	const check = canRemove(members, you.id);
	if (!check.ok) return json({ error: check.reason }, 409);
	await removeMember(env.DB, you.id);
	// The leaver's token is gone; re-check the reveal through the creator's.
	await load(members.find((m) => m.isCreator).token, env, now);
	return json({ deleted: true });
}
