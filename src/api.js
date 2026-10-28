// HTTP layer for the sessions API. Maps requests to the pure session logic
// and the D1 store, and keeps every number sealed until both have scored.

import { json } from "./http.js";
import { validateName, validateScores, visibleState, computeT, ValidationError } from "./session.js";
import { createSession, findByToken, submitInviteeScores, countRecentCreations, anonymiseSession, deleteSession } from "./store.js";

const TOKEN = "([A-Za-z0-9_-]{22})";
const CREATE = /^\/api\/sessions$/;
const ONE = new RegExp(`^/api/sessions/${TOKEN}$`);
const SCORE = new RegExp(`^/api/sessions/${TOKEN}/score$`);

const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60 * 60 * 1000;

export async function handleApi(request, env, now = Date.now()) {
	const { pathname } = new URL(request.url);
	try {
		let m;
		if (request.method === "POST" && CREATE.test(pathname)) return await create(request, env, now);
		if (request.method === "GET" && (m = ONE.exec(pathname))) return await read(m[1], env, now);
		if (request.method === "POST" && (m = SCORE.exec(pathname))) return await score(request, m[1], env, now);
		if (request.method === "DELETE" && (m = ONE.exec(pathname))) return await remove(m[1], env, now);
		return json({ error: "not_found" }, 404);
	} catch (err) {
		if (err instanceof ValidationError) return json({ error: "invalid", message: err.message }, 400);
		console.error(err);
		return json({ error: "server_error" }, 500);
	}
}

export async function readBody(request) {
	try {
		const body = await request.json();
		if (!body || typeof body !== "object") throw new Error();
		return body;
	} catch {
		throw new ValidationError("body must be a JSON object");
	}
}

// Salted so the stored hash cannot be reversed into an address. The salt is a Worker secret.
export async function hashIp(ip, salt) {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${salt}:${ip}`));
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function ipHash(request, env) {
	if (!env.IP_SALT) console.warn("IP_SALT is not set; using an unsalted hash");
	return hashIp(request.headers.get("cf-connecting-ip") ?? "unknown", env.IP_SALT ?? "");
}

async function create(request, env, now) {
	const body = await readBody(request);
	const creatorName = validateName(body.creatorName);
	const inviteeName = validateName(body.inviteeName);
	const creatorScores = validateScores(body);
	const creatorIpHash = await ipHash(request, env);
	if ((await countRecentCreations(env.DB, creatorIpHash, now - RATE_WINDOW_MS)) >= RATE_LIMIT) {
		return json({ error: "rate_limited" }, 429);
	}
	const { creatorToken, inviteeToken } = await createSession(env.DB, { creatorName, inviteeName, creatorScores, creatorIpHash, now });
	return json({ creatorToken, inviteeToken }, 201);
}

function withTotals({ given, predicted }) {
	return { given, predicted, givenT: computeT(given), predictedT: computeT(predicted) };
}

async function read(token, env, now) {
	const session = await findByToken(env.DB, token, now);
	if (!session) return json({ error: "not_found" }, 404);
	const state = visibleState(session, session.role);
	const body = { role: session.role, state, creatorName: session.creatorName, inviteeName: session.inviteeName };
	if (session.role === "creator") body.inviteeToken = session.inviteeToken;
	if (state === "revealed") {
		body.reveal = { creator: withTotals(session.creatorScores), invitee: withTotals(session.inviteeScores) };
	}
	return json(body);
}

async function score(request, token, env, now) {
	const session = await findByToken(env.DB, token, now);
	if (!session) return json({ error: "not_found" }, 404);
	if (session.role !== "invitee") return json({ error: "wrong_role" }, 403);
	if (session.inviteeScores) return json({ error: "already_scored" }, 409);
	const body = await readBody(request);
	const scores = validateScores(body);
	const name = body.name === undefined ? null : validateName(body.name);
	const ok = await submitInviteeScores(env.DB, token, scores, now, name);
	if (!ok) return json({ error: "already_scored" }, 409);
	return json({ state: "revealed" });
}

// Either party may delete. Finished sessions keep their numbers anonymously; unfinished ones vanish.
async function remove(token, env, now) {
	const session = await findByToken(env.DB, token, now);
	if (!session) return json({ error: "not_found" }, 404);
	if (session.inviteeScores) await anonymiseSession(env.DB, session.id, now);
	else await deleteSession(env.DB, session.id);
	return json({ deleted: true });
}
